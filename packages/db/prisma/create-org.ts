/**
 * Creates a real company with standard cost codes and project templates, and prints a one-time
 * invite link for its first owner. The owner sets their own password through the link, so no
 * password ever passes through this script or your terminal history.
 *
 *   DATABASE_URL=… pnpm --filter @timepeace/db create-org -- \
 *     --name "Whiteside Builders" --owner-email you@example.com --owner-name "Your Name" \
 *     --timezone America/Denver --entity LLC_SINGLE --app-url https://timepeace-web.vercel.app
 *
 * Safe to run against production: it only inserts. It refuses if the owner email already belongs
 * to a member of a company with the same name.
 */
import { CALIFORNIA_RULES, FLSA_RULES, INVITE_TTL_DAYS, startOfWeek, toLocalDate } from "@timepeace/shared";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { createPrismaClient, dbDate } from "../src/index";
import { COST_CODES, DEFAULT_TEMPLATES } from "./defaults";

const ENTITY_TYPES = ["SOLE_PROP", "LLC_SINGLE", "PARTNERSHIP", "S_CORP", "C_CORP"] as const;
const PAY_PERIODS = ["WEEKLY", "BIWEEKLY", "SEMIMONTHLY"] as const;

const { values: a } = parseArgs({
  options: {
    name: { type: "string" },
    "owner-email": { type: "string" },
    "owner-name": { type: "string" },
    timezone: { type: "string", default: "America/Denver" },
    entity: { type: "string", default: "LLC_SINGLE" },
    "pay-period": { type: "string", default: "WEEKLY" },
    "week-starts-on": { type: "string", default: "0" },
    overtime: { type: "string", default: "FLSA" },
    "app-url": { type: "string", default: process.env.APP_URL ?? "http://localhost:3000" },
  },
});

function fail(msg: string): never {
  console.error(`create-org: ${msg}`);
  process.exit(1);
}

const name = a.name?.trim() || fail("--name is required");
const ownerEmail = a["owner-email"]?.trim().toLowerCase() || fail("--owner-email is required");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) fail("--owner-email doesn't look like an email");
const ownerName = a["owner-name"]?.trim() || fail("--owner-name is required");
const entity = a.entity as (typeof ENTITY_TYPES)[number];
if (!ENTITY_TYPES.includes(entity)) fail(`--entity must be one of ${ENTITY_TYPES.join(", ")}`);
const payPeriod = a["pay-period"] as (typeof PAY_PERIODS)[number];
if (!PAY_PERIODS.includes(payPeriod)) fail(`--pay-period must be one of ${PAY_PERIODS.join(", ")}`);
const weekStartsOn = Number(a["week-starts-on"]);
if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) fail("--week-starts-on must be 0 (Sunday) to 6");
const overtime = a.overtime === "CA" ? CALIFORNIA_RULES : a.overtime === "FLSA" ? FLSA_RULES : fail("--overtime must be FLSA or CA");
try {
  new Intl.DateTimeFormat("en-US", { timeZone: a.timezone });
} catch {
  fail(`unknown --timezone ${a.timezone}`);
}
const appUrl = a["app-url"]!.replace(/\/$/, "");

const prisma = createPrismaClient();

const dupe = await prisma.membership.findFirst({ where: { org: { name }, user: { email: ownerEmail } } });
if (dupe) fail(`${ownerEmail} is already a member of a company named "${name}"`);

const token = randomBytes(32).toString("base64url");
const today = toLocalDate(new Date(), a.timezone!);

const org = await prisma.$transaction(async (tx) => {
  const org = await tx.organization.create({
    data: {
      name,
      timezone: a.timezone!,
      entityType: entity,
      payPeriodType: payPeriod,
      payPeriodAnchor: dbDate(startOfWeek(today, weekStartsOn)),
      weekStartsOn,
      overtimeRules: { ...overtime },
    },
  });
  await tx.costCode.createMany({ data: COST_CODES.map(([code, label]) => ({ orgId: org.id, code, name: label })) });
  for (const t of DEFAULT_TEMPLATES) await tx.projectTemplate.create({ data: { orgId: org.id, ...t } });

  // Invites need an inviter; the first owner is recorded as inviting themselves once they join.
  // Until then use a placeholder system user that can never sign in.
  const system = await tx.user.upsert({
    where: { email: "system@timepeace.invalid" },
    create: { email: "system@timepeace.invalid", name: "Timepeace setup", passwordHash: bcrypt.hashSync(randomBytes(32).toString("hex"), 10) },
    update: {},
  });
  await tx.invite.create({
    data: {
      orgId: org.id,
      email: ownerEmail,
      name: ownerName,
      role: "OWNER",
      tokenHash: createHash("sha256").update(token).digest("hex"),
      invitedById: system.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
    },
  });
  await tx.auditLog.create({ data: { orgId: org.id, actorId: null, entityType: "Organization", entityId: org.id, action: "create", after: { name, ownerEmail } } });
  return org;
});

await prisma.$disconnect();
console.log(`Created "${org.name}" (${org.id}) with ${COST_CODES.length} cost codes and ${DEFAULT_TEMPLATES.length} project templates.`);
console.log(`\nSend this owner invite to ${ownerName} <${ownerEmail}>. It works once and expires in ${INVITE_TTL_DAYS} days:\n\n  ${appUrl}/invite/${token}\n`);
