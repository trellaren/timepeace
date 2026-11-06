import { Prisma, dbDate } from "@timepeace/db";
import { defaultTaxCategoryFor, type OutboxOp, type SyncOpResult } from "@timepeace/shared";
import { TRPCError } from "@trpc/server";
import type { AuthInfo } from "../context";
import { db, type Tx } from "../lib/db";
import { assertProjectAccess, assertTaskAccess } from "./access";
import { assertPeriodOpen } from "./timesheet";

/**
 * Apply offline outbox ops from a mobile device, in order. Each op is idempotent on opId
 * (recorded in ProcessedOp) and also on its entity id (time entry / expense / request id).
 * One failing op does not block the rest; the device surfaces rejected ops to the user.
 */
export async function applyOps(auth: AuthInfo, ops: OutboxOp[]): Promise<SyncOpResult[]> {
  const results: SyncOpResult[] = [];
  for (const op of ops) {
    const seen = await db().processedOp.findUnique({ where: { opId: op.opId } });
    if (seen) {
      results.push(
        seen.status === "rejected"
          ? { opId: op.opId, status: "rejected", error: seen.error ?? undefined }
          : { opId: op.opId, status: "duplicate" },
      );
      continue;
    }
    try {
      await db().$transaction(async (tx) => {
        await applyOp(tx, auth, op);
        await tx.processedOp.create({ data: { opId: op.opId, userId: auth.userId, type: op.type, status: "applied" } });
      });
      results.push({ opId: op.opId, status: "applied" });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // Unique violation on opId: a concurrent retry already applied it.
        results.push({ opId: op.opId, status: "duplicate" });
        continue;
      }
      // Infrastructure errors abort the batch so the device retries later, in order.
      if (!(err instanceof TRPCError)) throw err;
      // Business-rule rejections are final and recorded so retries get the same answer.
      await db().processedOp.create({
        data: { opId: op.opId, userId: auth.userId, type: op.type, status: "rejected", error: err.message },
      });
      results.push({ opId: op.opId, status: "rejected", error: err.message });
    }
  }
  return results;
}

