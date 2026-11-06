# Roadmap

## Phase 1: MVP (this repository)

- Monorepo, Prisma schema for the **full** model, demo seed ("Acme Homes")
- Auth and RBAC; projects from templates; phases, tasks, cost codes; assignments; budget lines
- Clock in/out (paid shifts) with meal breaks; task timers allocate shift time to jobs; forgotten clock-outs flagged for manager review
- Mobile: My Day, start / switch / stop task timers with GPS stamp, done / needs materials / blocked, expenses with receipt photos, timesheet submit. **Works offline** (SQLite outbox).
- Web: approvals (timesheets, expenses, material requests), payroll exports (CSV/PDF) and mark paid, job costing per project, portfolio finance insights
- Tests: shared domain, mobile outbox, API integration, Playwright end-to-end

## Phase 2: Scheduling & field quality

- Gantt / calendar schedule board with drag-to-assign, double-booking and dependency warnings, PTO
- Walkthrough checklists on mobile (pass/fail/N/A, photos, signature); failures become punch tasks; PDF report
- Push notifications (new assignment, timesheet sent back, "still clocked in?" after N hours), via pg-boss
- Worker acknowledgement when a manager edits their shift; state meal/rest-break compliance prompts (e.g. California)
- Geofence check on clock-in (flag, don't block)
- ✅ Team: invites, roles, deactivation, pay rates; `create-org` for new companies
- Settings UI (org, OT rules, cost codes, templates)
- ✅ Mobile: signs out cleanly when a session is revoked; unsynced hours are kept per worker and can be shared with a manager
- Optional invite email delivery (SMTP / provider) alongside copy/text links
- S3/MinIO storage driver with presigned URLs; manager mobile views; daily logs with photos

## Phase 3: Finance depth

- Change orders (with cost split by code), invoices and draw schedule, payments, cash-flow forecast
- OT premium allocation to jobs; crew productivity; rework cost; client profitability; completed-job benchmarks feeding new estimates
- Nightly report snapshots

## Phase 4: Tax center ✅

- Done: totals by tax line (Schedule C, 1120-S / 1125-A), overhead expenses, 1099-NEC tracker with W-9/TIN capture and CSV, mileage log, equipment flags, sales tax, quarterly estimate worksheet, year-end CPA package ZIP
- Next: W-9 request by email (vendor self-serve upload), mileage entry on mobile, 1065 / 1120 line mappings, IRS FIRE / IRIS e-file layout for 1099s, depreciation schedules (left to the CPA for now)

## Phase 5: Integrations

- Provider-specific payroll CSVs and then APIs (Gusto, ADP, QuickBooks Payroll); QuickBooks Online / Xero accounting sync
- Receipt OCR (vendor, total, tax)
- Client portal (progress photos, change-order approval, invoices)

## Open risks & decisions

| Risk | Notes |
|---|---|
| **GPLv3 vs app stores** | The repository is GPLv3. Apple's App Store terms are widely considered incompatible with GPL distribution. Decide before publishing: relicense (e.g. a permissive license or a proprietary mobile client), or dual-license. This doesn't block development. |
| State overtime and pay rules | FLSA and the California preset are implemented. Every state the customer operates in needs confirming (daily OT, meal/rest breaks, pay-frequency laws). |
| Worker classification | The app records W-2 vs 1099 but doesn't decide it. Misclassification is a legal risk for the customer. |
| PII | TINs are encrypted. Pay data is role-gated. Still to do: a data-retention policy, an export/delete flow, rate limiting on login, and moving the web session to httpOnly cookies. |
| Clock integrity | Device time is trusted for offline ops; GPS is recorded but not enforced. Add server-receipt time comparison and flag large skews for manager review. |
| Multi-org users | The schema supports it; the MVP signs into the first membership. An org switcher is needed. |
