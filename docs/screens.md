# Screens

## Web (managers, HR, owners, accountants)

| Screen | Roles | Status | Purpose |
|---|---|---|---|
| Login | all | ✅ MVP | |
| Dashboard | all (adapts) | ✅ MVP | Approval queue counts; project health (finance roles); payroll readiness (HR); own week (worker) |
| Projects | managers, finance | ✅ MVP | Cards with progress and blocked count; **New project** from a template |
| Project → Tasks & assignments | managers (edit), finance (read) | ✅ MVP | Tasks by phase, status, assignees, add task or phase, material requests inline |
| Project → Budget & job cost | finance roles | ✅ MVP | KPI tiles (revenue, cost to date, EAC, projected profit and margin, % complete, cash position); budget vs actual by cost code with alerts; edit budget lines |
| Approvals → Timesheets | managers | ✅ MVP | Per-worker cards: paid hours (from clock in/out), OT/DT, on-task vs not-on-task time, daily breakdown; each shift with breaks, task allocations and GPS flag; **confirm/fix auto-closed shifts** and edit shift times (audited); approve, send back, approve all |
| Approvals → Expenses | managers | ✅ MVP | Approve or reject with a note |
| Approvals → Material requests | managers | ✅ MVP | Mark ordered or delivered |
| Payroll | HR, owner | ✅ MVP | Pay periods; approved rows with reg/OT/DT, rate, gross estimate and reimbursements; export CSV or PDF; mark paid |
| Finance | finance roles | ✅ MVP | Portfolio P&L, estimate accuracy by trade, margin by project type, material-wait time |
| Schedule board (Gantt/calendar) | managers | Phase 2 | Drag tasks onto worker-days; conflict warnings |
| Change orders, invoices/draws, cash flow | managers, finance | Phase 3 | |
| Tax center | owner, accountant | Phase 4 | Category totals by tax line, 1099 tracker, mileage, quarterly estimates, CPA package |
| Settings | owner (pay rates also HR) | Phase 2 | Org, OT rules, pay periods, members and roles, pay rates, cost codes, templates, checklists |

## Mobile (field)

| Screen | Status | Purpose |
|---|---|---|
| Login | ✅ MVP | Token kept in secure storage |
| Today (My Day) | ✅ MVP | **Clock card:** Clock in (choose job site), live shift clock, meal break, clock out; the current task with its own timer. Assigned tasks grouped by job site with Start / Switch / Stop (starting a task clocks you in if needed). Offline and sync banner; pull to refresh. |
| Task detail | ✅ MVP | Start/stop, **Mark done**, **Needs parts/materials** (item and qty), **Blocked** (reason), add expense for this task |
| Add expense | ✅ MVP | Receipt photo (camera or library), project/task, vendor, total and tax, type, company card vs personal, note. Works offline. |
| Timesheet | ✅ MVP | Paid totals (reg/OT/DT) from shifts; per day, each shift's clock in/out, breaks, task time and "not on a task (paid)"; auto-closed shift warning; submit (after clocking out); manager's note when sent back; previous periods |
| Expenses | ✅ MVP | Own expenses with status and reimbursable flag |
| Manager: project health, approvals, walkthrough runner | Phase 2 | |
| Push notifications (new assignment, timesheet sent back, timer still running) | Phase 2 | |
