/**
 * Demo data: "Acme Homes", a small Colorado home builder.
 * Dates are relative to today so the demo always has a current week, a week awaiting
 * approval, and an approved week ready for payroll export.
 *
 * All demo users share the password "timepeace".
 */
import bcrypt from "bcryptjs";
import {
  FLSA_RULES,
  NO_OVERTIME_RULES,
  addDays,
  computeOvertime,
  dayOfWeek,
  grossPayCents,
  payPeriodFor,
  startOfWeek,
  toLocalDate,
  zonedTimeToUtc,
  type LocalDate,
} from "@timepeace/shared";
import { createPrismaClient, dbDate } from "../src/index";
import type { CostCategory, Role, TaskStatus } from "../src/generated/prisma/client";

const prisma = createPrismaClient();
const TZ = "America/Denver";
const PASSWORD = "timepeace";

// Deterministic PRNG so the seed is reproducible.
let rngState = 42;
const rand = () => {
  rngState = (rngState * 1103515245 + 12345) % 2 ** 31;
  return rngState / 2 ** 31;
};
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;

const COST_CODES = [
  ["01", "General Conditions"],
  ["02", "Sitework & Excavation"],
  ["03", "Concrete & Foundation"],
  ["06", "Framing"],
  ["07", "Roofing & Siding"],
  ["08", "Windows & Doors"],
  ["15", "Plumbing"],
  ["16", "Electrical"],
  ["23", "HVAC"],
  ["09", "Drywall"],
  ["10", "Finishes & Trim"],
] as const;

type TemplateTask = { title: string; costCode: string; estimatedMinutes: number; estimatedMaterialCents: number };
const NEW_BUILD_TEMPLATE: { name: string; tasks: TemplateTask[] }[] = [
  {
    name: "Site & Foundation",
    tasks: [
      { title: "Stake lot & set grade", costCode: "02", estimatedMinutes: 16 * 60, estimatedMaterialCents: 40000 },
      { title: "Excavate footings", costCode: "02", estimatedMinutes: 24 * 60, estimatedMaterialCents: 0 },
      { title: "Form & pour footings", costCode: "03", estimatedMinutes: 40 * 60, estimatedMaterialCents: 850000 },
      { title: "Foundation walls & waterproofing", costCode: "03", estimatedMinutes: 48 * 60, estimatedMaterialCents: 1200000 },
    ],
  },
  {
    name: "Framing",
    tasks: [
      { title: "Sill plate & floor system", costCode: "06", estimatedMinutes: 40 * 60, estimatedMaterialCents: 900000 },
      { title: "Frame exterior walls", costCode: "06", estimatedMinutes: 64 * 60, estimatedMaterialCents: 1400000 },
      { title: "Frame interior walls", costCode: "06", estimatedMinutes: 48 * 60, estimatedMaterialCents: 600000 },
      { title: "Set roof trusses & sheathing", costCode: "06", estimatedMinutes: 56 * 60, estimatedMaterialCents: 1500000 },
      { title: "Install windows & exterior doors", costCode: "08", estimatedMinutes: 24 * 60, estimatedMaterialCents: 1800000 },
    ],
  },
  {
    name: "Rough-ins",
    tasks: [
      { title: "Plumbing rough-in", costCode: "15", estimatedMinutes: 40 * 60, estimatedMaterialCents: 450000 },
      { title: "Electrical rough-in", costCode: "16", estimatedMinutes: 48 * 60, estimatedMaterialCents: 500000 },
      { title: "HVAC rough-in", costCode: "23", estimatedMinutes: 32 * 60, estimatedMaterialCents: 650000 },
      { title: "Rough-in inspection prep", costCode: "01", estimatedMinutes: 8 * 60, estimatedMaterialCents: 0 },
    ],
  },
  {
    name: "Close-in",
    tasks: [
      { title: "Roofing", costCode: "07", estimatedMinutes: 40 * 60, estimatedMaterialCents: 1100000 },
      { title: "Insulation", costCode: "09", estimatedMinutes: 16 * 60, estimatedMaterialCents: 380000 },
      { title: "Hang & finish drywall", costCode: "09", estimatedMinutes: 64 * 60, estimatedMaterialCents: 520000 },
    ],
  },
  {
    name: "Finishes",
    tasks: [
      { title: "Interior trim & doors", costCode: "10", estimatedMinutes: 48 * 60, estimatedMaterialCents: 650000 },
      { title: "Cabinets & countertops", costCode: "10", estimatedMinutes: 24 * 60, estimatedMaterialCents: 2200000 },
      { title: "Final punch list", costCode: "01", estimatedMinutes: 16 * 60, estimatedMaterialCents: 50000 },
    ],
  },
];