async function applyOp(tx: Tx, auth: AuthInfo, op: OutboxOp) {
  const at = new Date(op.at);
  const org = await tx.organization.findUniqueOrThrow({ where: { id: auth.orgId } });

  switch (op.type) {
    case "shift.clockIn": {
      const { shiftId, projectId, geo } = op.payload;
      if (await tx.shift.findUnique({ where: { id: shiftId } })) return;
      await assertPeriodOpen(tx, org, auth.userId, at);
      if (projectId) await assertProjectAccess(auth, projectId, tx);
      await autoCloseOpenShifts(tx, auth.userId, at);
      await tx.shift.create({
        data: { id: shiftId, orgId: auth.orgId, userId: auth.userId, projectId: projectId ?? null, clockInAt: at, inLat: geo?.lat, inLng: geo?.lng },
      });
      return;
    }
    case "shift.clockOut": {
      const { shiftId, geo, note } = op.payload;
      const shift = await tx.shift.findFirst({ where: { id: shiftId, userId: auth.userId } });
      if (!shift) throw new TRPCError({ code: "NOT_FOUND", message: "Shift not found" });
      if (shift.clockOutAt) return;
      const end = shift.clockInAt > at ? shift.clockInAt : at;
      // Clocking out ends any running task timer and open break at the same instant.
      for (const e of await tx.timeEntry.findMany({ where: { shiftId, endedAt: null } })) {
        await tx.timeEntry.update({ where: { id: e.id }, data: { endedAt: e.startedAt > end ? e.startedAt : end } });
      }
      await tx.shiftBreak.updateMany({ where: { shiftId, endedAt: null }, data: { endedAt: end } });
      await tx.shift.update({ where: { id: shiftId }, data: { clockOutAt: end, outLat: geo?.lat, outLng: geo?.lng, note: note ?? shift.note } });
      return;
    }
    case "shift.breakStart": {
      const { shiftId, breakId } = op.payload;
      const shift = await tx.shift.findFirst({ where: { id: shiftId, userId: auth.userId } });
      if (!shift) throw new TRPCError({ code: "NOT_FOUND", message: "Shift not found" });
      if (shift.clockOutAt) throw new TRPCError({ code: "CONFLICT", message: "That shift has already ended" });
      if (await tx.shiftBreak.findUnique({ where: { id: breakId } })) return;
      for (const e of await tx.timeEntry.findMany({ where: { shiftId, endedAt: null } })) {
        await tx.timeEntry.update({ where: { id: e.id }, data: { endedAt: e.startedAt > at ? e.startedAt : at } });
      }
      await tx.shiftBreak.create({ data: { id: breakId, shiftId, startedAt: at } });
      return;
    }
    case "shift.breakEnd": {
      const { shiftId, breakId } = op.payload;
      const br = await tx.shiftBreak.findFirst({ where: { id: breakId, shiftId, shift: { userId: auth.userId } } });
      if (!br) throw new TRPCError({ code: "NOT_FOUND", message: "Break not found" });
      if (br.endedAt) return;
      await tx.shiftBreak.update({ where: { id: br.id }, data: { endedAt: br.startedAt > at ? br.startedAt : at } });
      return;
    }
    case "time.start": {
      const { entryId, taskId, projectId, geo } = op.payload;
      const task = await assertTaskAccess(auth, taskId, tx);
      if (task.projectId !== projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "Task is not in that project" });
      await assertPeriodOpen(tx, org, auth.userId, at);
      if (await tx.timeEntry.findUnique({ where: { id: entryId } })) return;

      // Single running timer: close anything still open at the switch instant.
      const running = await tx.timeEntry.findMany({ where: { userId: auth.userId, endedAt: null } });
      for (const r of running) {
        await tx.timeEntry.update({ where: { id: r.id }, data: { endedAt: r.startedAt > at ? r.startedAt : at } });
      }
      // Task time always sits inside a paid shift. Devices send shift.clockIn first; this covers older clients.
      let shift = await tx.shift.findFirst({ where: { userId: auth.userId, clockOutAt: null }, orderBy: { clockInAt: "desc" } });
      if (!shift) {
        shift = await tx.shift.create({ data: { orgId: auth.orgId, userId: auth.userId, projectId, clockInAt: at, inLat: geo?.lat, inLng: geo?.lng } });
      }
      await tx.shiftBreak.updateMany({ where: { shiftId: shift.id, endedAt: null }, data: { endedAt: at } });
      await tx.timeEntry.create({
        data: {
          id: entryId,
          orgId: auth.orgId,
          userId: auth.userId,
          shiftId: shift.id,
          projectId,
          taskId,
          startedAt: at,
          source: "TIMER",
          startLat: geo?.lat,
          startLng: geo?.lng,
        },
      });
      if (task.status === "TODO") await setTaskStatus(tx, auth, task, "IN_PROGRESS", null, at);
      return;
    }
    case "time.stop": {
      const { entryId, geo, note } = op.payload;
      const entry = await tx.timeEntry.findFirst({ where: { id: entryId, userId: auth.userId } });
      if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: "Time entry not found" });
      if (entry.endedAt) return; // already closed (e.g. by a later switch)
      await tx.timeEntry.update({
        where: { id: entry.id },
        data: { endedAt: entry.startedAt > at ? entry.startedAt : at, endLat: geo?.lat, endLng: geo?.lng, note: note ?? entry.note },
      });
      return;
    }
    case "task.status": {
      const { taskId, status, note } = op.payload;
      const task = await assertTaskAccess(auth, taskId, tx);
      // Last write wins by device time; ignore stale updates that arrive late.
      if (task.statusChangedAt && task.statusChangedAt > at) return;
      if (task.status === "VERIFIED") throw new TRPCError({ code: "CONFLICT", message: "Task has been verified by a manager" });
      await setTaskStatus(tx, auth, task, status, note ?? null, at);
      return;
    }
    case "material.request": {
      const p = op.payload;
      await assertTaskAccess(auth, p.taskId, tx);
      if (await tx.materialRequest.findUnique({ where: { id: p.requestId } })) return;
      await tx.materialRequest.create({
        data: {
          id: p.requestId,
          taskId: p.taskId,
          requestedById: auth.userId,
          description: p.description,
          quantity: p.quantity,
          neededBy: p.neededBy ? dbDate(p.neededBy) : null,
        },
      });
      return;
    }
    case "expense.create": {
      const p = op.payload;
      await assertProjectAccess(auth, p.projectId, tx);
      if (await tx.expense.findUnique({ where: { id: p.expenseId } })) return;
      let costCodeId: string | null = null;
      if (p.taskId) {
        const task = await assertTaskAccess(auth, p.taskId, tx);
        if (task.projectId !== p.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "Task is not in that project" });
        costCodeId = task.costCodeId;
      }
      if (p.receiptFileId) {
        const f = await tx.fileObject.findFirst({ where: { id: p.receiptFileId, orgId: auth.orgId, uploadedById: auth.userId } });
        if (!f) throw new TRPCError({ code: "BAD_REQUEST", message: "Receipt file not found" });
      }
      const vendor = await tx.vendor.findFirst({ where: { orgId: auth.orgId, name: { equals: p.vendorName, mode: "insensitive" } } });
      await tx.expense.create({
        data: {
          id: p.expenseId,
          orgId: auth.orgId,
          userId: auth.userId,
          projectId: p.projectId,
          taskId: p.taskId,
          costCodeId,
          vendorId: vendor?.id,
          vendorName: p.vendorName,
          amountCents: p.amountCents,
          salesTaxCents: p.salesTaxCents,
          category: p.category,
          taxCategory: defaultTaxCategoryFor(p.category),
          paidBy: p.paidBy,
          spentOn: dbDate(p.spentOn),
          note: p.note,
          receiptFileId: p.receiptFileId,
        },
      });
      return;
    }
  }
}

