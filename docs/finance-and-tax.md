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

## Tax prep (Phase 4; categories in place now)

Every expense carries a `taxCategory` (default derived from its cost category). `TAX_CATEGORIES` in `packages/shared/src/tax.ts` maps each one to:
- **Schedule C** lines (sole prop / single-member LLC), with job materials, labor and subcontractors in **Part III cost of goods sold**
- **Form 1120-S** lines and **Form 1125-A** COGS lines (S corp)

Planned features of the tax center:

| Feature | Details |
|---|---|
| Expense totals by tax line | For the org's entity type, with drill-down to receipts |
| 1099-NEC tracker | YTD payments per 1099-eligible vendor/contractor against the year's threshold. **$600 for payments through 2025; $2,000 for payments made in 2026 and later** (verify annually). Shows W-9 status; exports CSV for an e-file service. |
| W-2 reconciliation | Approved hours and gross estimates per employee, to tie out against the payroll provider's W-2s |
| Mileage | `MileageLog` at the IRS standard rate for the year (demo seed uses 70¢ for 2025, 72.5¢ for 2026; verify) |
| Equipment | Purchases flagged for depreciation / §179 (Form 4562) |
| Sales tax | Tax paid on materials, from `salesTaxCents` |
| Quarterly estimates | Worksheet from YTD profit (actual method vs prior-year safe harbor) |
| Year-end CPA package (ZIP) | P&L, expenses by tax line, job-cost summary, 1099 list, payroll summary, receipt images |

## Sensitive data

- Vendor TINs are encrypted with AES-256-GCM using `FIELD_ENCRYPTION_KEY` (required in production). Only the last 4 digits are displayed.
- Pay rates are visible only to OWNER and HR. Workers see only their own hours and expenses.
- Every change to time or money is written to `AuditLog` with the actor and a reason.