async function reset() {
  // Children before parents.
  await prisma.$transaction([
    prisma.processedOp.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.walkthroughItemResult.deleteMany(),
    prisma.walkthrough.deleteMany(),
    prisma.checklistTemplateItem.deleteMany(),
    prisma.checklistTemplate.deleteMany(),
    prisma.timeEntry.deleteMany(),
    prisma.shiftBreak.deleteMany(),
    prisma.shift.deleteMany(),
    prisma.expense.deleteMany(),
    prisma.timesheet.deleteMany(),
    prisma.payrollExport.deleteMany(),
    prisma.payPeriod.deleteMany(),
    prisma.materialRequest.deleteMany(),
    prisma.taskStatusEvent.deleteMany(),
    prisma.taskAssignment.deleteMany(),
    prisma.taskDependency.deleteMany(),
    prisma.task.deleteMany(),
    prisma.phase.deleteMany(),
    prisma.budgetLine.deleteMany(),
    prisma.changeOrder.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.dailyLog.deleteMany(),
    prisma.mileageLog.deleteMany(),
    prisma.project.deleteMany(),
    prisma.client.deleteMany(),
    prisma.payRate.deleteMany(),
    prisma.workerProfile.deleteMany(),
    prisma.vendor.deleteMany(),
    prisma.costCode.deleteMany(),
    prisma.projectTemplate.deleteMany(),
    prisma.taxYearSettings.deleteMany(),
    prisma.fileObject.deleteMany(),
    prisma.session.deleteMany(),
    prisma.membership.deleteMany(),
    prisma.user.deleteMany(),
    prisma.organization.deleteMany(),
  ]);
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");
  await reset();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const today = toLocalDate(new Date(), TZ);
  const thisWeek = startOfWeek(today, 0);
  const payCfg = { type: "WEEKLY" as const, anchorDate: thisWeek, weekStartsOn: 0 };

  const org = await prisma.organization.create({
    data: {
      name: "Acme Homes",
      timezone: TZ,
      entityType: "S_CORP",
      payPeriodType: "WEEKLY",
      payPeriodAnchor: dbDate(thisWeek),
      weekStartsOn: 0,
      overtimeRules: { ...FLSA_RULES },
      defaultBurdenBps: 2500,
    },
  });

  // ── People ──
  const staff: { email: string; name: string; role: Role }[] = [
    { email: "owner@acme.test", name: "Olivia Owens", role: "OWNER" },
    { email: "manager@acme.test", name: "Marco Reyes", role: "MANAGER" },
    { email: "hr@acme.test", name: "Hana Kim", role: "HR" },
    { email: "accountant@acme.test", name: "Avery Price", role: "ACCOUNTANT" },
  ];
  const workers = [
    { email: "jake@acme.test", name: "Jake Turner", rate: 3400, crew: "A" },
    { email: "luis@acme.test", name: "Luis Ortega", rate: 3100, crew: "A" },
    { email: "sam@acme.test", name: "Sam Whitaker", rate: 2600, crew: "A" },
    { email: "dana@acme.test", name: "Dana Brooks", rate: 3800, crew: "B" },
    { email: "tyler@acme.test", name: "Tyler Nguyen", rate: 2400, crew: "B" },
    { email: "rosa@acme.test", name: "Rosa Delgado (Delgado Electric)", rate: 6500, crew: "SUB" },
  ];

  const users: Record<string, { id: string; name: string }> = {};
  for (const s of staff) {
    const u = await prisma.user.create({ data: { email: s.email, name: s.name, passwordHash } });
    await prisma.membership.create({ data: { orgId: org.id, userId: u.id, role: s.role } });
    users[s.email] = u;
  }

  const electricVendor = await prisma.vendor.create({
    data: {
      orgId: org.id,
      name: "Delgado Electric LLC",
      isSubcontractor: true,
      is1099Eligible: true,
      w9OnFile: true,
      tinLast4: "4417",
    },
  });
  const vendors = await Promise.all(
    [
      { name: "Home Depot", isSubcontractor: false },
      { name: "Front Range Lumber", isSubcontractor: false },
      { name: "Summit Concrete Supply", isSubcontractor: false },
      { name: "Peak Plumbing Co", isSubcontractor: true, is1099Eligible: true, w9OnFile: false },
      { name: "Front Range Excavating", isSubcontractor: true, is1099Eligible: true, w9OnFile: true },
      { name: "United Rentals", isSubcontractor: false },
    ].map((v) => prisma.vendor.create({ data: { orgId: org.id, ...v } })),
  );
  const vendorByName = Object.fromEntries([...vendors, electricVendor].map((v) => [v.name, v]));

  const workerRate: Record<string, number> = {};
  const workerIsContractor: Record<string, boolean> = {};
  for (const w of workers) {
    const u = await prisma.user.create({ data: { email: w.email, name: w.name, passwordHash } });
    await prisma.membership.create({ data: { orgId: org.id, userId: u.id, role: "WORKER" } });
    const isSub = w.crew === "SUB";
    await prisma.workerProfile.create({
      data: {
        orgId: org.id,
        userId: u.id,
        classification: isSub ? "CONTRACTOR_1099" : "W2",
        burdenBps: isSub ? 0 : null,
        vendorId: isSub ? electricVendor.id : null,
        payRates: { create: [{ hourlyRateCents: w.rate, effectiveDate: dbDate("2026-01-01") }] },
      },
    });
    users[w.email] = u;
    workerRate[u.id] = w.rate;
    workerIsContractor[u.id] = isSub;
  }

  // ── Reference data ──
  const costCodes: Record<string, { id: string; name: string }> = {};
  for (const [code, name] of COST_CODES) {
    costCodes[code] = await prisma.costCode.create({ data: { orgId: org.id, code, name } });
  }
  const template = await prisma.projectTemplate.create({
    data: { orgId: org.id, name: "Single-family new build", projectType: "New build", phases: NEW_BUILD_TEMPLATE },
  });
  await prisma.projectTemplate.create({
    data: {
      orgId: org.id,
      name: "Kitchen remodel",
      projectType: "Remodel",
      phases: [
        {
          name: "Demo & prep",
          tasks: [
            { title: "Protect floors & demo cabinets", costCode: "01", estimatedMinutes: 32 * 60, estimatedMaterialCents: 15000 },
            { title: "Haul-off & dumpster", costCode: "01", estimatedMinutes: 8 * 60, estimatedMaterialCents: 65000 },
          ],
        },
        {
          name: "Rough-ins",
          tasks: [
            { title: "Relocate sink plumbing", costCode: "15", estimatedMinutes: 12 * 60, estimatedMaterialCents: 60000 },
            { title: "New circuits & can lights", costCode: "16", estimatedMinutes: 16 * 60, estimatedMaterialCents: 90000 },
          ],
        },
        {
          name: "Finish",
          tasks: [
            { title: "Patch drywall & paint", costCode: "09", estimatedMinutes: 16 * 60, estimatedMaterialCents: 40000 },
            { title: "Install cabinets", costCode: "10", estimatedMinutes: 24 * 60, estimatedMaterialCents: 1400000 },
            { title: "Countertops & backsplash", costCode: "10", estimatedMinutes: 16 * 60, estimatedMaterialCents: 650000 },
          ],
        },
      ],
    },
  });

  await prisma.taxYearSettings.createMany({
    data: [
      // Verify each year: 1099-NEC threshold rose from $600 to $2,000 for payments made in 2026+.
      { orgId: org.id, year: 2025, form1099ThresholdCents: 60000, mileageRateMilliCents: 7000 },
      { orgId: org.id, year: 2026, form1099ThresholdCents: 200000, mileageRateMilliCents: 7250 },
    ],
  });

  await prisma.checklistTemplate.create({
    data: {
      orgId: org.id,
      name: "Pre-drywall walkthrough",
      items: {
        create: [
          ["Framing", "All walls plumb, straight, and to plan dimensions"],
          ["Framing", "Blocking installed for cabinets, grab bars, TV mounts"],
          ["Framing", "Fire blocking at required locations"],
          ["Electrical", "Boxes at correct heights; nail plates where needed"],
          ["Electrical", "Smoke/CO locations match plan"],
          ["Plumbing", "Supply lines pressure tested; stub-outs at correct heights"],
          ["HVAC", "Ducts sealed; returns in every bedroom"],
          ["Insulation", "No gaps or compression; vapor barrier intact"],
          ["General", "Photos taken of every wall before close-in"],
        ].map(([section, text], i) => ({ section, text: text!, sortOrder: i })),
      },
    },
  });

  // ── Clients & projects ──
  const [clientA, clientB, clientC] = (await Promise.all(
    [
      { name: "Hartley Family", email: "hartley@example.com" },
      { name: "Maria & Ben Ortiz", email: "ortiz@example.com" },
      { name: "Priya Shah", email: "pshah@example.com" },
    ].map((c) => prisma.client.create({ data: { orgId: org.id, ...c } })),
  )) as unknown as [{ id: string }, { id: string }, { id: string }];

  async function createProjectFromTemplate(opts: {
    name: string;
    clientId: string;
    projectType: string;
    contractType: "FIXED" | "COST_PLUS" | "T_AND_M";
    contractValueCents: number;
    address: string;
    status: "PLANNING" | "ACTIVE";
    startDate: LocalDate;
    phases: { name: string; tasks: TemplateTask[] }[];
    /** Number of tasks (in order) already complete. */
    doneCount: number;
    /** Budget lines are scaled so they total this amount. */
    targetBudgetCents: number;
    markupBps?: number;
  }) {
    const project = await prisma.project.create({
      data: {
        orgId: org.id,
        clientId: opts.clientId,
        name: opts.name,
        projectType: opts.projectType,
        contractType: opts.contractType,
        contractValueCents: opts.contractValueCents,
        markupBps: opts.markupBps ?? null,
        address: opts.address,
        status: opts.status,
        startDate: dbDate(opts.startDate),
        targetEndDate: dbDate(addDays(opts.startDate, 180)),
      },
    });
    const tasks: { id: string; title: string; costCode: string; status: TaskStatus }[] = [];
    const budget = new Map<string, number>();
    let idx = 0;
    for (const [pi, ph] of opts.phases.entries()) {
      const phase = await prisma.phase.create({ data: { projectId: project.id, name: ph.name, sortOrder: pi } });
      for (const [ti, t] of ph.tasks.entries()) {
        const status: TaskStatus = idx < opts.doneCount ? (idx < opts.doneCount - 2 ? "VERIFIED" : "DONE") : idx === opts.doneCount ? "IN_PROGRESS" : "TODO";
        const task = await prisma.task.create({
          data: {
            projectId: project.id,
            phaseId: phase.id,
            costCodeId: costCodes[t.costCode]!.id,
            title: t.title,
            estimatedMinutes: t.estimatedMinutes,
            estimatedMaterialCents: t.estimatedMaterialCents,
            sortOrder: ti,
            status,
            completedAt: status === "DONE" || status === "VERIFIED" ? new Date() : null,
          },
        });
        tasks.push({ id: task.id, title: t.title, costCode: t.costCode, status });
        // Budget: labor at a blended $32/h + 25% burden, materials from estimate, times a markup cushion.
        const laborBudget = Math.round((t.estimatedMinutes / 60) * 3200 * 1.25);
        const matBudget = t.estimatedMaterialCents;
        const isSubCode = ["02", "03", "15", "16", "23"].includes(t.costCode);
        const laborKey = `${t.costCode}:${isSubCode ? "SUB" : "LABOR"}`;
        budget.set(laborKey, (budget.get(laborKey) ?? 0) + laborBudget);
        if (matBudget > 0) budget.set(`${t.costCode}:MATERIAL`, (budget.get(`${t.costCode}:MATERIAL`) ?? 0) + matBudget);
        idx++;
      }
    }
    const rawTotal = [...budget.values()].reduce((a, b) => a + b, 0);
    const scale = opts.targetBudgetCents / rawTotal;
    for (const [key, raw] of budget) {
      const amount = Math.round((raw * scale) / 100_00) * 100_00; // round to $100
      const [code, category] = key.split(":") as [string, CostCategory];
      await prisma.budgetLine.create({
        data: { projectId: project.id, costCodeId: costCodes[code]!.id, category, amountCents: amount },
      });
    }
    return { project, tasks };
  }

  const maple = await createProjectFromTemplate({
    name: "Maple Ridge Lot 14",
    clientId: clientA.id,
    projectType: "New build",
    contractType: "FIXED",
    contractValueCents: 485_000_00,
    address: "1420 Maple Ridge Dr, Longmont, CO",
    status: "ACTIVE",
    startDate: addDays(today, -75),
    phases: NEW_BUILD_TEMPLATE,
    doneCount: 6,
    targetBudgetCents: 408_000_00,
  });
  const ortiz = await createProjectFromTemplate({
    name: "Ortiz Kitchen Remodel",
    clientId: clientB.id,
    projectType: "Remodel",
    contractType: "COST_PLUS",
    contractValueCents: 64_400_00,
    markupBps: 1500,
    address: "88 Juniper Ct, Boulder, CO",
    status: "ACTIVE",
    startDate: addDays(today, -20),
    phases: (await prisma.projectTemplate.findFirstOrThrow({ where: { name: "Kitchen remodel" } })).phases as never,
    doneCount: 2,
    targetBudgetCents: 56_000_00,
  });
  await createProjectFromTemplate({
    name: "Cedar Lane Addition",
    clientId: clientC.id,
    projectType: "Addition",
    contractType: "FIXED",
    contractValueCents: 142_000_00,
    address: "305 Cedar Ln, Louisville, CO",
    status: "PLANNING",
    startDate: addDays(today, 21),
    phases: NEW_BUILD_TEMPLATE.slice(0, 3),
    doneCount: 0,
    targetBudgetCents: 118_500_00,
  });

  await prisma.changeOrder.create({
    data: {
      projectId: maple.project.id,
      number: 1,
      title: "Upgrade to 9' basement walls",
      amountCents: 12_500_00,
      costImpactCents: 8_900_00,
      status: "APPROVED",
      approvedAt: new Date(),
    },
  });
  const inv = await prisma.invoice.create({
    data: {
      projectId: maple.project.id,
      number: "MR14-01",
      description: "Draw 1: foundation complete",
      amountCents: 97_000_00,
      issuedOn: dbDate(addDays(today, -40)),
      status: "PAID",
    },
  });
  await prisma.payment.create({ data: { invoiceId: inv.id, amountCents: 97_000_00, receivedOn: dbDate(addDays(today, -33)) } });

  // A task waiting on materials, with a request.
  const framingInterior = maple.tasks.find((t) => t.title === "Frame interior walls")!;
  await prisma.task.update({
    where: { id: framingInterior.id },
    data: { status: "NEEDS_MATERIALS", statusNote: "Short ~40 2x4x8 studs", statusChangedAt: zonedTimeToUtc(addDays(today, -1), 10 * 60, TZ) },
  });
  framingInterior.status = "NEEDS_MATERIALS";
  await prisma.taskStatusEvent.create({
    data: { taskId: framingInterior.id, userId: users["luis@acme.test"]!.id, from: "IN_PROGRESS", to: "NEEDS_MATERIALS", note: "Short ~40 2x4x8 studs", at: zonedTimeToUtc(addDays(today, -1), 10 * 60, TZ) },
  });
  await prisma.materialRequest.create({
    data: {
      taskId: framingInterior.id,
      requestedById: users["luis@acme.test"]!.id,
      description: "2x4x8 KD studs",
      quantity: "40",
      neededBy: dbDate(addDays(today, 1)),
    },
  });

  // ── Assignments: crew A on Maple Ridge, crew B on Ortiz, Rosa on rough-ins. ──
  const crewA = workers.filter((w) => w.crew === "A").map((w) => users[w.email]!.id);
  const crewB = workers.filter((w) => w.crew === "B").map((w) => users[w.email]!.id);
  const rosa = users["rosa@acme.test"]!.id;
  const openMaple = maple.tasks.filter((t) => t.status !== "VERIFIED" && t.status !== "DONE").slice(0, 3);
  const openOrtiz = ortiz.tasks.filter((t) => t.status !== "VERIFIED" && t.status !== "DONE").slice(0, 3);
  for (const t of openMaple) for (const u of crewA) await prisma.taskAssignment.create({ data: { taskId: t.id, userId: u, scheduledStart: dbDate(thisWeek), scheduledEnd: dbDate(addDays(thisWeek, 6)) } });
  for (const t of openOrtiz) for (const u of crewB) await prisma.taskAssignment.create({ data: { taskId: t.id, userId: u, scheduledStart: dbDate(thisWeek), scheduledEnd: dbDate(addDays(thisWeek, 6)) } });
  const elecMaple = maple.tasks.find((t) => t.title === "Electrical rough-in")!;
  const elecOrtiz = ortiz.tasks.find((t) => t.costCode === "16")!;
  await prisma.taskAssignment.create({ data: { taskId: elecMaple.id, userId: rosa, scheduledStart: dbDate(today) } });
  await prisma.taskAssignment.create({ data: { taskId: elecOrtiz.id, userId: rosa, scheduledStart: dbDate(addDays(today, -6)) } });

  // ── Shifts (paid time) with task time inside them: three weeks of history ──
  // Each day: clock in, ~15 min setup before the first task, a 30-min unpaid lunch, sometimes a
  // drive between tasks, and ~20 min cleanup after the last task. That non-task time is still paid.
  const doneMaple = maple.tasks.filter((t) => t.status === "VERIFIED" || t.status === "DONE");
  const doneOrtiz = ortiz.tasks.filter((t) => t.status === "VERIFIED" || t.status === "DONE");
  const weeks = [addDays(thisWeek, -14), addDays(thisWeek, -7), thisWeek];
  const shiftsByUserWeek = new Map<string, { start: Date; end: Date; breakMinutes: number; allocated: number }[]>();
  const at = (date: LocalDate, min: number) => zonedTimeToUtc(date, min, TZ);

  async function seedShift(o: {
    userId: string;
    projectId: string;
    date: LocalDate;
    weekStart: LocalDate;
    clockIn: number;
    clockOut: number | null; // null → still clocked in (today)
    lunch: [number, number] | null;
    tasks: [string, number, number | null][]; // taskId, start, end (null → running)
  }) {
    const shift = await prisma.shift.create({
      data: { orgId: org.id, userId: o.userId, projectId: o.projectId, clockInAt: at(o.date, o.clockIn), clockOutAt: o.clockOut == null ? null : at(o.date, o.clockOut) },
    });
    if (o.lunch) await prisma.shiftBreak.create({ data: { shiftId: shift.id, startedAt: at(o.date, o.lunch[0]), endedAt: at(o.date, o.lunch[1]) } });
    let allocated = 0;
    for (const [taskId, s0, e0] of o.tasks) {
      await prisma.timeEntry.create({
        data: { orgId: org.id, userId: o.userId, shiftId: shift.id, projectId: o.projectId, taskId, startedAt: at(o.date, s0), endedAt: e0 == null ? null : at(o.date, e0), source: "TIMER" },
      });
      if (e0 != null) allocated += e0 - s0;
    }
    if (o.clockOut != null) {
      const key = `${o.userId}|${o.weekStart}`;
      const list = shiftsByUserWeek.get(key) ?? [];
      list.push({ start: at(o.date, o.clockIn), end: at(o.date, o.clockOut), breakMinutes: o.lunch ? o.lunch[1] - o.lunch[0] : 0, allocated });
      shiftsByUserWeek.set(key, list);
    }
  }

  for (const [wi, weekStart] of weeks.entries()) {
    for (let dow = 1; dow <= 6; dow++) {
      const date = addDays(weekStart, dow);
      if (date > today) continue;
      const isSaturday = dayOfWeek(date) === 6;
      const crews: [string[], { id: string }[], string][] = [
        // Oldest week is spent finishing the tasks now marked done; later weeks on open tasks.
        [crewA, wi === 0 ? doneMaple.slice(-2) : openMaple, maple.project.id],
        [crewB, wi === 0 ? doneOrtiz : openOrtiz, ortiz.project.id],
      ];
      for (const [crew, taskPool, projectId] of crews) {
        for (const userId of crew) {
          // Saturday: only Jake works (creates weekly OT in week 2).
          if (isSaturday && !(userId === crewA[0] && wi === 1)) continue;
          const firstTask = 7 * 60 + Math.floor(rand() * 3) * 15;
          const clockIn = firstTask - 15;
          const lastTaskEnd = isSaturday ? 15 * 60 : 15 * 60 + 30 + Math.floor(rand() * 5) * 15;
          const afternoonStart = rand() < 0.3 ? 12 * 60 + 25 : 12 * 60; // sometimes a drive between sites
          const taskA = pick(taskPool).id;
          const taskB = pick(taskPool).id;
          if (date === today) {
            await seedShift({ userId, projectId, date, weekStart, clockIn, clockOut: null, lunch: null, tasks: [[taskA, firstTask, null]] });
          } else {
            await seedShift({
              userId,
              projectId,
              date,
              weekStart,
              clockIn,
              clockOut: lastTaskEnd + 20,
              lunch: [11 * 60 + 30, 12 * 60],
              tasks: [
                [taskA, firstTask, 11 * 60 + 30],
                [taskB, afternoonStart, lastTaskEnd],
              ],
            });
          }
        }
      }
    }
  }
  // Rosa (1099 electrician) works two long days last week on Ortiz.
  for (const d of [2, 3]) {
    const date = addDays(weeks[1]!, d);
    await seedShift({
      userId: rosa,
      projectId: ortiz.project.id,
      date,
      weekStart: weeks[1]!,
      clockIn: 6 * 60 + 50,
      clockOut: 17 * 60 + 40,
      lunch: [12 * 60, 12 * 60 + 30],
      tasks: [
        [elecOrtiz.id, 7 * 60, 12 * 60],
        [elecOrtiz.id, 12 * 60 + 30, 17 * 60 + 30],
      ],
    });
  }

  // ── Pay periods & timesheets: week -2 APPROVED, week -1 SUBMITTED, current week open ──
  // Hours come from SHIFTS (clock in → out minus the unpaid lunch), not from task timers.
  const approver = users["manager@acme.test"]!.id;
  for (const [wi, weekStart] of weeks.entries()) {
    const range = payPeriodFor(weekStart, payCfg);
    const period = await prisma.payPeriod.create({
      data: { orgId: org.id, startDate: dbDate(range.start), endDate: dbDate(range.end) },
    });
    if (wi === 2) continue; // current week: no timesheets yet (created on submit)
    for (const userId of [...crewA, ...crewB, rosa]) {
      const shifts = shiftsByUserWeek.get(`${userId}|${weekStart}`) ?? [];
      if (shifts.length === 0) continue;
      const contractor = workerIsContractor[userId]!;
      const ot = computeOvertime(shifts, contractor ? NO_OVERTIME_RULES : FLSA_RULES, TZ);
      const approved = wi === 0;
      const ts = await prisma.timesheet.create({
        data: {
          orgId: org.id,
          userId,
          payPeriodId: period.id,
          status: approved ? "APPROVED" : "SUBMITTED",
          submittedAt: zonedTimeToUtc(range.end, 17 * 60, TZ),
          reviewedById: approved ? approver : null,
          reviewedAt: approved ? zonedTimeToUtc(addDays(range.end, 2), 9 * 60, TZ) : null,
          ...(approved
            ? {
                regularMinutes: ot.regularMinutes,
                overtimeMinutes: ot.overtimeMinutes,
                doubleTimeMinutes: ot.doubleTimeMinutes,
                grossCents: grossPayCents(ot.days, () => workerRate[userId]!),
                allocatedMinutes: shifts.reduce((a, x) => a + x.allocated, 0),
              }
            : {}),
        },
      });
      const r = { gte: zonedTimeToUtc(range.start, 0, TZ), lt: zonedTimeToUtc(addDays(range.end, 1), 0, TZ) };
      await prisma.shift.updateMany({ where: { userId, clockInAt: r }, data: { timesheetId: ts.id } });
      await prisma.timeEntry.updateMany({ where: { userId, startedAt: r }, data: { timesheetId: ts.id } });
    }
  }

  // ── Expenses ──
  const exp = async (e: {
    user: string;
    projectId: string;
    taskId?: string;
    vendor: string;
    amount: number;
    tax?: number;
    category: CostCategory;
    taxCategory: string;
    paidBy: "COMPANY" | "PERSONAL";
    daysAgo: number;
    note?: string;
    costCode?: string;
    status?: "SUBMITTED" | "APPROVED";
  }) =>
    prisma.expense.create({
      data: {
        orgId: org.id,
        userId: users[e.user]!.id,
        projectId: e.projectId,
        taskId: e.taskId,
        costCodeId: e.costCode ? costCodes[e.costCode]!.id : null,
        vendorId: vendorByName[e.vendor]?.id,
        vendorName: e.vendor,
        amountCents: e.amount,
        // amountCents is the receipt total; salesTaxCents is the tax portion of it.
        salesTaxCents: e.tax ?? Math.round((e.amount * 0.0815) / 1.0815),
        category: e.category,
        taxCategory: e.taxCategory,
        paidBy: e.paidBy,
        spentOn: dbDate(addDays(today, -e.daysAgo)),
        note: e.note,
        status: e.status ?? (e.daysAgo > 7 ? "APPROVED" : "SUBMITTED"),
        reviewedById: (e.status ?? (e.daysAgo > 7 ? "APPROVED" : "SUBMITTED")) === "APPROVED" ? approver : null,
        reviewedAt: (e.status ?? (e.daysAgo > 7 ? "APPROVED" : "SUBMITTED")) === "APPROVED" ? new Date() : null,
      },
    });
  const mp = maple.project.id;
  const op = ortiz.project.id;
  await exp({ user: "manager@acme.test", projectId: mp, vendor: "Summit Concrete Supply", amount: 21_480_00, category: "MATERIAL", taxCategory: "job_materials", paidBy: "COMPANY", daysAgo: 60, costCode: "03" });
  await exp({ user: "manager@acme.test", projectId: mp, vendor: "Front Range Lumber", amount: 24_115_40, category: "MATERIAL", taxCategory: "job_materials", paidBy: "COMPANY", daysAgo: 30, costCode: "06" });
  await exp({ user: "manager@acme.test", projectId: mp, vendor: "Front Range Lumber", amount: 9_870_00, category: "MATERIAL", taxCategory: "job_materials", paidBy: "COMPANY", daysAgo: 12, costCode: "06" });
  // Earlier phases (before the time-tracking history in this seed) were done by subs.
  await exp({ user: "manager@acme.test", projectId: mp, vendor: "Front Range Excavating", amount: 14_800_00, tax: 0, category: "SUB", taxCategory: "job_subcontractors", paidBy: "COMPANY", daysAgo: 70, costCode: "02", note: "Excavation, backfill, grading (fixed bid)" });
  await exp({ user: "manager@acme.test", projectId: mp, vendor: "Summit Concrete Supply", amount: 31_650_00, tax: 0, category: "SUB", taxCategory: "job_subcontractors", paidBy: "COMPANY", daysAgo: 58, costCode: "03", note: "Footings & foundation walls: labor + pump" });
  await exp({ user: "manager@acme.test", projectId: mp, vendor: "Front Range Lumber", amount: 13_420_00, category: "MATERIAL", taxCategory: "job_materials", paidBy: "COMPANY", daysAgo: 21, costCode: "06", note: "Roof trusses" });
  await exp({ user: "manager@acme.test", projectId: mp, vendor: "United Rentals", amount: 2_340_00, category: "EQUIPMENT", taxCategory: "equipment_rental", paidBy: "COMPANY", daysAgo: 55, costCode: "02", note: "Mini excavator, 1 week" });
  await exp({ user: "manager@acme.test", projectId: mp, vendor: "Peak Plumbing Co", amount: 4_500_00, tax: 0, category: "SUB", taxCategory: "job_subcontractors", paidBy: "COMPANY", daysAgo: 9, costCode: "15", note: "Underslab rough" });
  await exp({ user: "jake@acme.test", projectId: mp, taskId: openMaple[0]?.id, vendor: "Home Depot", amount: 34_97, category: "OTHER", taxCategory: "small_tools", paidBy: "PERSONAL", daysAgo: 8, note: "Drill bit set (broke two)", costCode: "06" });
  await exp({ user: "luis@acme.test", projectId: mp, taskId: framingInterior.id, vendor: "Home Depot", amount: 187_42, category: "MATERIAL", taxCategory: "job_materials", paidBy: "PERSONAL", daysAgo: 2, note: "Framing nails + construction adhesive", costCode: "06" });
  await exp({ user: "dana@acme.test", projectId: op, vendor: "Home Depot", amount: 412_18, category: "MATERIAL", taxCategory: "job_materials", paidBy: "COMPANY", daysAgo: 15, costCode: "01", note: "Floor protection, plastic, tape" });
  await exp({ user: "dana@acme.test", projectId: op, vendor: "Home Depot", amount: 58_20, category: "OTHER", taxCategory: "small_tools", paidBy: "PERSONAL", daysAgo: 3, note: "Oscillating tool blades", costCode: "01" });
  await exp({ user: "manager@acme.test", projectId: op, vendor: "Delgado Electric LLC", amount: 3_150_00, tax: 0, category: "SUB", taxCategory: "job_subcontractors", paidBy: "COMPANY", daysAgo: 5, costCode: "16", note: "Panel upgrade (fixed bid, separate from hourly work)" });

  console.log(`Seeded "${org.name}" (${today}). Log in with any of:`);
  for (const e of [...staff.map((s) => s.email), ...workers.map((w) => w.email)]) console.log(`  ${e} / ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
