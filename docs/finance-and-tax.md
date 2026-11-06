# Finance & tax prep

> **Not tax or legal advice.** Timepeace organizes records for your payroll provider and CPA. It does not calculate withholding, file returns, or decide worker classification. Thresholds and rates below are configurable per year (`TaxYearSettings`). Confirm them with a tax professional each year.

## Paid time (clock in/out)

Paid time comes from **shifts**, not task timers. The rules are in `packages/shared/src/shift.ts`.

- **Paid minutes** = clock-out − clock-in − recorded meal breaks of at least `minUnpaidBreakMinutes` (default **20**).
  - Shorter breaks stay paid, because under the FLSA short rest breaks (5–20 min) count as hours worked.
  - An open break isn't deducted.
  - Pay is computed to the exact minute, with no rounding.
- **Task timers only allocate a shift to jobs.** Time on the clock but not on any task (setup, driving between sites, loading the truck, cleanup, waiting on materials) is **still paid**.
- **You can't work off the clock.** Starting a task while clocked out clocks you in. The server does the same if an older client only sends task time. As a final safety net, any task time recorded outside a shift is paid too.
- **Forgotten clock-outs:**
  - The shift is closed at the worker's **last recorded activity** and flagged `AUTO_CLOSED`, never padded or cut off silently.
  - The worker sees a prompt to tell their manager the real end time.
  - The manager must confirm or correct it, with a reason recorded in the audit log, before the timesheet can be approved.

## Job costing

All formulas are implemented in `packages/shared/src/jobCost.ts`.