/**
 * A worker clocking in while an older shift is still open forgot to clock out. Close the old
 * shift at its last recorded activity (never later, never earlier) and flag it so a manager
 * confirms the real end time before the timesheet can be approved.
 */
async function autoCloseOpenShifts(tx: Tx, userId: string, before: Date) {
  const open = await tx.shift.findMany({ where: { userId, clockOutAt: null, clockInAt: { lt: before } }, include: { timeEntries: true, breaks: true } });
  for (const s of open) {
    const times = [s.clockInAt, ...s.timeEntries.flatMap((e) => [e.startedAt, e.endedAt]), ...s.breaks.flatMap((b) => [b.startedAt, b.endedAt])].filter(
      (d): d is Date => d != null,
    );
    const last = new Date(Math.max(...times.map((d) => d.getTime())));
    for (const e of s.timeEntries.filter((e) => !e.endedAt)) await tx.timeEntry.update({ where: { id: e.id }, data: { endedAt: last } });
    await tx.shiftBreak.updateMany({ where: { shiftId: s.id, endedAt: null }, data: { endedAt: last } });
    await tx.shift.update({ where: { id: s.id }, data: { clockOutAt: last, flag: "AUTO_CLOSED", note: "No clock-out recorded; closed at last activity. Manager to confirm." } });
  }
}

export async function setTaskStatus(
  tx: Tx,
  auth: AuthInfo,
  task: { id: string; status: string },
  to: "TODO" | "IN_PROGRESS" | "NEEDS_MATERIALS" | "BLOCKED" | "DONE" | "VERIFIED",
  note: string | null,
  at: Date,
) {
  if (task.status === to && note == null) return;
  const done = to === "DONE" || to === "VERIFIED";
  await tx.task.update({
    where: { id: task.id },
    data: {
      status: to,
      statusNote: note,
      statusChangedAt: at,
      ...(done ? { completedAt: at, completedById: auth.userId } : { completedAt: null, completedById: null }),
    },
  });
  await tx.taskStatusEvent.create({
    data: { taskId: task.id, userId: auth.userId, from: task.status as never, to, note, at },
  });
}
