import { fromDbDate } from "@timepeace/db";
import { minutesToHours, toCsv } from "@timepeace/shared";
import PDFDocument from "pdfkit";
import type { Tx } from "../lib/db";
import { rateLookup } from "./timesheet";

export interface PayrollRow {
  timesheetId: string;
  userId: string;
  name: string;
  email: string;
  classification: "W2" | "CONTRACTOR_1099";
  status: string;
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  hourlyRateCents: number;
  grossCents: number;
  reimbursementCents: number;
  reimbursementExpenseIds: string[];
}

/** Approved (or already exported/paid) timesheets for a period, with reimbursable expenses. */
export async function payrollRows(tx: Tx, orgId: string, payPeriodId: string, exportId?: string): Promise<PayrollRow[]> {
  const period = await tx.payPeriod.findFirstOrThrow({ where: { id: payPeriodId, orgId } });
  const sheets = await tx.timesheet.findMany({
    where: { orgId, payPeriodId, status: { in: exportId ? ["EXPORTED", "PAID"] : ["APPROVED", "EXPORTED", "PAID"] }, ...(exportId ? { payrollExportId: exportId } : {}) },
    include: { user: true },
    orderBy: { user: { name: "asc" } },
  });
  const rows: PayrollRow[] = [];
  for (const s of sheets) {
    const { profile, rateFor } = await rateLookup(tx, orgId, s.userId);
    // Reimburse approved personal-card expenses up to the period end not yet paid in another export.
    const reimb = await tx.expense.findMany({
      where: {
        orgId,
        userId: s.userId,
        paidBy: "PERSONAL",
        spentOn: { lte: period.endDate },
        ...(exportId ? { payrollExportId: exportId } : { status: "APPROVED", payrollExportId: null }),
      },
    });
    rows.push({
      timesheetId: s.id,
      userId: s.userId,
      name: s.user.name,
      email: s.user.email,
      classification: profile?.classification ?? "W2",
      status: s.status,
      regularHours: minutesToHours(s.regularMinutes ?? 0),
      overtimeHours: minutesToHours(s.overtimeMinutes ?? 0),
      doubleTimeHours: minutesToHours(s.doubleTimeMinutes ?? 0),
      hourlyRateCents: rateFor(fromDbDate(period.endDate)),
      grossCents: s.grossCents ?? 0,
      reimbursementCents: reimb.reduce((a, e) => a + e.amountCents, 0),
      reimbursementExpenseIds: reimb.map((e) => e.id),
    });
  }
  return rows;
}

const money = (c: number) => (c / 100).toFixed(2);

export function payrollCsv(period: { start: string; end: string }, rows: PayrollRow[]): string {
  return toCsv([
    ["employee_name", "email", "classification", "period_start", "period_end", "regular_hours", "overtime_hours", "double_time_hours", "hourly_rate", "gross_wages_estimate", "reimbursements"],
    ...rows.map((r) => [
      r.name,
      r.email,
      r.classification,
      period.start,
      period.end,
      r.regularHours.toFixed(2),
      r.overtimeHours.toFixed(2),
      r.doubleTimeHours.toFixed(2),
      money(r.hourlyRateCents),
      money(r.grossCents),
      money(r.reimbursementCents),
    ]),
  ]);
}

export function payrollPdf(orgName: string, period: { start: string; end: string }, rows: PayrollRow[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text(`${orgName}: Payroll summary`, { continued: false });
    doc.fontSize(10).fillColor("#555").text(`Pay period ${period.start} to ${period.end} · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`);
    doc.moveDown();

    const cols = [
      ["Name", 170],
      ["Type", 70],
      ["Regular", 60],
      ["OT", 50],
      ["DT", 50],
      ["Rate", 60],
      ["Gross est.", 80],
      ["Reimb.", 70],
    ] as const;
    const startX = doc.page.margins.left;
    let y = doc.y;
    const drawRow = (cells: string[], bold = false) => {
      let x = startX;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor("#000");
      cells.forEach((c, i) => {
        const w = cols[i]![1];
        doc.text(c, x, y, { width: w - 6, align: i >= 2 ? "right" : "left" });
        x += w;
      });
      y += 16;
    };
    drawRow(cols.map((c) => c[0]), true);
    for (const r of rows) {
      drawRow([r.name, r.classification === "W2" ? "W-2" : "1099", r.regularHours.toFixed(2), r.overtimeHours.toFixed(2), r.doubleTimeHours.toFixed(2), `$${money(r.hourlyRateCents)}`, `$${money(r.grossCents)}`, `$${money(r.reimbursementCents)}`]);
    }
    const sum = (k: "regularHours" | "overtimeHours" | "doubleTimeHours") => rows.reduce((a, r) => a + r[k], 0).toFixed(2);
    drawRow(["Total", "", sum("regularHours"), sum("overtimeHours"), sum("doubleTimeHours"), "", `$${money(rows.reduce((a, r) => a + r.grossCents, 0))}`, `$${money(rows.reduce((a, r) => a + r.reimbursementCents, 0))}`], true);
    doc.moveDown(2);
    doc.font("Helvetica").fontSize(8).fillColor("#555").text(
      "Gross wages are estimates from approved hours and current rates. Your payroll provider computes withholding, taxes and net pay. 1099 contractors are paid as vendors and are not subject to payroll withholding.",
      startX,
      y + 10,
      { width: 640 },
    );
    doc.end();
  });
}