| Quantity | Formula |
|---|---|
| Labor cost (W-2) | `minutes × hourlyRate(workDate) / 60 × (1 + burden)`. Burden (payroll taxes, workers' comp, benefits) is the worker override or the org default, 25% in the demo. |
| Labor cost (1099 hourly) | `minutes × rate / 60`, no burden, booked as **SUB** |
| Paid time not on a task | Costed the same way and charged to the job the worker **clocked in at**, as uncoded labor ("Crew time not on a task"). With no job (shop time), it's reported as company overhead. Shown on the Finance page as a coverage signal; it never reduces pay. |
| Other actuals | Expenses (receipt totals, not rejected), by cost code and category |
| % complete | Σ estimated minutes of DONE/VERIFIED tasks ÷ Σ estimated minutes (task count if there are no estimates) |
| Budget alert | ≥ 80% of a line → *warning*; ≥ 100% → *over*. Always shown with an icon and label. |
| Estimate at completion (EAC) | `max(actual, actual ÷ %complete)`; the budget is used below 5% complete |
| Revenue: fixed | contract value + approved change orders |
| Revenue: cost-plus / T&M | `EAC × (1 + markup)`; earned to date = `actual × (1 + markup)` |
| Projected profit / margin | revenue − EAC; ÷ revenue |
| Cash position | payments received − cost to date |

**Overtime premium** is not in job cost. Job cost uses base rate plus burden; the OT premium appears in payroll gross. *Roadmap:* allocate OT premium back to the jobs worked that week.

### "What works" insights (Finance page)

- **Estimate accuracy by trade:** actual labor hours vs estimate on completed tasks, by cost code (e.g. *Framing +19%*). Use it to tune templates and bids.
- **Margin by project type:** new build vs remodel vs addition.
- **Paid crew time not on a task:** hours of paid time with no task timer running. A high number points to travel, logistics or tracking habits worth a look. It's never a reason to dock pay.
- **Crew time waiting on materials:** total time tasks spent in `NEEDS_MATERIALS`, from the status history.
- *Planned:* productivity by crew, rework cost (time on punch-list tasks), equipment rent-vs-buy, client profitability, cash-flow forecast from the draw schedule.

## Overtime

Implemented in `packages/shared/src/overtime.ts`.

- **FLSA (default):** time over 40 hours in the workweek is OT. The workweek starts on the org's `weekStartsOn`.
- **California preset:** daily OT over 8 hours, double time over 12 hours. On the 7th consecutive workday in the workweek, the first 8 hours are OT and the rest DT. Weekly OT applies only to regular hours (no pyramiding).
- OT is computed from **shifts** (paid time). A shift counts toward the **day it started**. Only qualifying meal breaks are deducted.
- 1099 contractors: no OT.
- Gross estimate = reg × rate + OT × 1.5 × rate + DT × 2 × rate, using the rate in effect each day.

Other states with daily OT (e.g. Alaska, Nevada in some cases, Colorado's 12-hour rule) can be configured with the same rule fields. Confirm the rules for your state.

## Payroll handoff

The **generic CSV** columns are `employee_name, email, classification, period_start, period_end, regular_hours, overtime_hours, double_time_hours, hourly_rate, gross_wages_estimate, reimbursements`. There is also a printable **PDF summary**.

Provider-specific CSV layouts (Gusto, ADP, QuickBooks Payroll) are enum values in the schema. Their column mappings come next, once checked against each provider's current import template. Direct API integrations come later (Phase 5).

## Tax center

**Who:** OWNER and ACCOUNTANT only (`roleProcedure(["OWNER","ACCOUNTANT"])` on the `tax` router and the zip route). Managers, HR and workers get 403.

**What it is:** a record organizer for the CPA. It is **not tax advice and files nothing.** Code: `packages/shared/src/taxPrep.ts` (pure rules, unit-tested), `apps/api/src/services/tax.ts`, `apps/api/src/services/cpaPackage.ts`, `apps/web/src/app/(app)/tax/page.tsx`.

### Tax lines

Every expense carries a `taxCategory` (defaulted from its cost category, editable on the Deductions tab). `TAX_CATEGORIES` in `packages/shared/src/tax.ts` maps each one to:
- **Schedule C** lines (sole prop / single-member LLC), with job materials, labor and subcontractors in **Part III cost of goods sold**
- **Form 1120-S** lines and **Form 1125-A** COGS lines (S corp)
- Other entity types get category totals with no line mapping (and a flag saying so).

Summary math is **cash basis** for the calendar year:

```
revenue      = customer payments received in the year (invoiced shown for reference)
COGS         = Σ deductible(expense) on COGS lines + W-2 gross from approved timesheets (direct labor)
               + 1099 workers' approved pay (subcontractors)
deductions   = Σ deductible(expense) on non-COGS, non-capitalized lines + mileage × IRS rate (vehicle line)
net profit   = revenue − COGS − deductions          (estimate; depreciation is left to the CPA)
deductible   = amount × deductibleBps            (meals 50%, everything else 100%)
```

- `equipment_purchase` is **capitalized**: listed under capital purchases for depreciation / §179 (Form 4562), not deducted.
- Overhead (company-level) expenses have no project (`Expense.projectId = null`) and are entered on the Deductions tab.
- **Flags:** expenses left in "Other", expenses ≥ $75 without a receipt, approved timesheets not yet marked paid (wages are estimates), mileage *and* fuel both recorded (standard rate vs actual costs), company vendor payments with no payment method.

### 1099-NEC tracker (`evaluate1099`)

For each vendor with payments in the year, or marked 1099-eligible:

1. Payments by **card or payment app** (`CARD`, `PAYMENT_APP`) are excluded: the processor reports them on 1099-K.
2. Approved timesheet pay of a 1099 worker linked to a vendor (`WorkerProfile.vendorId`) counts toward that vendor, with a note to check whether the payroll provider already files it.
3. Status:
   - `NOT_SERVICE_VENDOR`: not 1099-eligible (goods suppliers)
   - `EXEMPT_CORPORATION`: W-9 classification is C/S corp or LLC taxed as one, **unless** `isAttorney`
   - `BELOW_THRESHOLD`: reportable total < the year's threshold
   - `FILE`: needs a 1099-NEC (due to recipient and IRS by January 31)
4. Issues: missing W-9, missing TIN, unknown classification (treated as reportable), payments with no recorded method (counted as reportable).

Threshold: **$600 for payments through 2025; $2,000 for payments made in 2026 and later** (stored per year in `TaxYearSettings.form1099ThresholdCents`; verify annually).

### Estimated-tax worksheet (`estimatedTaxWorksheet`)

```
yearFraction        = days elapsed / days in year (as of today, or Dec 31 for past years)
projected profit    = YTD net profit ÷ yearFraction
projected tax       = projected profit × effective rate (set with the CPA; default 25%)
current90           = 90% × projected tax
priorYearSafeHarbor = prior-year total tax × (110% if prior AGI > $150k else 100%)
required            = min(current90, priorYearSafeHarbor)   (current90 alone if prior year unknown)
installment         = required ÷ 4, due Apr 15 / Jun 15 / Sep 15 / Jan 15 (next year)
```

Each quarter compares cumulative paid vs cumulative required: `PAID` (covered), `SHORT` (past due and behind), `DUE_SOON` (within 30 days), `UPCOMING`. For S corps and partnerships the page notes that owners usually pay estimates personally, so it's a planning worksheet. Seasonal income may qualify for the annualized-income method (Form 2210), which isn't modeled.

### Mileage

`MileageLog` rows (date, driver, miles, business purpose, optional job and from/to) × the year's IRS standard rate (`TaxYearSettings.mileageRateMilliCents`; demo seed uses 70¢ for 2025 and 72.5¢ for 2026; verify).

### Year-end CPA package

`GET /tax/:year/cpa-package.zip` (bearer auth, OWNER/ACCOUNTANT) builds a ZIP with fflate:

| File | Contents |
|---|---|
| `profit_and_loss.csv` | Cash-basis revenue, COGS, deductions, net |
| `deductions_by_tax_line.csv` | Category, form line, amount, deductible, count |
| `expenses_detail.csv` | Every expense with tax category, payment method, project, receipt filename |
| `receipts/` | Receipt images, named to match `expenses_detail.csv` |
| `form_1099_nec.csv` | Vendor, status, Box 1, card-excluded, classification, W-9, TIN **last 4 only**, address, issues |
| `payroll_summary.csv` | Approved timesheets per worker: hours and gross estimate |
| `job_cost_summary.csv` | Per project: revenue, cost to date, estimate at completion, projected profit, cash received |
| `mileage_log.csv` | Trip log with deduction |
| `estimated_tax_payments.csv` | Payments by quarter |
| `README.txt` | Basis, assumptions and caveats |

## Sensitive data

- Vendor TINs are encrypted with AES-256-GCM using `FIELD_ENCRYPTION_KEY` (required in production). Only the last 4 digits are displayed or exported, and the audit log records only that a TIN was updated, never its value.
- Pay rates are visible only to OWNER and HR. Workers see only their own hours and expenses.
- Every change to time or money is written to `AuditLog` with the actor and a reason.
