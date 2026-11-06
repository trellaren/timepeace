import { TRPCError } from "@trpc/server";
import type { AuthInfo } from "../context";
import type { Tx } from "../lib/db";
import { db } from "../lib/db";
import { MANAGER_ROLES, FINANCE_ROLES } from "../trpc";

export function isManager(auth: AuthInfo) {
  return MANAGER_ROLES.includes(auth.role);
}

/** Projects a user may see: managers/finance see all in org; workers see projects with an assignment. */
export function projectScope(auth: AuthInfo) {
  if (FINANCE_ROLES.includes(auth.role)) return { orgId: auth.orgId };
  return { orgId: auth.orgId, tasks: { some: { assignments: { some: { userId: auth.userId } } } } };
}

export async function assertProjectAccess(auth: AuthInfo, projectId: string, tx: Tx = db()) {
  const p = await tx.project.findFirst({ where: { id: projectId, ...projectScope(auth) }, select: { id: true } });
  if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
}

/** Workers may act on tasks they're assigned to; managers on any task in the org. */
export async function assertTaskAccess(auth: AuthInfo, taskId: string, tx: Tx = db()) {
  const task = await tx.task.findFirst({
    where: {
      id: taskId,
      project: { orgId: auth.orgId },
      ...(isManager(auth) ? {} : { assignments: { some: { userId: auth.userId } } }),
    },
  });
  if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  return task;
}
