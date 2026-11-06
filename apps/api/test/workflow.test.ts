import { describe, expect, it } from "vitest";
import { loginAs, uuid } from "./helpers";

describe("auth & RBAC", () => {
  it("rejects bad passwords", async () => {
    await expect(loginAs("nobody@acme.test")).rejects.toThrow(/Invalid email or password/);
  });

  it("workers cannot reach manager, finance, or payroll procedures", async () => {
    const { caller } = await loginAs("sam@acme.test");
    await expect(caller.approvals.timesheets()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.finance.portfolio()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.payroll.periods()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("workers only see projects they are assigned to", async () => {
    const { caller } = await loginAs("sam@acme.test");
    const projects = await caller.projects.list();
    expect(projects.map((p) => p.name)).toEqual(["Maple Ridge Lot 14"]);
  });

  it("HR cannot see project finance", async () => {
    const { caller } = await loginAs("hr@acme.test");
    await expect(caller.finance.portfolio()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("field sync (offline outbox)", () => {
  it("pays the whole shift; task timers only allocate it (start → switch → stop inside a shift), idempotent on retry", async () => {
    const { caller } = await loginAs("sam@acme.test");
    const day = await caller.field.myDay();
    // Seed leaves Sam clocked in on a task this morning; clock out first.
    expect(day.shift).not.toBeNull();
    await caller.field.sync({ ops: [{ opId: uuid(), type: "shift.clockOut", at: new Date().toISOString(), payload: { shiftId: day.shift!.shiftId } }] });
    expect((await caller.field.myDay()).running).toBeNull(); // clock-out stopped the task timer

    const open = day.tasks.filter((t) => t.status !== "DONE");
    const [t1, t2] = [open[0]!, open[1]!];
    const shiftId = uuid();
    const e1 = uuid();
    const e2 = uuid();
    const base = Date.now() + 60_000;
    const at = (min: number) => new Date(base + min * 60_000).toISOString();
    const ops = [
      { opId: uuid(), type: "shift.clockIn" as const, at: at(0), payload: { shiftId, projectId: t1.project.id, geo: { lat: 40.16, lng: -105.1 } } },
      { opId: uuid(), type: "time.start" as const, at: at(5), payload: { entryId: e1, taskId: t1.id, projectId: t1.project.id } },
      { opId: uuid(), type: "time.start" as const, at: at(35), payload: { entryId: e2, taskId: t2.id, projectId: t2.project.id } },
      { opId: uuid(), type: "task.status" as const, at: at(36), payload: { taskId: t1.id, status: "DONE" as const } },
      { opId: uuid(), type: "time.stop" as const, at: at(80), payload: { entryId: e2 } },
      { opId: uuid(), type: "shift.clockOut" as const, at: at(95), payload: { shiftId } },
    ];
    const first = await caller.field.sync({ ops });
    expect(first.map((r) => r.status)).toEqual(Array(6).fill("applied"));
    const retry = await caller.field.sync({ ops });
    expect(retry.map((r) => r.status)).toEqual(Array(6).fill("duplicate"));

    const period = await caller.field.myPeriod();
    const shift = period.shifts.find((x) => x.id === shiftId)!;
    expect(shift.entries.map((e) => e.minutes)).toEqual([30, 45]);
    expect(shift.paidMinutes).toBe(95); // paid for the full shift…
    expect(shift.allocatedMinutes).toBe(75); // …of which 75 min were on tasks
    expect(shift.unallocatedMinutes).toBe(20);
    expect((await caller.field.myDay()).tasks.find((t) => t.id === t1.id)?.status).toBe("DONE");
  });

  it("a meal break of 20+ min is unpaid; a short break stays paid", async () => {
    const { caller } = await loginAs("tyler@acme.test");
    const day = await caller.field.myDay();
    if (day.shift) await caller.field.sync({ ops: [{ opId: uuid(), type: "shift.clockOut", at: new Date().toISOString(), payload: { shiftId: day.shift.shiftId } }] });
    const base = Date.now() + 5 * 60_000;
    const at = (min: number) => new Date(base + min * 60_000).toISOString();
    const shiftId = uuid();
    const rest = uuid();
    const lunch = uuid();
    const res = await caller.field.sync({
      ops: [
        { opId: uuid(), type: "shift.clockIn", at: at(0), payload: { shiftId } },
        { opId: uuid(), type: "shift.breakStart", at: at(60), payload: { shiftId, breakId: rest } },
        { opId: uuid(), type: "shift.breakEnd", at: at(70), payload: { shiftId, breakId: rest } }, // 10-min rest break: paid
        { opId: uuid(), type: "shift.breakStart", at: at(180), payload: { shiftId, breakId: lunch } },
        { opId: uuid(), type: "shift.breakEnd", at: at(210), payload: { shiftId, breakId: lunch } }, // 30-min meal: unpaid
        { opId: uuid(), type: "shift.clockOut", at: at(300), payload: { shiftId } },
      ],
    });
    expect(res.every((r) => r.status === "applied")).toBe(true);
    const p3 = await caller.field.myPeriod();
    expect(p3.shifts.find((x) => x.id === shiftId)!.paidMinutes).toBe(300 - 30);
  });

  it("starting a task with no open shift clocks the worker in (older clients)", async () => {
    const { caller } = await loginAs("dana@acme.test");
    const day = await caller.field.myDay();
    if (day.shift) await caller.field.sync({ ops: [{ opId: uuid(), type: "shift.clockOut", at: new Date().toISOString(), payload: { shiftId: day.shift.shiftId } }] });
    const task = day.tasks.find((t) => t.status !== "DONE")!;
    await caller.field.sync({ ops: [{ opId: uuid(), type: "time.start", at: new Date(Date.now() + 120_000).toISOString(), payload: { entryId: uuid(), taskId: task.id, projectId: task.project.id } }] });
    const after = await caller.field.myDay();
    expect(after.shift).not.toBeNull();
    expect(after.running?.taskId).toBe(task.id);
  });

  it("clocking in while an old shift is still open auto-closes it at the last activity and flags it", async () => {
    const { caller } = await loginAs("dana@acme.test");
    const before = await caller.field.myDay();
    const oldShiftId = before.shift!.shiftId;
    await caller.field.sync({ ops: [{ opId: uuid(), type: "shift.clockIn", at: new Date(Date.now() + 10 * 3_600_000).toISOString(), payload: { shiftId: uuid() } }] });
    const period = await caller.field.myPeriod();
    const old = period.shifts.find((x) => x.id === oldShiftId)!;
    expect(old.flag).toBe("AUTO_CLOSED");
    expect(old.clockOutAt).not.toBeNull();
  });

  it("rejects ops on tasks the worker isn't assigned to, without blocking later ops", async () => {
    const { caller } = await loginAs("tyler@acme.test");
    const sam = await loginAs("sam@acme.test");
    const samTask = (await sam.caller.field.myDay()).tasks[0]!;
    const tylerTask = (await caller.field.myDay()).tasks[0]!;
    const res = await caller.field.sync({
      ops: [
        { opId: uuid(), type: "task.status", at: new Date().toISOString(), payload: { taskId: samTask.id, status: "BLOCKED", note: "x" } },
        { opId: uuid(), type: "material.request", at: new Date().toISOString(), payload: { requestId: uuid(), taskId: tylerTask.id, description: "Box of 3\" screws", quantity: "2" } },
      ],
    });
    expect(res.map((r) => r.status)).toEqual(["rejected", "applied"]);
  });

  it("records an expense with tax category derived from cost category", async () => {
    const { caller } = await loginAs("jake@acme.test");
    const targets = await caller.field.expenseTargets();
    const p = targets[0]!;
    const expenseId = uuid();
    const res = await caller.field.sync({
      ops: [{ opId: uuid(), type: "expense.create", at: new Date().toISOString(), payload: { expenseId, projectId: p.id, taskId: p.tasks[0]!.id, vendorName: "home depot", amountCents: 2997, salesTaxCents: 226, category: "OTHER", paidBy: "PERSONAL", spentOn: "2026-11-05" } }],
    });
    expect(res[0]!.status).toBe("applied");
    const mine = await caller.field.myExpenses();
    const e = mine.find((x) => x.id === expenseId)!;
    expect(e).toMatchObject({ vendorName: "home depot", taxCategory: "other", status: "SUBMITTED" });
    expect(e.vendorId).not.toBeNull(); // matched "Home Depot" case-insensitively
  });
});

describe("timesheet → approval → payroll export", () => {
  it("manager approves submitted sheets; HR exports CSV with matching totals; paid closes the loop", async () => {
    const mgr = await loginAs("manager@acme.test");
    const queue = await mgr.caller.approvals.timesheets();
    const jake = queue.find((t) => t.user.name === "Jake Turner")!;
    // Jake worked a Saturday that week → weekly OT
    expect(jake.totals.overtimeMinutes).toBeGreaterThan(0);
    expect(jake.totals.regularMinutes).toBe(2400);

    // Rejection requires a note
    await expect(mgr.caller.approvals.reviewTimesheet({ timesheetId: jake.id, decision: "REJECT" })).rejects.toThrow(/note/);

    for (const t of queue) await mgr.caller.approvals.reviewTimesheet({ timesheetId: t.id, decision: "APPROVE" });

    // Paid time comes from shifts, so it covers more than the task timers did.
    expect(jake.totals.totalMinutes).toBeGreaterThan(jake.allocatedMinutes);

    // Locked: manager can no longer edit shifts in that period
    const s0 = jake.shifts[0]!;
    await expect(
      mgr.caller.approvals.editShift({ id: s0.id, clockInAt: s0.clockInAt.toISOString(), clockOutAt: s0.clockOutAt!.toISOString(), reason: "fix" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const hr = await loginAs("hr@acme.test");
    const periods = await hr.caller.payroll.periods();
    const target = periods.find((p) => p.start === jake.period.start)!;
    const detail = await hr.caller.payroll.period({ payPeriodId: target.id });
    const jakeRow = detail.rows.find((r) => r.name === "Jake Turner")!;
    expect(jakeRow.overtimeHours).toBe(jake.totals.overtimeMinutes / 60);
    // Jake's drill bits ($34.97, personal card, approved) are reimbursed
    expect(jakeRow.reimbursementCents).toBe(3497);
    const rosa = detail.rows.find((r) => r.classification === "CONTRACTOR_1099")!;
    expect(rosa.overtimeHours).toBe(0);

    const { exportId, timesheets } = await hr.caller.payroll.createExport({ payPeriodId: target.id, format: "GENERIC_CSV" });
    expect(timesheets).toBe(detail.rows.length);
    // Can't double-export
    await expect(hr.caller.payroll.createExport({ payPeriodId: target.id, format: "GENERIC_CSV" })).rejects.toThrow(/No approved/);

    const { buildApp } = await import("../src/app");
    const app = await buildApp();
    const csv = await app.inject({ method: "GET", url: `/payroll-exports/${exportId}/download`, headers: { authorization: `Bearer ${hr.token}` } });
    expect(csv.statusCode).toBe(200);
    const lines = csv.body.trim().split("\r\n");
    expect(lines[0]).toMatch(/^employee_name,email,classification/);
    const jakeLine = lines.find((l) => l.startsWith("Jake Turner"))!.split(",");
    expect(Number(jakeLine[6])).toBe(jake.totals.overtimeMinutes / 60);
    expect(jakeLine[10]).toBe("34.97");
    // Workers can't download payroll
    const sam = await loginAs("sam@acme.test");
    const denied = await app.inject({ method: "GET", url: `/payroll-exports/${exportId}/download`, headers: { authorization: `Bearer ${sam.token}` } });
    expect(denied.statusCode).toBe(403);
    await app.close();

    await hr.caller.payroll.markPaid({ exportId });
    const after = await hr.caller.payroll.periods();
    expect(after.find((p) => p.id === target.id)!.counts.PAID).toBe(timesheets);
  });

  it("worker can't log time into a locked period", async () => {
    const { caller } = await loginAs("sam@acme.test");
    const prev = await caller.field.myPeriod({ offset: -1 });
    expect(prev.timesheet?.status).toBe("PAID");
    const task = (await caller.field.myDay()).tasks[0]!;
    const res = await caller.field.sync({
      ops: [{ opId: uuid(), type: "shift.clockIn", at: new Date(`${prev.period.start}T18:00:00Z`).toISOString(), payload: { shiftId: uuid(), projectId: task.project.id } }],
    });
    expect(res[0]).toMatchObject({ status: "rejected", error: expect.stringMatching(/locked/) });
  });

  it("worker submits the current week after clocking out", async () => {
    const { caller } = await loginAs("luis@acme.test");
    const day = await caller.field.myDay();
    const period = await caller.field.myPeriod();
    expect(day.shift).not.toBeNull();
    await expect(caller.field.submitTimesheet({ payPeriodId: period.period.id })).rejects.toThrow(/Clock out/);
    await caller.field.sync({ ops: [{ opId: uuid(), type: "shift.clockOut", at: new Date().toISOString(), payload: { shiftId: day.shift!.shiftId } }] });
    const ts = await caller.field.submitTimesheet({ payPeriodId: period.period.id });
    expect(ts.status).toBe("SUBMITTED");
    await expect(caller.field.submitTimesheet({ payPeriodId: period.period.id })).rejects.toThrow(/already submitted/);
  });
});

describe("projects & finance", () => {
  it("creates a project from a template with phases and tasks", async () => {
    const { caller } = await loginAs("manager@acme.test");
    const templates = await caller.org.templates();
    const p = await caller.projects.create({ name: "Test Build", clientName: "Test Client", templateId: templates.find((t) => t.name.includes("new build"))!.id, contractValueCents: 300_000_00, contractType: "FIXED" });
    const full = await caller.projects.get({ id: p.id });
    expect(full.phases.length).toBe(5);
    expect(full.tasks.length).toBe(19);
    expect(full.projectType).toBe("New build");
    expect(full.tasks.every((t) => t.costCodeId)).toBe(true);
  });

  it("job cost rolls up labor and expenses for a project", async () => {
    const { caller } = await loginAs("owner@acme.test");
    const projects = await caller.projects.list();
    const maple = projects.find((p) => p.name === "Maple Ridge Lot 14")!;
    const jc = await caller.projects.jobCost({ id: maple.id });
    expect(jc.revenueCents).toBe(485_000_00 + 12_500_00);
    expect(jc.byCategory.LABOR.actualCents).toBeGreaterThan(0);
    expect(jc.byCategory.MATERIAL.actualCents).toBeGreaterThan(0);
    expect(jc.totalActualCents).toBe(Object.values(jc.byCategory).reduce((a, c) => a + c.actualCents, 0));
    expect(jc.receivedCents).toBe(97_000_00);
  });
});
