import path from "node:path";

export const env = {
  port: Number(process.env.API_PORT ?? 4000),
  webOrigin: (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(","),
  databaseUrl: process.env.DATABASE_URL,
  uploadDir: process.env.UPLOAD_DIR ?? path.resolve(import.meta.dirname, "../../../.data/uploads"),
  /** 32-byte hex key. Required in production; a fixed dev key is used otherwise. */
  fieldEncryptionKey:
    process.env.FIELD_ENCRYPTION_KEY ||
    (process.env.NODE_ENV === "production"
      ? (() => {
          throw new Error("FIELD_ENCRYPTION_KEY is required in production");
        })()
      : "0".repeat(64)),
  sessionTtlDays: 30,
};
