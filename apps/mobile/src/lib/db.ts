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
    return db;
  })();
  return dbPromise;
}

type Row = { seq: number; op: string; local_receipt_uri: string | null; status: "pending" | "rejected"; error: string | null; attempts: number };
const toRow = (r: Row): OutboxRow => ({ seq: r.seq, op: JSON.parse(r.op) as OutboxOp, localReceiptUri: r.local_receipt_uri, status: r.status, error: r.error, attempts: r.attempts });

export const sqliteOutbox: OutboxStore = {
  async enqueue(op, localReceiptUri = null) {
    const db = await localDb();
    await db.runAsync("INSERT INTO outbox (op, local_receipt_uri) VALUES (?, ?)", JSON.stringify(op), localReceiptUri);
  },
  async pending(limit) {
    const db = await localDb();
    return (await db.getAllAsync<Row>("SELECT * FROM outbox WHERE status = 'pending' ORDER BY seq LIMIT ?", limit)).map(toRow);
  },
  async rejected() {
    const db = await localDb();
    return (await db.getAllAsync<Row>("SELECT * FROM outbox WHERE status = 'rejected' ORDER BY seq")).map(toRow);
  },
  async update(seq, op, uri) {
    const db = await localDb();
    await db.runAsync("UPDATE outbox SET op = ?, local_receipt_uri = ? WHERE seq = ?", JSON.stringify(op), uri, seq);
  },
  async remove(seqs) {
    if (!seqs.length) return;
    const db = await localDb();
    await db.runAsync(`DELETE FROM outbox WHERE seq IN (${seqs.map(() => "?").join(",")})`, ...seqs);
  },
  async markRejected(seq, error) {
    const db = await localDb();
    await db.runAsync("UPDATE outbox SET status = 'rejected', error = ? WHERE seq = ?", error, seq);
  },
  async bumpAttempts(seqs) {
    if (!seqs.length) return;
    const db = await localDb();
    await db.runAsync(`UPDATE outbox SET attempts = attempts + 1 WHERE seq IN (${seqs.map(() => "?").join(",")})`, ...seqs);
  },
  async dismiss(seq) {
    await this.remove([seq]);
  },
  async count() {
    const db = await localDb();
    const r = await db.getFirstAsync<{ pending: number; rejected: number }>(
      "SELECT SUM(status = 'pending') AS pending, SUM(status = 'rejected') AS rejected FROM outbox",
    );
    return { pending: r?.pending ?? 0, rejected: r?.rejected ?? 0 };
  },
};

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
  async clearAll() {
    const db = await localDb();
    await db.execAsync("DELETE FROM kv; DELETE FROM outbox;");
  },
};
