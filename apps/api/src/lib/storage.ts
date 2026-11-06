import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../env";

/**
 * File storage for receipts, photos and generated exports. Two drivers:
 * - `local`: files under UPLOAD_DIR (development, tests).
 * - `supabase`: a private Supabase Storage bucket over its REST API (hosted; serverless functions
 *   have no durable disk). Uses the service-role key, so it must only ever run server-side.
 */
export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  read(key: string): Promise<Buffer>;
  /** A short-lived URL a client can download from directly, when the driver supports it. */
  signedUrl?(key: string, expiresInSeconds: number, downloadName?: string): Promise<string>;
  /** Signed URLs for many objects in one request (photo thumbnails). Same order as `keys`. */
  signedUrls?(keys: string[], expiresInSeconds: number): Promise<string[]>;
  /** Delete objects. Missing objects are not an error. */
  remove(keys: string[]): Promise<void>;
}

function assertSafeKey(key: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
}

export const localStorage: Storage = {
  async put(key, data) {
    assertSafeKey(key);
    const file = path.join(env.uploadDir, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  },
  async read(key) {
    assertSafeKey(key);
    const file = path.join(env.uploadDir, key);
    if (!file.startsWith(path.resolve(env.uploadDir))) throw new Error("Invalid key");
    return readFile(file);
  },
  async remove(keys) {
    for (const key of keys) {
      assertSafeKey(key);
      await rm(path.join(env.uploadDir, key), { force: true });
    }
  },
};

export function supabaseStorage(opts: { url: string; serviceRoleKey: string; bucket: string }): Storage {
  const base = `${opts.url.replace(/\/$/, "")}/storage/v1`;
  const headers = { Authorization: `Bearer ${opts.serviceRoleKey}`, apikey: opts.serviceRoleKey };
  const objectPath = (key: string) => `${encodeURIComponent(opts.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const fail = async (what: string, res: Response) => {
    throw new Error(`Storage ${what} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  };
  return {
    async put(key, data, contentType) {
      assertSafeKey(key);
      const res = await fetch(`${base}/object/${objectPath(key)}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": contentType, "x-upsert": "true" },
        body: new Uint8Array(data),
      });
      if (!res.ok) await fail("upload", res);
    },
    async read(key) {
      assertSafeKey(key);
      const res = await fetch(`${base}/object/authenticated/${objectPath(key)}`, { headers });
      if (!res.ok) await fail("download", res);
      return Buffer.from(await res.arrayBuffer());
    },
    async signedUrl(key, expiresIn, downloadName) {
      assertSafeKey(key);
      const res = await fetch(`${base}/object/sign/${objectPath(key)}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn }),
      });
      if (!res.ok) await fail("sign", res);
      const { signedURL } = (await res.json()) as { signedURL: string };
      const u = new URL(`${base}${signedURL}`);
      if (downloadName) u.searchParams.set("download", downloadName);
      return u.toString();
    },
    async signedUrls(keys, expiresIn) {
      if (keys.length === 0) return [];
      keys.forEach(assertSafeKey);
      const res = await fetch(`${base}/object/sign/${encodeURIComponent(opts.bucket)}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn, paths: keys }),
      });
      if (!res.ok) await fail("sign", res);
      const rows = (await res.json()) as { path: string | null; signedURL: string | null; error: string | null }[];
      const byPath = new Map(rows.map((r) => [r.path, r]));
      return keys.map((k) => {
        const r = byPath.get(k);
        if (!r?.signedURL) throw new Error(`Storage sign failed for an object: ${r?.error ?? "missing"}`);
        return `${base}${r.signedURL}`;
      });
    },
    async remove(keys) {
      if (keys.length === 0) return;
      keys.forEach(assertSafeKey);
      const res = await fetch(`${base}/object/${encodeURIComponent(opts.bucket)}`, {
        method: "DELETE",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: keys }),
      });
      if (!res.ok) await fail("delete", res);
    },
  };
}

export const storage: Storage =
  env.storage.driver === "supabase"
    ? supabaseStorage({ url: env.storage.supabaseUrl!, serviceRoleKey: env.storage.supabaseServiceRoleKey!, bucket: env.storage.bucket })
    : localStorage;
