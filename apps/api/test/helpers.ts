import { randomUUID } from "node:crypto";
import { resolveAuth } from "../src/context";
import { appRouter } from "../src/router";
import { createCallerFactory } from "../src/trpc";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const createCaller = createCallerFactory(appRouter);

export async function loginAs(email: string) {
  const anon = createCaller({ auth: null });
  const res = await anon.auth.login({ email, password: "timepeace" });
  const auth = await resolveAuth(res.token);
  return { caller: createCaller({ auth }), auth: auth!, token: res.token };
}

export const uuid = () => randomUUID();
