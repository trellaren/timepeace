import type { OutboxOp } from "@timepeace/shared";
import * as SQLite from "expo-sqlite";
import type { OutboxRow, OutboxStore } from "./outbox";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function localDb() {
  dbPromise ??= (async () => {
    const db = await SQLite.openDatabaseAsync("timepeace.db");
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS outbox (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        op TEXT NOT NULL,
        local_receipt_uri TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    `);
    // v2: each queued change belongs to the worker who made it, so it can only ever be uploaded
    // under their login, and survives signing out.
    const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(outbox)");
    if (!cols.some((c) => c.name === "user_id")) {
      await db.execAsync("ALTER TABLE outbox ADD COLUMN user_id TEXT; ALTER TABLE outbox ADD COLUMN user_name TEXT;");
    }
    return db;
  })();
  return dbPromise;
}

type Row = { seq: number; op: string; local_receipt_uri: string | null; status: "pending" | "rejected"; error: string | null; attempts: number };
const toRow = (r: Row): OutboxRow => ({ seq: r.seq, op: JSON.parse(r.op) as OutboxOp, localReceiptUri: r.local_receipt_uri, status: r.status, error: r.error, attempts: r.attempts });

export interface OutboxOwner {
  id: string;
  name: string;
}

/** The outbox of one worker. Changes made by anyone else on this phone are invisible to it. */
export function outboxFor(owner: OutboxOwner): OutboxStore {
  const u = owner.id;
  return {
    async enqueue(op, localReceiptUri = null) {
      const db = await localDb();
      await db.runAsync("INSERT INTO outbox (op, local_receipt_uri, user_id, user_name) VALUES (?, ?, ?, ?)", JSON.stringify(op), localReceiptUri, u, owner.name);
    },
    async pending(limit) {
      const db = await localDb();
      return (await db.getAllAsync<Row>("SELECT * FROM outbox WHERE user_id = ? AND status = 'pending' ORDER BY seq LIMIT ?", u, limit)).map(toRow);
    },
    async rejected() {
      const db = await localDb();
      return (await db.getAllAsync<Row>("SELECT * FROM outbox WHERE user_id = ? AND status = 'rejected' ORDER BY seq", u)).map(toRow);
    },
    async update(seq, op, uri) {
      const db = await localDb();
      await db.runAsync("UPDATE outbox SET op = ?, local_receipt_uri = ? WHERE seq = ? AND user_id = ?", JSON.stringify(op), uri, seq, u);
    },
    async remove(seqs) {
      if (!seqs.length) return;
      const db = await localDb();
      await db.runAsync(`DELETE FROM outbox WHERE user_id = ? AND seq IN (${seqs.map(() => "?").join(",")})`, u, ...seqs);
    },
    async markRejected(seq, error) {
      const db = await localDb();
      await db.runAsync("UPDATE outbox SET status = 'rejected', error = ? WHERE seq = ? AND user_id = ?", error, seq, u);
    },
    async bumpAttempts(seqs) {
      if (!seqs.length) return;
      const db = await localDb();
      await db.runAsync(`UPDATE outbox SET attempts = attempts + 1 WHERE user_id = ? AND seq IN (${seqs.map(() => "?").join(",")})`, u, ...seqs);
    },
    async dismiss(seq) {
      await this.remove([seq]);
    },
    async count() {
      const db = await localDb();
      const r = await db.getFirstAsync<{ pending: number; rejected: number }>(
        "SELECT SUM(status = 'pending') AS pending, SUM(status = 'rejected') AS rejected FROM outbox WHERE user_id = ?",
        u,
      );
      return { pending: r?.pending ?? 0, rejected: r?.rejected ?? 0 };
    },
  };
}

/**
 * Rows queued before changes were tagged with their owner. Older app versions wiped the outbox on
 * sign-out, so any untagged rows belong to whoever is signed in when this version first starts.
 */
export async function adoptUntaggedOutbox(owner: OutboxOwner) {
  const db = await localDb();
  await db.runAsync("UPDATE outbox SET user_id = ?, user_name = ? WHERE user_id IS NULL", owner.id, owner.name);
}

/** Changes still on this phone, grouped by the worker who made them (for the sign-in screen). */
export async function unsyncedByWorker(): Promise<{ userId: string; name: string; rows: OutboxRow[] }[]> {
  const db = await localDb();
  const rows = await db.getAllAsync<Row & { user_id: string | null; user_name: string | null }>("SELECT * FROM outbox WHERE user_id IS NOT NULL ORDER BY seq");
  const groups = new Map<string, { userId: string; name: string; rows: OutboxRow[] }>();
  for (const r of rows) {
    const g = groups.get(r.user_id!) ?? { userId: r.user_id!, name: r.user_name ?? "Unknown", rows: [] };
    g.rows.push(toRow(r));
    groups.set(r.user_id!, g);
  }
  return [...groups.values()];
}

/** Small key/value cache for offline reads (last good My Day, timer state). */
export const kv = {
  async get<T>(key: string): Promise<T | null> {
    const db = await localDb();
    const r = await db.getFirstAsync<{ value: string }>("SELECT value FROM kv WHERE key = ?", key);
    return r ? (JSON.parse(r.value) as T) : null;
  },
  async set(key: string, value: unknown) {
    const db = await localDb();
    await db.runAsync("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, JSON.stringify(value));
  },
  /**
   * Cached screens and clock state only. Never touches the outbox: unsynced hours must survive sign-out.
   * Device preferences (`pref:` keys, such as the theme) also stay.
   */
  async clearCache() {
    const db = await localDb();
    await db.execAsync("DELETE FROM kv WHERE key NOT LIKE 'pref:%';");
  },
};
