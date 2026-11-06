import type { Organization } from "@timepeace/db";
import { dbDate, fromDbDate } from "@timepeace/db";
import {
  FLSA_RULES,
  payPeriodFor,
  type LocalDate,
  type OvertimeRules,
  type PayPeriodConfig,
} from "@timepeace/shared";
import type { Tx } from "../lib/db";

export function overtimeRules(org: Organization): OvertimeRules {
  return { ...FLSA_RULES, ...(org.overtimeRules as Partial<OvertimeRules>), weekStartsOn: org.weekStartsOn };
}

export function payPeriodConfig(org: Organization): PayPeriodConfig {
  return { type: org.payPeriodType, anchorDate: fromDbDate(org.payPeriodAnchor), weekStartsOn: org.weekStartsOn };
}

export async function getOrCreatePayPeriod(tx: Tx, org: Organization, date: LocalDate) {
  const range = payPeriodFor(date, payPeriodConfig(org));
  return tx.payPeriod.upsert({
    where: { orgId_startDate: { orgId: org.id, startDate: dbDate(range.start) } },
    create: { orgId: org.id, startDate: dbDate(range.start), endDate: dbDate(range.end) },
    update: {},
  });
}
