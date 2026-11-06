import { createPrismaClient, type PrismaClient } from "@timepeace/db";

let client: PrismaClient | undefined;

export function db(): PrismaClient {
  client ??= createPrismaClient();
  return client;
}

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
