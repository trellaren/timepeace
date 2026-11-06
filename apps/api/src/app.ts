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

export async function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", bodyLimit: 2 * 1024 * 1024 });
  await app.register(cors, {
    // Native mobile apps send no Origin; browsers must match WEB_ORIGIN.
    origin: (origin, cb) => cb(null, !origin || env.webOrigin.includes(origin)),
    credentials: false,
  });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

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

  /** Receipt / photo upload. Returns a FileObject id to reference from expenses. */
  app.post("/files", async (req, reply) => {
    const auth = await requireAuth(req);
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "No file" });
    const ext = ALLOWED_UPLOAD_TYPES[file.mimetype];
    if (!ext) return reply.code(415).send({ error: `Unsupported type ${file.mimetype}` });
    const data = await file.toBuffer();
    const key = `${auth.orgId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
    await storage.put(key, data, file.mimetype);
    const obj = await db().fileObject.create({
      data: { orgId: auth.orgId, uploadedById: auth.userId, storageKey: key, contentType: file.mimetype, sizeBytes: data.length },
    });
    return { id: obj.id };
  });

  app.get<{ Params: { id: string } }>("/files/:id", async (req, reply) => {
    const auth = await requireAuth(req);
    const f = await db().fileObject.findFirst({ where: { id: req.params.id, orgId: auth.orgId } });
    if (!f) return reply.code(404).send({ error: "Not found" });
    // Workers can only fetch their own uploads.
    if (auth.role === "WORKER" && f.uploadedById !== auth.userId) return reply.code(404).send({ error: "Not found" });
    return reply.type(f.contentType).header("Cache-Control", "private, max-age=3600").send(storage.get(f.storageKey));
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
