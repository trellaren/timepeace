import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { db } from "../src/lib/db";
import { loginAs } from "./helpers";

const year = new Date().getFullYear();

describe("tax center", () => {
  it("is limited to owners and accountants", async () => {
    for (const email of ["sam@acme.test", "hr@acme.test", "manager@acme.test"]) {
      const { caller } = await loginAs(email);
      await expect(caller.tax.summary({ year })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.tax.vendors1099({ year })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const { caller } = await loginAs("accountant@acme.test");
    await expect(caller.tax.summary({ year })).resolves.toMatchObject({ year });
  });

  it("summary nets cash revenue against COGS and deductions, with labor and mileage on their lines", async () => {
    const { caller } = await loginAs("owner@acme.test");
    const s = await caller.tax.summary({ year });
    expect(s.form).toBe("form1120S");
    const sum = (rows: typeof s.lines) => rows.reduce((a, l) => a + l.deductibleCents, 0);
    expect(s.cogsCents).toBe(sum(s.lines.filter((l) => l.costOfGoodsSold)));
    expect(s.deductionsCents).toBe(sum(s.lines.filter((l) => !l.costOfGoodsSold && !l.capitalize)));
    expect(s.netProfitCents).toBe(s.revenue.receivedCents - s.cogsCents - s.deductionsCents);

    // Approved payroll lands in direct labor; the mileage deduction lands on the vehicle line.
    expect(s.payroll.w2WagesCents).toBeGreaterThan(0);
    expect(s.lines.find((l) => l.id === "job_labor")!.deductibleCents).toBeGreaterThanOrEqual(s.payroll.w2WagesCents);
    expect(s.mileage.deductionCents).toBe(Math.round((s.mileage.miles * s.settings.mileageRateMilliCents) / 100));
    // Meals are 50% deductible; equipment is capitalized, not deducted.
    const meals = s.lines.find((l) => l.id === "meals")!;
    expect(meals.deductibleCents).toBe(Math.round(meals.amountCents / 2));
    expect(s.lines.find((l) => l.id === "equipment_purchase")!.capitalize).toBe(true);
    expect(s.capitalPurchases.length).toBeGreaterThan(0);
    expect(s.flags.some((f) => f.message.includes('"Other"'))).toBe(true);
  });

  it("classifies vendors for 1099-NEC: card payments excluded, corporations exempt, goods vendors skipped", async () => {
    const { caller } = await loginAs("owner@acme.test");
    const rows = await caller.tax.vendors1099({ year });
    const by = Object.fromEntries(rows.map((r) => [r.vendor.name, r]));
    expect(by["Front Range Excavating"]!.status).toBe("FILE");
    expect(by["Delgado Electric LLC"]!.status).toBe("FILE");
    // Two company payments (ACH + check) plus any approved hours Rosa billed through payroll.
    expect(by["Delgado Electric LLC"]!.reportableCents).toBe(3_150_00 + 1_850_00 + by["Delgado Electric LLC"]!.payrollCents);
    expect(by["Peak Plumbing Co"]!.status).toBe("FILE");
    expect(by["Peak Plumbing Co"]!.excludedCardCents).toBe(1_200_00);
    expect(by["Peak Plumbing Co"]!.issues.join(" ")).toMatch(/W-9/);
    expect(by["Bolder Signs"]!.status).toBe("BELOW_THRESHOLD");
    expect(by["Summit Concrete Supply"]!.status).toBe("EXEMPT_CORPORATION");
    expect(by["Front Range Lumber"]!.status).toBe("NOT_SERVICE_VENDOR");
    // Vendors needing a 1099 sort first.
    expect(rows.findIndex((r) => r.status !== "FILE")).toBe(rows.filter((r) => r.status === "FILE").length);
  });

  it("approved hours of a 1099 worker count toward their linked vendor's 1099", async () => {
    const owner = await loginAs("owner@acme.test");
    const mgr = await loginAs("manager@acme.test");
    // Seed leaves Rosa's week submitted; the payroll workflow test may already have approved it.
    const rosa = (await mgr.caller.approvals.timesheets()).find((t) => t.user.name.startsWith("Rosa"));
    if (rosa) await mgr.caller.approvals.reviewTimesheet({ timesheetId: rosa.id, decision: "APPROVE" });

    const after = (await owner.caller.tax.vendors1099({ year })).find((r) => r.vendor.name === "Delgado Electric LLC")!;
    expect(after.payrollCents).toBeGreaterThan(0);
    expect(after.reportableCents).toBe(3_150_00 + 1_850_00 + after.payrollCents);
    expect(after.issues.join(" ")).toMatch(/payroll provider/);
  });

  it("stores a W-9 TIN encrypted, shows only the last 4, and never writes it to the audit log", async () => {
    const { caller } = await loginAs("owner@acme.test");
    const peak = (await caller.tax.vendors1099({ year })).find((r) => r.vendor.name === "Peak Plumbing Co")!;
    await caller.tax.updateVendor({ vendorId: peak.vendor.id, w9OnFile: true, w9ReceivedOn: `${year}-11-01`, taxClassification: "LLC_P", tin: "84-1234567" });

    const after = (await caller.tax.vendors1099({ year })).find((r) => r.vendor.id === peak.vendor.id)!;
    expect(after.vendor.tinLast4).toBe("4567");
    expect(after.issues).toEqual([]);
    expect(JSON.stringify(after)).not.toContain("1234567");

    const row = await db().vendor.findUniqueOrThrow({ where: { id: peak.vendor.id } });
    expect(row.tinEncrypted).toBeTruthy();
    expect(row.tinEncrypted).not.toContain("1234567");
    const logs = await db().auditLog.findMany({ where: { entityId: peak.vendor.id } });
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain("1234567");

    await expect(caller.tax.updateVendor({ vendorId: peak.vendor.id, tin: "12345" })).rejects.toThrow();
  });

  it("recategorizing an expense moves it between tax lines", async () => {
    const { caller } = await loginAs("owner@acme.test");
    const before = await caller.tax.summary({ year });
    const [other] = await caller.tax.expenses({ year, taxCategory: "other" });
    await caller.tax.setExpenseTax({ expenseId: other!.id, taxCategory: "permits_licenses" });
    const after = await caller.tax.summary({ year });
    const line = (s: typeof before, id: string) => s.lines.find((l) => l.id === id)?.deductibleCents ?? 0;
    expect(line(after, "permits_licenses") - line(before, "permits_licenses")).toBe(other!.amountCents);
    expect(line(before, "other") - line(after, "other")).toBe(other!.amountCents);
    expect(after.netProfitCents).toBe(before.netProfitCents);
  });

  it("mileage add/delete flows into the vehicle deduction", async () => {
    const { caller } = await loginAs("owner@acme.test");
    const before = await caller.tax.summary({ year });
    const trip = await caller.tax.addMileage({ date: `${year}-03-02`, miles: 100, purpose: "Supplier visit" });
    const mid = await caller.tax.summary({ year });
    expect(mid.mileage.deductionCents - before.mileage.deductionCents).toBe(Math.round((100 * mid.settings.mileageRateMilliCents) / 100));
    await caller.tax.deleteMileage({ id: trip.id });
    expect((await caller.tax.summary({ year })).mileage.deductionCents).toBe(before.mileage.deductionCents);
  });

  it("estimated-tax worksheet requires the lower of 90% current-year or the prior-year safe harbor", async () => {
    const { caller } = await loginAs("owner@acme.test");
    const e = await caller.tax.estimates({ year });
    const w = e.worksheet;
    expect(w.quarters.map((q) => q.dueDate)).toEqual([`${year}-04-15`, `${year}-06-15`, `${year}-09-15`, `${year + 1}-01-15`]);
    expect(w.methods.priorYearSafeHarbor).toBe(Math.round(28_500_00 * 1.1)); // AGI > $150k → 110%
    expect(w.requiredAnnualCents).toBe(Math.min(w.methods.current90, w.methods.priorYearSafeHarbor!));
    expect(w.quarters.reduce((a, q) => a + q.paidCents, 0)).toBe(e.payments.reduce((a, p) => a + p.amountCents, 0));

    await caller.tax.updateSettings({ year, priorYearTaxCents: 1_000_00 });
    const low = await caller.tax.estimates({ year });
    expect(low.worksheet.method).toBe("PRIOR_YEAR_SAFE_HARBOR");
    expect(low.worksheet.requiredAnnualCents).toBe(1_100_00);
    await caller.tax.updateSettings({ year, priorYearTaxCents: 28_500_00 });
  });

  it("downloads a CPA package zip with the year's reports; workers are refused", async () => {
    const app = await buildApp();
    try {
      const owner = await loginAs("owner@acme.test");
      const res = await app.inject({ method: "GET", url: `/tax/${year}/cpa-package.zip`, headers: { authorization: `Bearer ${owner.token}` } });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("application/zip");
      const files = unzipSync(new Uint8Array(res.rawPayload));
      for (const f of ["profit_and_loss.csv", "deductions_by_tax_line.csv", "expenses_detail.csv", "form_1099_nec.csv", "payroll_summary.csv", "mileage_log.csv", "estimated_tax_payments.csv", "README.txt"]) {
        expect(Object.keys(files)).toContain(f);
      }
      const nec = strFromU8(files["form_1099_nec.csv"]!);
      expect(nec).toContain("Front Range Excavating");
      expect(nec).toMatch(/^Summit Concrete Supply,EXEMPT_CORPORATION,/m);
      expect(nec).toMatch(/^Peak Plumbing Co,FILE,4500\.00,1200\.00,/m);
      expect(nec).not.toContain("1234567"); // full TIN never exported in the clear

      const worker = await loginAs("sam@acme.test");
      const denied = await app.inject({ method: "GET", url: `/tax/${year}/cpa-package.zip`, headers: { authorization: `Bearer ${worker.token}` } });
      expect(denied.statusCode).toBe(403);
      const bad = await app.inject({ method: "GET", url: `/tax/abc/cpa-package.zip`, headers: { authorization: `Bearer ${owner.token}` } });
      expect(bad.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe("CPA package link", () => {
  it("returns no link when storage can't sign URLs (local driver); clients fall back to the zip route", async () => {
    const { caller } = await loginAs("owner@acme.test");
    await expect(caller.tax.cpaPackageLink({ year })).resolves.toEqual({ url: null });
    const worker = await loginAs("sam@acme.test");
    await expect(worker.caller.tax.cpaPackageLink({ year })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
