import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { fromDbDate } from "@timepeace/db";
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from "@trpc/server/adapters/fastify";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { bearerToken, createContext, resolveAuth, type AuthInfo } from "./context";
import { env } from "./env";
import { db } from "./lib/db";
import { storage } from "./lib/storage";
import { appRouter, type AppRouter } from "./router";
import { canDiscuss, readableFiles } from "./services/discussion";
import { buildCpaPackage } from "./services/cpaPackage";
import { payrollCsv, payrollPdf, payrollRows } from "./services/payroll";
import { PAYROLL_ROLES } from "./trpc";

const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/** Discussion photos and thumbnails: resized on the device, so only these web formats. */
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const UPLOAD_KINDS = { receipt: "RECEIPT", photo: "PHOTO", thumbnail: "THUMBNAIL" } as const;

/** The image type the bytes actually are, so a file can't pose as a photo. */
export function sniffImage(b: Buffer): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", bodyLimit: 2 * 1024 * 1024 });
  await app.register(cors, {
    // Native mobile apps send no Origin; browsers must match WEB_ORIGIN.
    origin: (origin, cb) => cb(null, !origin || env.webOrigin.includes(origin)),
    credentials: false,
  });
  await app.register(multipart, { limits: { fileSize: env.maxUploadBytes, files: 1 } });

  await app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext,
      onError({ path, error }) {
        if (error.code === "INTERNAL_SERVER_ERROR") app.log.error({ path, err: error }, "tRPC error");
      },
    } satisfies FastifyTRPCPluginOptions<AppRouter>["trpcOptions"],
  });

  app.get("/health", async () => ({ ok: true }));

  const requireAuth = async (req: Parameters<typeof bearerToken>[0], roles?: string[]): Promise<AuthInfo> => {
    const auth = await resolveAuth(bearerToken(req));
    if (!auth) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    if (roles && !roles.includes(auth.role)) throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
    return auth;
  };

  /**
   * Upload a receipt (default) or a discussion photo/thumbnail (`?kind=photo|thumbnail`).
   * Returns a FileObject id for an expense or a message to reference.
   */
  app.post<{ Querystring: { kind?: string } }>("/files", async (req, reply) => {
    const auth = await requireAuth(req);
    const kindParam = req.query.kind ?? "receipt";
    if (!(kindParam in UPLOAD_KINDS)) return reply.code(400).send({ error: "Unknown kind" });
    const kind = UPLOAD_KINDS[kindParam as keyof typeof UPLOAD_KINDS];
    if (kind !== "RECEIPT" && !canDiscuss(auth)) return reply.code(403).send({ error: "Forbidden" });
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "No file" });
    const ext = ALLOWED_UPLOAD_TYPES[file.mimetype];
    if (!ext || (kind !== "RECEIPT" && !PHOTO_TYPES.has(file.mimetype))) return reply.code(415).send({ error: `Unsupported type ${file.mimetype}` });
    let data: Buffer;
    try {
      data = await file.toBuffer();
    } catch (err) {
      if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") return reply.code(413).send({ error: `File is larger than ${Math.floor(env.maxUploadBytes / 1024 / 1024)} MB` });
      throw err;
    }
    if (kind !== "RECEIPT" && sniffImage(data) !== file.mimetype) return reply.code(415).send({ error: "That file isn't a JPEG, PNG or WebP image" });
    const key = `${auth.orgId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
    await storage.put(key, data, file.mimetype);
    const obj = await db().fileObject.create({
      data: { orgId: auth.orgId, uploadedById: auth.userId, storageKey: key, contentType: file.mimetype, sizeBytes: data.length, kind },
    });
    return { id: obj.id };
  });

  app.get<{ Params: { id: string } }>("/files/:id", async (req, reply) => {
    const auth = await requireAuth(req);
    const f = await db().fileObject.findFirst({ where: { id: req.params.id, orgId: auth.orgId } });
    // Receipts: workers only their own. Photos: anyone who can see the message's task. Removed: nobody.
    if (!f || !(await readableFiles(auth, [f])).has(f.id)) return reply.code(404).send({ error: "Not found" });
    return reply
      .type(f.contentType)
      .header("Cache-Control", "private, max-age=3600")
      .header("X-Content-Type-Options", "nosniff")
      .send(await storage.read(f.storageKey));
  });

  app.get<{ Params: { id: string } }>("/payroll-exports/:id/download", async (req, reply) => {
    const auth = await requireAuth(req, PAYROLL_ROLES);
    const exp = await db().payrollExport.findFirst({ where: { id: req.params.id, orgId: auth.orgId }, include: { payPeriod: true, org: true } });
    if (!exp) return reply.code(404).send({ error: "Not found" });
    const period = { start: fromDbDate(exp.payPeriod.startDate), end: fromDbDate(exp.payPeriod.endDate) };
    const rows = await payrollRows(db(), auth.orgId, exp.payPeriodId, exp.id);
    const base = `payroll_${period.start}_${period.end}`;
    if (exp.format === "PDF") {
      return reply
        .type("application/pdf")
        .header("Content-Disposition", `attachment; filename="${base}.pdf"`)
        .send(await payrollPdf(exp.org.name, period, rows));
    }
    return reply
      .type("text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${base}.csv"`)
      .send(payrollCsv(period, rows));
  });

  app.get<{ Params: { year: string } }>("/tax/:year/cpa-package.zip", async (req, reply) => {
    const auth = await requireAuth(req, ["OWNER", "ACCOUNTANT"]);
    const year = Number(req.params.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return reply.code(400).send({ error: "Invalid year" });
    const pkg = await buildCpaPackage(db(), auth.orgId, year);
    return reply.type("application/zip").header("Content-Disposition", `attachment; filename="${pkg.filename}"`).send(Buffer.from(pkg.data));
  });

  return app;
}
