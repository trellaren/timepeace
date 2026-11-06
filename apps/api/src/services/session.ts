import type { Role } from "@timepeace/shared";
import { env } from "../env";
import { hashToken, newSessionToken } from "../lib/crypto";
import type { Tx } from "../lib/db";

/** Creates a session and returns what the clients store after signing in (login and invite accept). */
export async function startSession(
  tx: Tx,
  user: { id: string; name: string; email: string },
  membership: { role: Role; org: { id: string; name: string; timezone: string } },
) {
  const token = newSessionToken();
  await tx.session.create({
    data: {
      tokenHash: hashToken(token),
      userId: user.id,
      orgId: membership.org.id,
      expiresAt: new Date(Date.now() + env.sessionTtlDays * 86_400_000),
    },
  });
  return {
    token,
    user: { id: user.id, name: user.name, email: user.email },
    role: membership.role,
    org: { id: membership.org.id, name: membership.org.name, timezone: membership.org.timezone },
  };
}
