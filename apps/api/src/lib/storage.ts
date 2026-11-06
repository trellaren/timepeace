import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { env } from "../env";

/**
 * File storage. The MVP ships a local-disk driver; an S3/MinIO driver implementing the
 * same interface (with presigned URLs) is planned. See docs/architecture.md.
 */
export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Readable;
}

export const localStorage: Storage = {
  async put(key, data) {
    const file = path.join(env.uploadDir, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  },
  get(key) {
    const file = path.join(env.uploadDir, key);
    if (!file.startsWith(path.resolve(env.uploadDir))) throw new Error("Invalid key");
    return createReadStream(file);
  },
};

export const storage: Storage = localStorage;
