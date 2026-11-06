import type { OutboxOp, SyncOpResult } from "@timepeace/shared";
import { describe, expect, it, vi } from "vitest";
import { flushOutbox, memoryStore } from "./outbox";

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const start = (): OutboxOp => ({ opId: id(), type: "time.start", at: new Date().toISOString(), payload: { entryId: id(), taskId: "t1", projectId: "p1" } });
const expense = (): OutboxOp => ({
  opId: id(),
  type: "expense.create",
  at: new Date().toISOString(),
  payload: { expenseId: id(), projectId: "p1", vendorName: "HD", amountCents: 100, salesTaxCents: 0, category: "MATERIAL", paidBy: "PERSONAL", spentOn: "2026-11-05" },
});
const applyAll = (ops: OutboxOp[]): SyncOpResult[] => ops.map((o) => ({ opId: o.opId, status: "applied" }));

describe("flushOutbox", () => {
  it("sends in order and clears applied ops", async () => {
    const store = memoryStore();
    const a = start();
    const b = start();
    await store.enqueue(a);
    await store.enqueue(b);
    const send = vi.fn(async (ops: OutboxOp[]) => applyAll(ops));
    const r = await flushOutbox({ store, send, uploadReceipt: vi.fn() });
    expect(send.mock.calls[0]![0].map((o) => o.opId)).toEqual([a.opId, b.opId]);
    expect(r).toMatchObject({ sent: 2, applied: 2, rejected: 0 });
    expect(store.rows).toHaveLength(0);
  });

  it("keeps everything when offline and retries later with the same opIds", async () => {
    const store = memoryStore();
    const a = start();
    await store.enqueue(a);
    const r1 = await flushOutbox({ store, send: async () => Promise.reject(new Error("Network request failed")), uploadReceipt: vi.fn() });
    expect(r1.offlineError).toMatch(/Network/);
    expect(store.rows[0]).toMatchObject({ attempts: 1, status: "pending" });
    const send = vi.fn(async (ops: OutboxOp[]) => applyAll(ops));
    await flushOutbox({ store, send, uploadReceipt: vi.fn() });
    expect(send.mock.calls[0]![0][0]!.opId).toBe(a.opId);
  });

  it("treats duplicates as done and keeps rejected ops for the user", async () => {
    const store = memoryStore();
    const a = start();
    const b = start();
    await store.enqueue(a);
    await store.enqueue(b);
    await flushOutbox({
      store,
      send: async () => [
        { opId: a.opId, status: "duplicate" },
        { opId: b.opId, status: "rejected", error: "locked" },
      ],
      uploadReceipt: vi.fn(),
    });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ status: "rejected", error: "locked" });
    expect(await store.pending(10)).toHaveLength(0);
  });

  it("uploads a receipt once, then sends the expense with the file id", async () => {
    const store = memoryStore();
    const e = expense();
    await store.enqueue(e, "file:///receipt.jpg");
    const upload = vi.fn(async () => "file_123");
    // First attempt: upload succeeds, send fails.
    await flushOutbox({ store, send: async () => Promise.reject(new Error("offline")), uploadReceipt: upload });
    const send = vi.fn(async (ops: OutboxOp[]) => applyAll(ops));
    await flushOutbox({ store, send, uploadReceipt: upload });
    expect(upload).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0]![0][0]!;
    expect(sent.type === "expense.create" && sent.payload.receiptFileId).toBe("file_123");
  });
});
