import path from "node:path";

const isProduction = process.env.NODE_ENV === "production";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required in production`);
  return v;
}

const storageDriver = (process.env.STORAGE_DRIVER ?? "local") as "local" | "supabase";

export const env = {
  port: Number(process.env.API_PORT ?? process.env.PORT ?? 4000),
  webOrigin: (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(",").map((s) => s.trim()).filter(Boolean),
  databaseUrl: process.env.DATABASE_URL,
  uploadDir: process.env.UPLOAD_DIR ?? path.resolve(import.meta.dirname, "../../../.data/uploads"),
  /** Largest accepted upload. Vercel Functions cap request bodies at 4.5 MB, so set ~4 MB there. */
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024),
  storage: {
    driver: storageDriver,
    bucket: process.env.STORAGE_BUCKET ?? "timepeace",
    supabaseUrl: storageDriver === "supabase" ? required("SUPABASE_URL") : undefined,
    supabaseServiceRoleKey: storageDriver === "supabase" ? required("SUPABASE_SERVICE_ROLE_KEY") : undefined,
  },
  /** 32-byte hex key. Required in production; a fixed dev key is used otherwise. */
  fieldEncryptionKey: isProduction ? required("FIELD_ENCRYPTION_KEY") : process.env.FIELD_ENCRYPTION_KEY || "0".repeat(64),
  sessionTtlDays: 30,
};

if (isProduction) {
  if (!/^[0-9a-f]{64}$/i.test(env.fieldEncryptionKey) || /^0+$/.test(env.fieldEncryptionKey)) {
    throw new Error("FIELD_ENCRYPTION_KEY must be 64 hex characters (and not the dev key)");
  }
  if (storageDriver === "local") throw new Error("STORAGE_DRIVER=local is not durable in production; use supabase");
  if (!process.env.WEB_ORIGIN) throw new Error("WEB_ORIGIN is required in production");
}
