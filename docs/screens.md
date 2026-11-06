# Screens

## Web (managers, HR, owners, accountants)

| Screen | Roles | Status | Purpose |
|---|---|---|---|
| Login | all | ✅ MVP | |
| Dashboard | all (adapts) | ✅ MVP | **Open questions** from the crew, oldest first, each opening its task (managers); approval queue counts; project health (finance roles); payroll readiness (HR); own week (worker) |
| Projects | managers, finance | ✅ MVP | Cards with progress and blocked count; **New project** from a template |
| Project → Tasks & assignments | managers (edit), finance (read) | ✅ MVP | Tasks by phase, status, assignees, add task or phase, material requests inline; **? open questions** and **💬 unread** badges per task |
| Task panel (`/projects/[id]?task=…`) | managers, owners (accountants: details only) | ✅ | Task details plus the **discussion**: messages, status changes and material requests in one timeline; questions show Open / Answered; reply (answers open questions), ask, add up to 6 photos (button, drag-and-drop, paste; resized in the browser); full-size photo viewer; edit for 15 minutes; delete messages or photos; mark answered / reopen |
| Project → Budget & job cost | finance roles | ✅ MVP | KPI tiles (revenue, cost to date, EAC, projected profit and margin, % complete, cash position); budget vs actual by cost code with alerts; edit budget lines |
| Approvals → Timesheets | managers | ✅ MVP | Per-worker cards: paid hours (from clock in/out), OT/DT, on-task vs not-on-task time, daily breakdown; each shift with breaks, task allocations and GPS flag; **confirm/fix auto-closed shifts** and edit shift times (audited); approve, send back, approve all |
| Approvals → Expenses | managers | ✅ MVP | Approve or reject with a note |
| Approvals → Material requests | managers | ✅ MVP | Mark ordered or delivered |
| Payroll | HR, owner | ✅ MVP | Pay periods; approved rows with reg/OT/DT, rate, gross estimate and reimbursements; export CSV or PDF; mark paid |
| Finance | finance roles | ✅ MVP | Portfolio P&L, estimate accuracy by trade, margin by project type, material-wait time |
| Schedule board (Gantt/calendar) | managers | Phase 2 | Drag tasks onto worker-days; conflict warnings |
| Change orders, invoices/draws, cash flow | managers, finance | Phase 3 | |
| Tax → Overview | owner, accountant | ✅ | Year selector; cash-basis revenue, COGS, deductions, net profit; needs-attention flags; COGS and deductions by Schedule C / 1120-S line; payroll, mileage, capital purchases, sales tax; **Download CPA package** |
| Tax → Deductions | owner, accountant | ✅ | Every expense for the year with inline tax-category and payment-method edits; add company (overhead) expenses |
| Tax → 1099-NEC | owner, accountant | ✅ | Per-vendor status (file / below threshold / exempt / goods), Box 1, card-excluded, W-9 and issues; edit W-9 details and TIN (encrypted) |
| Tax → Mileage | owner, accountant | ✅ | Trip log with job and purpose; deduction at the year's IRS rate |
| Tax → Estimated taxes | owner, accountant | ✅ | Projection, required annual amount (90% current vs prior-year safe harbor), quarterly status, payments, and the year's assumptions |
| Team | owner, manager, HR | ✅ | Invite (role, W-2/1099, starting pay), share link (copy, text, email), pending invites (new link, revoke), members with role changes (owner), pay rates (owner, HR), deactivate/reactivate |
| Accept invite (`/invite/…`) | anyone with a link | ✅ | Shows company, inviter and role; new person sets name and password, existing account enters its password; signs in |
| Settings | owner | Phase 2 | Org, OT rules, pay periods, cost codes, templates, checklists |

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
