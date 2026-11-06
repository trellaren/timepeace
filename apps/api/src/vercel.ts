/**
 * Vercel Function entry. Fastify is booted once per instance and reused across requests
 * (Fluid compute keeps instances warm); each request is handed to Fastify's HTTP server.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildApp } from "./app";

const ready = buildApp().then(async (app) => {
  await app.ready();
  return app;
});

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await ready;
  app.server.emit("request", req, res);
}
