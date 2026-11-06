import type { Tx } from "./db";

export async function audit(
  tx: Tx,
  a: {
    orgId: string;
    actorId: string | null;
    entityType: string;
    entityId: string;
    action: string;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
  },
) {
  await tx.auditLog.create({
    data: {
      orgId: a.orgId,
      actorId: a.actorId,
      entityType: a.entityType,
      entityId: a.entityId,
      action: a.action,
      before: a.before === undefined ? undefined : JSON.parse(JSON.stringify(a.before)),
      after: a.after === undefined ? undefined : JSON.parse(JSON.stringify(a.after)),
      reason: a.reason ?? null,
    },
  });
}
