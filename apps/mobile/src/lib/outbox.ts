/**
 * Offline outbox: every field action is stored locally first, then pushed to the API in order.
 * This module is pure TypeScript (no React Native imports) so the flush logic is unit-testable.
 */
import type { OutboxOp, SyncOpResult } from "@timepeace/shared";

export interface OutboxRow {
  seq: number;
  op: OutboxOp;
  /** Local file URI of a receipt photo to upload before sending (expense.create only). */
  localReceiptUri: string | null;
  status: "pending" | "rejected";
  error: string | null;
  attempts: number;
}

export interface OutboxStore {
  enqueue(op: OutboxOp, localReceiptUri?: string | null): Promise<void>;
  pending(limit: number): Promise<OutboxRow[]>;
  rejected(): Promise<OutboxRow[]>;
  /** Replace the stored op (e.g. after uploading its receipt) and clear the local URI. */
  update(seq: number, op: OutboxOp, localReceiptUri: string | null): Promise<void>;
  remove(seqs: number[]): Promise<void>;
  markRejected(seq: number, error: string): Promise<void>;
  bumpAttempts(seqs: number[]): Promise<void>;
  dismiss(seq: number): Promise<void>;
  count(): Promise<{ pending: number; rejected: number }>;
}

export interface FlushDeps {
  store: OutboxStore;
  send: (ops: OutboxOp[]) => Promise<SyncOpResult[]>;
  uploadReceipt: (localUri: string) => Promise<string>;
  batchSize?: number;
}

export interface FlushResult {
  sent: number;
  applied: number;
  rejected: number;
  /** Set when the flush stopped early because the network/API was unavailable. */
  offlineError?: string;
}

/**
 * Push pending ops in insertion order. Stops at the first transport failure so ordering is kept
 * (a stop must never reach the server before its start). Server-side rejections are kept
 * for the user to see but don't block later ops.
 */
export async function flushOutbox({ store, send, uploadReceipt, batchSize = 50 }: FlushDeps): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, applied: 0, rejected: 0 };
  for (;;) {
    const rows = await store.pending(batchSize);
    if (rows.length === 0) return result;

    // Upload receipts first; the expense op references the uploaded file id.
    for (const row of rows) {
      if (row.localReceiptUri && row.op.type === "expense.create") {
        try {
          const fileId = await uploadReceipt(row.localReceiptUri);
          row.op = { ...row.op, payload: { ...row.op.payload, receiptFileId: fileId } };
          row.localReceiptUri = null;
          await store.update(row.seq, row.op, null);
        } catch (e) {
          await store.bumpAttempts(rows.map((r) => r.seq));
          return { ...result, offlineError: e instanceof Error ? e.message : String(e) };
        }
      }
    }

    let results: SyncOpResult[];
    try {
      results = await send(rows.map((r) => r.op));
    } catch (e) {
      await store.bumpAttempts(rows.map((r) => r.seq));
      return { ...result, offlineError: e instanceof Error ? e.message : String(e) };
    }

    const bySeq = new Map(rows.map((r) => [r.op.opId, r.seq]));
    const done: number[] = [];
    for (const r of results) {
      const seq = bySeq.get(r.opId);
      if (seq == null) continue;
      if (r.status === "rejected") {
        await store.markRejected(seq, r.error ?? "Rejected by server");
        result.rejected++;
      } else {
        done.push(seq);
        result.applied++;
      }
    }
    await store.remove(done);
    result.sent += rows.length;
    if (rows.length < batchSize) return result;
  }
}

/** In-memory store, used by tests and as a fallback where SQLite isn't available. */
export function memoryStore(): OutboxStore & { rows: OutboxRow[] } {
  let seq = 0;
  const rows: OutboxRow[] = [];
  return {
    rows,
    async enqueue(op, localReceiptUri = null) {
      rows.push({ seq: ++seq, op, localReceiptUri, status: "pending", error: null, attempts: 0 });
    },
    async pending(limit) {
      return rows.filter((r) => r.status === "pending").slice(0, limit).map((r) => ({ ...r }));
    },
    async rejected() {
      return rows.filter((r) => r.status === "rejected");
    },
    async update(s, op, uri) {
      const r = rows.find((x) => x.seq === s);
      if (r) Object.assign(r, { op, localReceiptUri: uri });
    },
    async remove(seqs) {
      for (const s of seqs) {
        const i = rows.findIndex((r) => r.seq === s);
        if (i >= 0) rows.splice(i, 1);
      }
    },
    async markRejected(s, error) {
      const r = rows.find((x) => x.seq === s);
      if (r) Object.assign(r, { status: "rejected", error });
    },
    async bumpAttempts(seqs) {
      for (const r of rows) if (seqs.includes(r.seq)) r.attempts++;
    },
    async dismiss(s) {
      await this.remove([s]);
    },
    async count() {
      return { pending: rows.filter((r) => r.status === "pending").length, rejected: rows.filter((r) => r.status === "rejected").length };
    },
  };
}

const STATUS_WORDS: Record<string, string> = { IN_PROGRESS: "in progress", NEEDS_MATERIALS: "needs materials", BLOCKED: "blocked", DONE: "done" };

/** Plain-English description of one queued change, for people (not the server). */
export function describeOp(op: OutboxOp): string {
  switch (op.type) {
    case "shift.clockIn":
      return "Clocked in";
    case "shift.clockOut":
      return op.payload.note ? `Clocked out (note: ${op.payload.note})` : "Clocked out";
    case "shift.breakStart":
      return "Started meal break";
    case "shift.breakEnd":
      return "Ended meal break";
    case "time.start":
      return "Started a task";
    case "time.stop":
      return "Stopped a task";
    case "task.status":
      return `Marked a task ${STATUS_WORDS[op.payload.status] ?? op.payload.status}${op.payload.note ? ` (${op.payload.note})` : ""}`;
    case "material.request":
      return `Requested materials: ${op.payload.description}${op.payload.quantity ? ` × ${op.payload.quantity}` : ""}`;
    case "expense.create":
      return `Expense $${(op.payload.amountCents / 100).toFixed(2)} at ${op.payload.vendorName} (${op.payload.paidBy === "PERSONAL" ? "paid personally" : "company card"}, ${op.payload.spentOn})`;
  }
}

/**
 * Text a worker can send their manager when queued changes can't be uploaded (e.g. their access
 * was turned off before the phone synced). Clock-in/out times are what payroll needs.
 */
export function summarizeUnsynced(name: string, rows: Pick<OutboxRow, "op" | "status" | "error">[], formatTime: (iso: string) => string): string {
  const lines = [...rows]
    .sort((a, b) => a.op.at.localeCompare(b.op.at))
    .map((r) => `• ${formatTime(r.op.at)}: ${describeOp(r.op)}${r.status === "rejected" ? ` [not accepted: ${r.error ?? "rejected"}]` : ""}`);
  return [`Timepeace entries saved on ${name}'s phone that haven't uploaded (${rows.length}):`, ...lines].join("\n");
}
