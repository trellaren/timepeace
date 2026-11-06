import type { Role } from "@timepeace/shared";
import type { FastifyRequest } from "fastify";
import { hashToken } from "./lib/crypto";
import { db } from "./lib/db";

export interface AuthInfo {
  userId: string;
  orgId: string;
  role: Role;
  sessionId: string;
  name: string;
  email: string;
}

export interface Context {
  auth: AuthInfo | null;
}

export function bearerToken(req: Pick<FastifyRequest, "headers">): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

export async function resolveAuth(token: string | null): Promise<AuthInfo | null> {
  if (!token) return null;
  const session = await db().session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { memberships: true } } },
  });
  if (!session || session.expiresAt < new Date()) return null;
  const membership = session.user.memberships.find((m) => m.orgId === session.orgId && m.active);
  if (!membership) return null;
  // Touch lastUsedAt at most once a minute.
  if (Date.now() - session.lastUsedAt.getTime() > 60_000) {
    await db().session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
  }
  return {
    userId: session.userId,
    orgId: session.orgId,
    role: membership.role,
    sessionId: session.id,
    name: session.user.name,
    email: session.user.email,
  };
}

export async function createContext({ req }: { req: FastifyRequest }): Promise<Context> {
  return { auth: await resolveAuth(bearerToken(req)) };
}
