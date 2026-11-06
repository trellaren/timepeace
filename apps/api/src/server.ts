import { buildApp } from "./app";
import { env } from "./env";

const app = await buildApp();
await app.listen({ port: env.port, host: "0.0.0.0" });
