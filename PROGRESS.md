# PROGRESS.md — PCMPC MIS build log

> Claude updates this file (ticks, questions, summaries). Humans set ✅ after review.
> Legend: ⬜ not started · 🔨 in progress · 🟡 awaiting review · ✅ done (reviewed & merged) · ⛔ blocked

**Current phase:** 17

## Status
| # | Phase | Status | Branch / tag | Reviewed by / date |
|---|---|---|---|---|
| 00 | [Foundation & Loop Gate](docs/phases/PHASE-00-foundation.md) | ✅ | phase-00-foundation · tag `phase-00` | rldejoya (reviewer agent: no must-fix) · 2026-10-07 |
| 01 | [Auth, Roles, Audit Trail & Coop Settings](docs/phases/PHASE-01-auth-roles-audit.md) | ✅ | phase-01-auth-roles-audit · tag `phase-01` | rldejoya (reviewer agent: no must-fix) · 2026-10-08 |
| 02 | [Members Registry](docs/phases/PHASE-02-members.md) | ✅ | phase-02-members · tag `phase-02` | rldejoya (reviewer agent: no must-fix) · 2026-10-08 |
| 03 | [Accounting Core (GL engine)](docs/phases/PHASE-03-accounting-core.md) | ✅ | phase-03-accounting-core · tag `phase-03` | rldejoya (reviewer agent: no blockers; follow-ups fixed) · 2026-10-08 |
| 04 | [Cashiering Core (Teller) & Daily Cash Position](docs/phases/PHASE-04-cashiering.md) | ✅ | phase-04-cashiering · tag `phase-04` | rldejoya (reviewer agent: SoD test gap + drawer check fixed) · 2026-10-08 |
| 05 | [Water: Customers, Service Connections, Meters & Rates](docs/phases/PHASE-05-water-connections.md) | ✅ | phase-05-water-connections · tag `phase-05` | rldejoya (merged on request without the reviewer agent) · 2026-10-09 |
| 06 | [Water: Meter Reading & Billing](docs/phases/PHASE-06-water-billing.md) | ✅ | phase-06-water-billing · tag `phase-06` | rldejoya (reviewer agent: memo cap + phone re-read fixed) · 2026-10-09 |
| 07 | [Water: Collections, Penalties, Disconnection & Water Reports](docs/phases/PHASE-07-water-collections.md) | ✅ | phase-07-water-collections · tag `phase-07` | rldejoya (reviewer agent: reconnection-fee rules fixed) · 2026-10-09 |
| 08 | [Share Capital & CBU](docs/phases/PHASE-08-share-capital.md) | ✅ | phase-08-share-capital · tag `phase-08` | rldejoya (reviewer agent: two-person withdrawal + follow-ups fixed) · 2026-10-12 |
| 09 | [Savings & Time Deposits](docs/phases/PHASE-09-savings.md) | ✅ | phase-09-savings · tag `phase-09` | rldejoya (reviewer agent: interest opening balance + follow-ups fixed) · 2026-10-12 |
| 10 | [Loan Products, Amortization Engine & Applications](docs/phases/PHASE-10-loan-applications.md) | ✅ | phase-10-loan-applications · tag `phase-10` | rldejoya (reviewer agent: small-loan error + tiny-loan rows fixed; follow-ups) · 2026-10-12 |
| 11 | [Loan Release, Collections, Penalties & Aging](docs/phases/PHASE-11-loan-servicing.md) | ✅ | phase-11-loan-servicing · tag `phase-11` | rldejoya (reviewer agent: stuck pending release + historical aging fixed; follow-ups) · 2026-10-12 |
| 12 | [Store: Inventory & Purchasing](docs/phases/PHASE-12-store-inventory.md) | ✅ | phase-12-store-inventory · tag `phase-12` | rldejoya (reviewer agent: stock-move order fixed; follow-ups) · 2026-10-13 |
| 13 | [Store: POS, Charge-to-Member & Store Patronage](docs/phases/PHASE-13-store-pos.md) | ✅ | phase-13-store-pos · tag `phase-13` | rldejoya (reviewer agent: charge-sale refunds fixed; follow-ups) · 2026-10-14 |
| 14 | [Financial Statements, Period Close & Fixed Assets](docs/phases/PHASE-14-fs-close.md) | ✅ | phase-14-fs-close · tag `phase-14` | rldejoya (reviewer agent: next fiscal year and asset register fixed; follow-ups) · 2026-10-14 |
| 15 | [Net Surplus Allocation, Interest on Share Capital & Patronage Refund](docs/phases/PHASE-15-surplus-allocation.md) | ✅ | phase-15-surplus-allocation · tag `phase-15` | rldejoya (reviewer agent: fiscal-year windows fixed; follow-ups) · 2026-10-17 |
| 16 | [Reports: CDA, Management Dashboard & Member Statements](docs/phases/PHASE-16-reports.md) | ✅ | phase-16-reports · tag `phase-16` | rldejoya (reviewer agent: deposits, delinquency footer, CAPR funds, auditor masking fixed; follow-ups) · 2026-10-19 |
| 17 | [Data Migration & Opening Balances](docs/phases/PHASE-17-migration.md) | ⬜ | | |
| 18 | [Hardening, Vercel Deployment, Backups, UAT & Go-Live](docs/phases/PHASE-18-golive.md) | ⬜ | | |

## Checklists

### Phase 00 — Foundation & Loop Gate
- [x] T0.1 `git init`, .gitignore, .editorconfig, .nvmrc, README
- [x] T0.2 Scaffold Next.js (App Router, TypeScript, Tailwind, ESLint, `src/`, alias `@/*`, npm)
- [x] T0.3 shadcn/ui init, staff layout (sidebar, business-date top bar), `<Peso>` UI helper
- [x] T0.4 Local Postgres 18 (portable binaries; `db:up`/`db:down` via `scripts/db.mjs`, no docker-compose) creating DBs `pcmpc` and `pcmpc_test`
- [x] T0.5 Drizzle setup: `pg` client, config, `db:*` scripts, test-DB lifecycle
- [x] T0.6 `src/lib/money.ts` (bigint centavos, HALF-UP, allocate)
- [x] T0.7 `src/lib/dates.ts` (Asia/Manila business date, addMonths, daysBetween)
- [x] T0.8 Test harness (Vitest projects, Playwright, placeholder scanner, package scripts)
- [x] T0.9 Loop files exactly as in `LOOP.md §2`
- [x] T0.10 `/health` page (version, DB, business date)
- [x] T0.11 CI workflow `.github/workflows/ci.yml`
- [x] T0.12 Prove the gate (`LOOP.md §2.6`) and record the result in the Phase 00 summary
- [x] Acceptance tests written first (tests/acceptance/phase-00.test.ts)
- [x] Exit checks passed

### Phase 01 — Auth, Roles, Audit Trail & Coop Settings
- [x] T1.1 Choose Better Auth vs Auth.js, record the decision, install & configure
- [x] T1.2 Schema + migrations: users, roles, permissions, audit_log (+ trigger), settings, number_series
- [x] T1.3 Seed: roles, permission matrix, settings defaults, number series, first admin
- [x] T1.4 `src/lib/auth-guard.ts` (requirePermission, assertNotSameUser)
- [x] T1.5 `src/lib/audit.ts` audit() + audit log viewer
- [x] T1.6 Login/logout pages, lockout logic, and protected `(staff)` layout redirect
- [x] T1.7 Users admin UI and actions
- [x] T1.8 Settings service (`getSetting<T>(key)` with zod-typed keys) and the settings UI
- [x] T1.9 `src/lib/numbering.ts` `next(code, tx, date)`
- [x] Acceptance tests written first (tests/acceptance/phase-01.test.ts)
- [x] Exit checks passed

### Phase 02 — Members Registry
- [x] T2.1 Schema + migrations + name normalization helper
- [x] T2.2 Member service (create, approve, status, duplicates, canTerminate registry)
- [x] T2.3 Beneficiaries service and validation
- [x] T2.4 Server actions with permissions + audit; server-side masking
- [x] T2.5 UI: list/search, application form (zod shared), approval queue, profile tabs
- [x] T2.6 Seed fixture: 6 sample members (dev only)
- [x] Acceptance tests written first (tests/acceptance/phase-02.test.ts)
- [x] Exit checks passed

### Phase 03 — Accounting Core (GL engine)
- [x] T3.1 Schema, migrations, immutability trigger, CHECK constraints
- [x] T3.2 COA import (CSV) + provisional seed + account mappings seed + fiscal year 2026 periods
- [x] T3.3 Ledger service (postJournal, reverseJournal, balances)
- [x] T3.4 Manual JV workflow + UI (draft, approve, post, reverse)
- [x] T3.5 Reports: TB, GL, journal books, subsidiary ledger + Excel export
- [x] T3.6 COA management UI (add/edit/deactivate; can't deactivate an account with a balance)
- [x] Acceptance tests written first (tests/acceptance/phase-03.test.ts)
- [x] Exit checks passed

### Phase 04 — Cashiering Core (Teller) & Daily Cash Position
- [x] T4.1 Schema + migrations
- [x] T4.2 Registry (receipt items, cash-outs, payor types) + built-ins
- [x] T4.3 Session service (open, close with count, verify with variance posting)
- [x] T4.4 Receipt service (registered items in one transaction) + cancellation
- [x] T4.5 DV workflow + bank deposit
- [x] T4.6 Teller UI (payor search → dues cart → slip print, cash count, verification)
- [x] T4.7 Daily cash position report + Excel export
- [x] Acceptance tests written first (tests/acceptance/phase-04.test.ts)
- [x] Exit checks passed

### Phase 05 — Water: Customers, Service Connections, Meters & Rates
- [x] T5.1 Schema + migrations (incl. `journal_lines.customer_id`) + seeds (zones, tariff, fees)
- [x] T5.2 Customer service (member/non-member) + payor type `WATER_CUSTOMER`
- [x] T5.3 Application → approval → installation → activation workflow + transfers
- [x] T5.4 Meter inventory, installation and replacement service
- [x] T5.5 Versioned rate schedules + pure rate engine + fee schedule
- [x] T5.6 Teller items `WATER_CONNECTION_FEE`, `METER_DEPOSIT`, `WATER_OTHER_FEE`
- [x] T5.7 Senior-citizen eligibility records
- [x] T5.8 UI: customers, applications, account profile, routes/sequence, tariff admin, meters
- [x] Acceptance tests written first (tests/acceptance/phase-05.test.ts)
- [x] Exit checks passed

### Phase 06 — Water: Meter Reading & Billing
- [x] T6.1 `job_runs` + `runOnce`; schema for periods, readings, bills, lines, memos
- [x] T6.2 Consumption engine (normal, rollover, meter change, estimate, flags)
- [x] T6.3 Periods + office reading-entry grid + flag review queue
- [x] T6.4 Mobile reading PWA with offline queue + idempotent sync
- [x] T6.5 Billing engine + billing run (preview → post) + GL + advances
- [x] T6.6 PDF printing: reading sheets and bills per route
- [x] T6.7 Credit/debit memos with SoD
- [x] T6.8 Final reading + final bill on account closure (deposit refund handled in Phase 07)
- [x] Acceptance tests written first (tests/acceptance/phase-06.test.ts)
- [x] Exit checks passed (all automated checks green; the real-phone offline test was waived: PCMPC reads meters by hand and encodes them in the office)

### Phase 07 — Water: Collections, Penalties, Disconnection & Water Reports
- [x] T7.1 Schema + migrations
- [x] T7.2 `WATER_BILL` teller item (dues, allocation, advances, reverse)
- [x] T7.3 Daily cron runner + penalty job
- [x] T7.4 Disconnection list, notices, disconnect/reconnect orders, reconnection fee rule
- [x] T7.5 Account closure settlement + deposit refund
- [x] T7.6 Customer ledger/SOA
- [x] T7.7 Water reports + dashboard tiles (+ optional NRW)
- [x] Acceptance tests written first (tests/acceptance/phase-07.test.ts)
- [x] Exit checks passed

### Phase 08 — Share Capital & CBU
- [x] T8.1 Schema, migrations, view, mappings check
- [x] T8.2 Share service (subscribe, pay, fee, transfer, withdraw, retainCbu, isGoodStanding, ASM)
- [x] T8.3 GL integration via `postJournal` in the same transaction
- [x] T8.4 Actions, UI tab/forms, teller registrations (fee, share payment, withdrawal)
- [x] T8.5 Member share ledger report (per member, date range) + Excel export
- [x] Acceptance tests written first (tests/acceptance/phase-08.test.ts)
- [x] Exit checks passed

### Phase 09 — Savings & Time Deposits
- [x] T9.1 Schema + migrations
- [x] T9.2 Deposit service (open, deposit, withdraw, close, reactivate, ledger)
- [x] T9.3 ADB + interest engine (pure functions + tests), interest run with preview and post
- [x] T9.4 Time deposits (place, mature, pre-terminate, rollover)
- [x] T9.5 Dormancy job + teller registrations (`SAVINGS_DEPOSIT`, `SAVINGS_WITHDRAWAL`)
- [x] T9.6 UI + actions + permissions + audit
- [x] Acceptance tests written first (tests/acceptance/phase-09.test.ts)
- [x] Exit checks passed

### Phase 10 — Loan Products, Amortization Engine & Applications
- [x] T10.1 Schema, migrations, product + deduction seed (DOMAIN sample products, flagged CONFIRM)
- [x] T10.2 Amortization engine + golden and property tests
- [x] T10.3 Net proceeds calculator
- [x] T10.4 Eligibility engine with the hook registry
- [x] T10.5 Application service + approval matrix + SoD
- [x] T10.6 UI: product admin, loan calculator, application form, approval queue, disclosure print
- [x] Acceptance tests written first (tests/acceptance/phase-10.test.ts)
- [x] Exit checks passed

### Phase 11 — Loan Release, Collections, Penalties & Aging
- [x] T11.1 Schema + migrations
- [x] T11.2 Release service (GL, CBU, schedule persistence, loan_no)
- [x] T11.3 Collection service (allocation, excess handling, GL, reversal of a payment)
- [x] T11.4 Penalty engine + daily job + job_runs idempotency
- [x] T11.5 Aging/PAR service + snapshot + delinquency list (with comakers and contact numbers)
- [x] T11.6 Write-off, restructure, termination offset, eligibility hooks, `canTerminate`
- [x] T11.7 UI: release screen, loan ledger card, delinquency/aging reports, PAR tile
- [x] T11.8 Teller registrations (`LOAN_PAYMENT`, `LOAN_PROCEEDS`) + cross-module receipt test
- [x] Acceptance tests written first (tests/acceptance/phase-11.test.ts)
- [x] Exit checks passed

### Phase 12 — Store: Inventory & Purchasing
- [x] T12.1 Schema + migrations
- [x] T12.2 Stock engine (moving average, issue costing) + property tests
- [x] T12.3 Products, categories, suppliers, price history services + UI
- [x] T12.4 PO → RR flow with GL; AP subledger; supplier payment via DV
- [x] T12.5 Stock count + approval + adjustment posting
- [x] T12.6 Reports: stock card per product, valuation, reorder list, AP aging per supplier
- [x] Acceptance tests written first (tests/acceptance/phase-12.test.ts)
- [x] Exit checks passed

### Phase 13 — Store: POS, Charge-to-Member & Store Patronage
- [x] T13.1 Schema + migrations
- [x] T13.2 Sale service (cash/charge) with stock + GL in one transaction
- [x] T13.3 Returns and voids
- [x] T13.4 Shifts + Z-reading + cash count
- [x] T13.5 Member charge accounts, statement of account, `STORE_AR_PAYMENT` receipt item in cashiering
- [x] T13.6 POS UI (keyboard/barcode-first) and the slip print
- [x] T13.7 Store reports (sales, margin, top items, slow movers)
- [x] Acceptance tests written first (tests/acceptance/phase-13.test.ts)
- [x] Exit checks passed

### Phase 14 — Financial Statements, Period Close & Fixed Assets
- [x] T14.1 Schema + migrations + FS line seed (PFRF-for-Coops layout; mark it CONFIRM)
- [x] T14.2 FS engine (all 4 statements + comparatives) + mapping completeness check
- [x] T14.3 Fixed assets + depreciation run
- [x] T14.4 Bank reconciliation
- [x] T14.5 Month close checklist + lock/reopen; year-end close + new FY opening
- [x] T14.6 UI + Excel (exceljs) and PDF exports
- [x] Acceptance tests written first (tests/acceptance/phase-14.test.ts)
- [x] Exit checks passed

### Phase 15 — Net Surplus Allocation, Interest on Share Capital & Patronage Refund
- [x] T15.1 Schema + migrations
- [x] T15.2 Allocation engine (pure) + validation
- [x] T15.3 Per-member ISC/PR computation using `averageShareMonth`, loan interest paid, `storePatronage`
- [x] T15.4 Workflow: draft → approve → post (GL) → distribute (savings/share/cash/offset)
- [x] T15.5 CETF payable report + remittance via DV
- [x] T15.6 UI + reports (allocation summary, per-member list for GA, Excel export)
- [x] Acceptance tests written first (tests/acceptance/phase-15.test.ts)
- [x] Exit checks passed

### Phase 16 — Reports: CDA, Management Dashboard & Member Statements
- [x] T16.1 Officers/committees/trainings module
- [x] T16.2 CDA template filler (exceljs) with field-mapping config per template + "Unmapped fields" sheet
- [x] T16.3 Dashboard (server-rendered KPIs; charts kept simple)
- [x] T16.4 Operational reports + Excel export
- [x] T16.5 Member SOA (print CSS + PDF)
- [x] T16.6 Performance fixture (50,000 journal lines, 1,000 members) + query tuning/indexes
- [x] Acceptance tests written first (tests/acceptance/phase-16.test.ts)
- [x] Exit checks passed

### Phase 17 — Data Migration & Opening Balances
- [ ] T17.1 Schema + migrations
- [ ] T17.2 Template generator (exceljs) for each entity
- [ ] T17.3 Upload + parser + validators + dry-run report (downloadable error list)
- [ ] T17.4 Staging + reconciliation screen
- [ ] T17.5 Post: opening JE + subledger creation per module + migrated water accounts/bills, loans and TDs
- [ ] T17.6 Rollback + audit
- [ ] T17.7 Cut-over runbook in `docs/CUTOVER.md` (steps, owners, timing, freeze, sign-off)
- [ ] Acceptance tests written first (tests/acceptance/phase-17.test.ts)
- [ ] Exit checks passed

### Phase 18 — Hardening, Vercel Deployment, Backups, UAT & Go-Live
- [ ] T18.1 Authorization sweep test (every action calls requirePermission)
- [ ] T18.2 Login rate limit, security headers, cookie flags, CSRF review, dependency audit
- [ ] T18.3 Data privacy (notice, consent, data export, `docs/PRIVACY.md`)
- [ ] T18.4 Performance (indexes, pagination, N+1 check)
- [ ] T18.5 Vercel + Neon setup (sin1 / ap-southeast-1), crons, migrations on deploy
- [ ] T18.6 Backups: Neon PITR + nightly pg_dump + monthly restore drill
- [ ] T18.7 Monitoring (health check, error logs, cron failure alert)
- [ ] T18.8 Local-mode fallback doc (`docs/LOCAL-MODE.md`)
- [ ] T18.9 UAT scripts per role + issue log (people work)
- [ ] T18.10 Training quick guides per role (people work)
- [ ] T18.11 Go-live: final migration, parallel run, sign-off (people work)
- [ ] T18.12 BIR track (`docs/BIR.md`)
- [ ] T18.13 Water compliance doc (`docs/WATER-COMPLIANCE.md`)
- [ ] Acceptance tests written first (tests/acceptance/phase-18.test.ts)
- [ ] Exit checks passed

## Questions (Claude → Rhold / PCMPC)
<!-- Format: - [ ] Q-XX.n (phase XX) question… | default used: … | answer: … -->
- [ ] Q-01.1 (phase 01) Idle session timeout: is 8 hours right for office PCs? | default used: 8 h sliding (spec, CONFIRM); a constant in `src/lib/auth.ts` because Better Auth reads it at startup | answer:
- [ ] Q-01.2 (phase 01) Role → permission matrix (`src/modules/auth/permissions.ts`, visible at /admin/roles) is my reading of PLAN §3. Please confirm these choices in particular: ADMIN has no operational permissions (users, settings, period reopen, audit, reports only); tariff changes (`water.rates`), loan release, loan write-off and receipt cancellation are MANAGER-only; LOAN_OFFICER can edit member records (`members.write`); MANAGER and AUDITOR can read the audit log. | default used: as seeded | answer:
- [ ] Q-01.3 (phase 01) Water bill numbers `WB-{YYYYMM}-{000000}`: DOMAIN §5 says series reset yearly, but the example `WB-202610-000001` suggests a monthly reset. | default used: yearly reset (the month is part of the text only) | answer:
- [ ] Q-01.4 (phase 01) PO and RR number formats are given only as `PO-…` / `RR-…` in DOMAIN §5. | default used: `PO-{YYYY}-{00000}`, `RR-{YYYY}-{00000}`, yearly reset | answer:
- [ ] Q-01.5 (phase 01) `surplus.pr_basis`: do water bills paid by members count as patronage? (DOMAIN §2 has a "?") | default used: not counted (`waterBillsPaidByMembers: false`) | answer:
- [ ] Q-01.6 (phase 01) `loan.allowance_rates` per aging bucket ("set by bookkeeper"). | default used: all null (not set) until the bookkeeper enters them | answer:
- [ ] Q-01.7 (phase 01) PLAN §9 inputs for Phase 01 are still needed: CDA registration no., TIN, full official address, fiscal year start, and the staff list with roles. | default used: DOMAIN §2 defaults (blank CDA no./TIN) | answer:

- [ ] Q-02.1 (phase 02) A2.9 says "history has 1 row", but the business rules also say every status change writes member_status_history, and approval (APPLICANT → ACTIVE) is a status change. | default used: approval writes its own history row; the A2.9 test checks that the ACTIVE → TERMINATED → ACTIVE scenario adds exactly 1 row (the termination) and the rejected change adds none | answer:
- [ ] Q-02.2 (phase 02) Who may change a member's status (INACTIVE, TERMINATED, DECEASED)? | default used: `members.approve` (MANAGER), same as approval | answer:
- [ ] Q-02.3 (phase 02) Who encodes membership applications? The Phase 01 matrix gave `members.write` only to LOAN_OFFICER. | default used: also granted to MANAGER (so a manager can encode and approve) | answer:
- [ ] Q-02.4 (phase 02) Which IDs are required (PLAN §9 "required IDs")? | default used: a valid ID type and number are optional at application and at approval | answer:

- [ ] Q-03.1 (phase 03) We need PCMPC's current chart of accounts (Excel → `docs/coa/pcmpc-coa.csv`; format in `docs/coa/README.md`), including the water accounts (PLAN R3, §9). | default used: a provisional CDA-style COA (flagged provisional) with only the accounts the DOMAIN §6 mapping keys need | answer:
- [ ] Q-03.2 (phase 03) Who may approve journal vouchers? | default used: MANAGER and BOOKKEEPER both hold `gl.jv_approve`; SoD stops anyone approving a JV they prepared | answer:
- [ ] Q-03.3 (phase 03) Who maintains the chart of accounts? The Phase 01 catalog has no permission for it. | default used: new permission `gl.coa`, granted to BOOKKEEPER | answer:
- [ ] Q-03.4 (phase 03) Which ledgers are kept per member? | default used: lines on share capital (subscribed and receivable), savings, time deposits, loans receivable and member store AR must carry a member | answer:

- [ ] Q-04.1 (phase 04) Which "other income" items may a teller collect, and to which accounts? | default used: setting `cash.other_income_items` with Certification fee → `certification_fee_income` and Hall rental → `rental_income` (both new provisional accounts) | answer:
- [ ] Q-04.2 (phase 04) Checks received at the counter: Cash on Hand (deposited later) or straight to the bank? | default used: CASH and CHECK receipts debit Cash on Hand and count toward the session's expected cash; BANK_TRANSFER debits Cash in Bank | answer:
- [ ] Q-04.3 (phase 04) Denominations used at the counter (spec list marked CONFIRM). | default used: setting `cash.denominations` with bills 1000/500/200/100/50/20 and coins 20/10/5/1/0.25/0.05/0.01 | answer:
- [ ] Q-04.4 (phase 04) DV approval limits (PLAN §9). | default used: none yet; any `cash.dv_approve` holder (MANAGER) approves any DV, never their own | answer:
- [ ] Q-04.5 (phase 04) Receipt layout and the BIR-registered receipt/invoice series in use (PLAN R1). | default used: a printable acknowledgement receipt showing the system no. AR-… and the BIR receipt no. | answer:
- [ ] Q-04.6 (phase 04) How is a receipt corrected after the teller's session is closed (cancellation needs an OPEN session)? | default used: no cancel path after close; correct it with a manager-approved journal voucher (reversal) | answer:
- [ ] Q-04.7 (phase 04) Must BIR receipt/invoice numbers be unique across valid receipts? | default used: not enforced (depends on how PCMPC numbers its BIR booklets, Q-04.5) | answer:
- [ ] Q-05.1 (phase 05) PCMPC's water zones (puroks/sitios) and reading routes, plus the existing connections list (PLAN §9). | default used: one zone "Barangay Pipindan" with one route "Route 1" | answer:
- [ ] Q-05.2 (phase 05) Tariffs for INSTITUTIONAL and BULK classifications (DOMAIN §2 only has RESIDENTIAL and COMMERCIAL), and the NWRB CPC/resolution reference. | default used: no schedule for those classes, so the rate engine refuses to price them; NWRB ref "CONFIRM" on the seeded versions | answer:
- [ ] Q-05.3 (phase 05) Transfer fee for ownership transfers, and what happens to the meter deposit on transfer. | default used: no transfer fee seeded; the deposit stays with the account | answer:
- [ ] Q-05.4 (phase 05) Must the connection fee and meter deposit be paid before installation? | default used: yes, installation is refused until both are paid | answer:
- [ ] Q-05.5 (phase 05) Should billing clerks see full customer mobile and ID numbers? | default used: masked unless the user has `members.read_sensitive` (same rule as members) | answer:
- [ ] Q-05.6 (phase 05) When a member is TERMINATED or DECEASED, does their water customer become NON_MEMBER (spec CONFIRM)? | default used: yes, on termination or death, with the change kept in the customer's history | answer:
- [x] Q-06.1 (phase 06) Billing cycle and reading schedule per zone (reading window, bill date). | default used: the clerk opens each zone's period by hand with its reading window and bill date; nothing is scheduled automatically | answer: the schedule is set by the admin → setting water.reading_schedule (reading start/end day, bill day) in Admin › Settings › Water; it pre-fills every new period (Rhold, 2026-10-09)
- [x] Q-06.2 (phase 06) Bill layout and paper size. | default used: one bill per A5 page (PDF), with readings, charge lines, previous balance, total due, due date and 6-month history | answer: ¼ of short or long bond, or ½ lengthwise of short or long → setting water.bill_paper (default ¼ short): 4 bills per sheet, or 2 side by side, with cut lines (Rhold, 2026-10-09)
- [x] Q-06.3 (phase 06) LOW and ZERO consumption flags (spec says "per settings"; DOMAIN has no values). | default used: new setting `water.low_flag` = LOW below 0.3 × the 3-month average, ZERO flagged; both need approval before billing | answer: minimum consumption is set by the admin on each tariff version; low and zero consumption still pay the minimum (₱160 members, ₱200 non-members). LOW/ZERO flags stay only as a review prompt (Rhold, 2026-10-09)
- [x] Q-06.4 (phase 06) When estimates already billed exceed the next actual use (e.g. 15 m³ estimated, only 10 m³ metered), what happens to the excess? | default used: that month bills 0 m³ (the minimum charge), the reading is flagged for review, and the excess is not carried forward; a credit memo can refund it | answer: the estimate is entered (and corrected) by the clerk, not defaulted: the Estimate action asks for the m³ and shows the 3-month average as a hint; over-estimates are corrected by changing the estimate / a credit memo (Rhold, 2026-10-09)
- [x] Q-06.5 (phase 06) Senior-citizen discount applicability (RA 9994 on the coop's water system). | default used: 5% of the basic charge, RESIDENTIAL only, consumption ≤ 30 m³, eligibility valid on the bill date, rounded HALF-UP per bill | answer: the admin decides → on/off switch in Admin › Settings (water.senior_discount.enabled) (Rhold, 2026-10-09)
- [x] Q-06.6 (phase 06) Separate Water Revenue – Non-members account (spec: CONFIRM with the bookkeeper). | default used: yes, members' and non-members' revenue split by the bill's customer-type snapshot | answer: keep the separate revenue accounts; what differs for non-members is the rate (see Q-06.9) (Rhold, 2026-10-09)
- [x] Q-06.7 (phase 06) Bill numbers WB-{YYYYMM}-{000000}: should the counter restart every month? | default used: it restarts every year (DOMAIN §5 series resets yearly), so November continues from October's last number | answer: bill numbers are a running log and never restart, like the meters → WB series no longer resets yearly (migration 0012 carries the counter over) (Rhold, 2026-10-09)
- [x] Q-06.8 (phase 06) May the clerk who encodes a flagged reading also approve it? | default used: yes (no SoD rule in the spec); approval needs water.review_readings | answer: readings are encoded by hand → no SoD between encoding and approving (Rhold, 2026-10-09)
- [x] Q-06.9 (phase 06) PCMPC: "non-member does not have revenue". The spec and golden test A6.8 post non-members' bills to Water Revenue – Non-members (925.00 in the example). Does this mean (a) one Water Revenue account for everyone (then A6.8 and DOMAIN §6 must change), or (b) something else? | default used: as specified (separate account), since acceptance tests can't be changed without a spec change | answer: it meant a separate RATE: non-members pay the general minimum (₱200), members a lower one (₱160) → tariff versions can now apply to all customers, members only, or non-members only (migration 0013); the admin adds the members-only version on Tariffs & fees. Revenue accounts stay as specified (Rhold, 2026-10-09)
- [ ] Q-07.1 (phase 07) Penalty policy: rate and base. | default used: water.penalty_pct 10% (CONFIRM) of the bill's unpaid amount on its due date, once per bill, assessed the day after the due date (HALF-UP); final bills too | answer:
- [ ] Q-07.2 (phase 07) Disconnection policy: how many unpaid bills, and must they be past due? | default used: 2 unpaid bills (water.disconnect_after_bills), counting a bill as unpaid even before its due date; notice gives 7 days (water.notice_days) | answer:
- [ ] Q-07.3 (phase 07) Reconnection: fee and what must be paid first. | default used: all arrears + penalties paid, plus the ₱300.00 reconnection fee (WATER_OTHER_FEE "RECONNECTION") paid after the disconnection; each fee receipt is used once | answer:
- [ ] Q-07.4 (phase 07) Overpayment. | default used: becomes an advance credit (Cr Customers' Advances) applied automatically on the next billing run; a receipt whose advance was already applied can't be cancelled | answer:
- [ ] Q-07.5 (phase 07) Deposit refund on closure. | default used: automatic when the account is closed: the deposit offsets everything the account still owes (oldest bill first) and the rest is refunded by a DV (DRAFT, then approved and released as usual) | answer:
- [ ] Q-07.6 (phase 07) Collection efficiency: do advances applied to a bill count as collected? | default used: yes (cash received earlier, applied to the bill); penalties are not counted | answer:
- [ ] Q-07.7 (phase 07) Report formats used today (billing summary, collection report, aging, notices). | default used: on-screen tables that print and export to Excel; the notice is a one-page PDF | answer:
- [ ] Q-08.1 (phase 08) Holding cap (10% of the coop's total paid-up) for new members: with few members, any first payment is a large share of the total. | default used: the cap is checked only when the member's paid-up would go above the minimum paid-up (`share.min_paid_up_regular`, ₱2,500.00); payments up to the minimum are always allowed. Transfers (Board-approved) and CBU retention on loans (loan policy) don't check the cap | answer:
- [ ] Q-08.2 (phase 08) CBU retention on a loan (Phase 11) when the member's unpaid subscription is smaller than the retention. | default used: whole shares are subscribed first for the excess (as `share.auto_subscribe_excess`), then the retention is credited to paid-up | answer:
- [ ] Q-08.3 (phase 08) Who encodes subscriptions, transfers and withdrawals? | default used: subscriptions by membership staff (members.write: manager, loan officer); transfers by the manager (members.approve) with the Board resolution no.; withdrawal in two steps: the manager approves it on the Board's termination resolution (members.approve), then a different person, the teller, pays it out from the drawer (cash.session); payments and the membership fee only at the teller | answer:
- [ ] Q-08.4 (phase 08) Partial payments at the teller. | default used: the teller can change the amount of any item in the cart (e.g. ₱2,500.00 of a ₱10,000.00 unpaid subscription); the server re-checks each amount against the module's rules | answer:
- [ ] Q-08.5 (phase 08) Average share month (ASM) rounding. | default used: each member's ASM for a year is rounded HALF-UP to the centavo (DOMAIN §3 doesn't list it); Phase 15 may compute interest on share capital from the unrounded sum if PCMPC prefers | answer:
- [ ] Q-08.6 (phase 08) Good standing for associate members. | default used: the same minimum paid-up (₱2,500.00) and membership fee as regular members | answer:
- [ ] Q-09.1 (phase 09) One regular savings account per member? | default used: yes, one Regular Savings account per member that isn't closed (spec CONFIRM) | answer:
- [ ] Q-09.2 (phase 09) Time-deposit rates and terms. | default used: one Time Deposit product at 3% a year (the A9.8 rate), any term in days; the rate is fixed when the deposit is placed. Change it on Savings products | answer:
- [ ] Q-09.3 (phase 09) How time deposits are funded and paid out. | default used: from the member's savings account and back to it (cash goes through savings deposits and withdrawals at the teller). GL: placement Dr Savings Deposits / Cr Time Deposits (DOMAIN §6 shows Dr Cash) | answer:
- [ ] Q-09.4 (phase 09) Interest on an account closed during the quarter, and on dormant accounts. | default used: an account earns nothing for the quarter it is closed in; it can only be closed after the last finished quarter's interest was posted (so that interest is credited first); dormant accounts still earn | answer:
- [ ] Q-09.5 (phase 09) Withholding tax on deposit interest. | default used: 0% (DOMAIN); if set, it is computed HALF-UP per account and credited to Withholding Tax Payable | answer:
- [ ] Q-09.6 (phase 09) Who reactivates a dormant account, and who handles withdrawals. | default used: the manager reactivates (with a reason; the dormancy period restarts); a deposit at the teller reactivates automatically (spec). Tellers open accounts, take deposits, pay withdrawals and close accounts, with no approval or limit for large withdrawals | answer:
- [ ] Q-09.7 (phase 09) Interest rate changes during a quarter. | default used: the run uses the product's rate at the time of the run for the whole quarter; interest is dated the quarter end, so the quarter's last month must still be open in the ledger (a closed month blocks the run until it is reopened); quarters must be run in order | answer:
- [ ] Q-09.8 (phase 09) An account opened during a quarter. | default used: its average daily balance is over the whole quarter (spec: ADB = Σ daily balances ÷ days in the period), so ₱1,000.00 opened on Mar 20 averages ₱133.33 and earns nothing under the ₱500.00 minimum | answer:
- [ ] Q-09.9 (phase 09) Deposits and withdrawals for INACTIVE, TERMINATED or DECEASED members. | default used: no member-status check (an INACTIVE member keeps using the account; a deceased member's account is paid out to the heirs at the counter with the usual documents) | answer:
- [ ] Q-09.10 (phase 09) Time-deposit interest rounding. | default used: principal × rate × days ÷ 365, rounded HALF-UP to the centavo once per certificate (DOMAIN §3 doesn't list it; the A9.8/A9.9 golden values imply it) | answer:
- [ ] Q-10.1 (phase 10) Loan products: rates, terms, maximums, deductions and comakers. | default used: the DOMAIN §2 samples: REG (equal amortization, 1.5%/mo, 6–24 mo, up to 3× paid-up, service fee 2% + CBU 2% + notarial ₱100, 1 comaker), EMR (add-on, 1.5%/mo, 1–6 mo, up to ₱10,000, service fee 1%, no comaker), PRD (equal principal, 1%/mo, 6–12 mo, up to ₱50,000, service fee 2% + CBU 2%, 1 comaker). The comaker counts are my default (DOMAIN gives none); the admin can change all of it on Loan products | answer:
- [ ] Q-10.2 (phase 10) Approval matrix. | default used: the manager reviews every application; up to loan.manager_approval_limit (₱30,000.00) the manager's approval approves it, above it any one Credit Committee member's approval does (no quorum count in the system). The encoder never decides; a person decides once per application; rejection needs remarks | answer:
- [ ] Q-10.3 (phase 10) First due date. | default used: the application previews the schedule from one month after the application date; the release (Phase 11) sets the real dates | answer:
- [ ] Q-10.4 (phase 10) Disclosure statement form. | default used: a one-page RA 3765 statement: amount, finance charges deducted (service fee, notarial, LPP), amount financed, interest, total finance charge, other deductions (CBU, shown as the member's share capital, not a finance charge), net proceeds, effective interest rate (monthly IRR of the amount financed vs. the installments, × 12 for the year), schedule and signatures | answer:
- [ ] Q-10.5 (phase 10) Comaker rules. | default used: a comaker must be an ACTIVE member other than the borrower, not past due (from Phase 11); not required to be in good standing; no limit on how many loans one member co-signs | answer:
- [ ] Q-10.6 (phase 10) Eligibility at approval. | default used: the rules are re-checked when the manager or the Credit Committee approves; an application whose borrower fell out of good standing can't be approved | answer:
- [ ] Q-10.7 (phase 10) Loanable amount vs. loans already held or applied for. | default used: each application is checked on its own (paid-up multiple and product maximum), so a member could hold several applications that each pass; Phase 11 should net existing loan balances from the loanable amount | answer:
- [ ] Q-10.8 (phase 10) Rounding points not in DOMAIN §3. | default used: percentage deductions (service fee, CBU) and the add-on total interest are rounded HALF-UP to the centavo; the add-on's per-installment interest is the total ÷ term HALF-UP, with the last installment taking the rest | answer:
- [ ] Q-10.9 (phase 10) Smallest loan per product. | default used: ₱1,000.00 for REG, EMR and PRD (the deductions must fit in the loan); the admin can change it on Loan products | answer:
- [ ] Q-11.1 (phase 11) How loans are released. | default used: two people: a manager who did not approve the loan authorizes the release (first due date, cash or savings), then a teller pays out the net proceeds from the drawer (cash-out LOAN_PROCEEDS); proceeds credited to the member's savings are released at once by the manager. The first due date is at most 3 months away, and a cash payout after it needs a new authorization | answer:
- [ ] Q-11.2 (phase 11) Penalty computation. | default used: from the day after the grace days, the unpaid installment (principal + interest) × 2% × days past due ÷ 30, counted from the due date (incl. the grace days), kept as Σ(unpaid × days) and rounded once, so daily and catch-up runs agree; penalties are income only when collected; an installment is PAID when its penalty is paid too | answer:
- [ ] Q-11.3 (phase 11) Payments ahead and settlement. | default used: payments go penalty → interest → principal, oldest installment first; extra pays the next installments' interest and principal (schedule unchanged); a payment can't exceed everything still scheduled (no pay-off discount of future interest) | answer:
- [ ] Q-11.4 (phase 11) Recoveries after a write-off. | default used: collected at the teller on the written-off loan and credited to a new account 44140 Recovery of Loans Written Off (Other Income), up to the principal written off | answer:
- [ ] Q-11.5 (phase 11) Restructure. | default used: the outstanding principal + unpaid interest of installments already due + unpaid penalties become a new loan (same rate and method, new term and first due date); the capitalized interest and penalties are income on restructure; the old loan is RESTRUCTURED and linked; a Board resolution no. is required (reviewer). Note: booking uncollected interest and penalties as income conflicts with `loan.interest_recognition = ON_COLLECTION`; the alternative is to credit them to an unearned-income account until the new loan is collected | answer:
- [ ] Q-11.6 (phase 11) Offsets on termination. | default used: when a terminating member's share capital is paid out, it first pays their open loans (as a payment, incl. scheduled interest); savings can pay a loan through "Pay from savings" (keeping the maintaining balance) | answer:
- [ ] Q-11.7 (phase 11) Days past due and PAST_DUE. | default used: days past due count from the oldest installment not fully paid (a penalty still unpaid keeps it unpaid); a loan is PAST_DUE from the day after a due date passes unpaid (grace days only delay penalties) | answer:
- [ ] Q-11.8 (phase 11) The golden ₱10,000 Regular Loan on ₱2,500 paid-up (PHASE-11 A11.1–A11.12) vs. the seeded REG limit of 3× paid-up (DOMAIN): 3 × ₱2,500 = ₱7,500 < ₱10,000, so that loan can't be originated under the seeded configuration. | default used: the seeded REG stays at 3× (DOMAIN); the Phase 11 test fixture sets REG to 4× before applying, so the golden values are tested unchanged. Which is right for PCMPC: 3× or 4× (or a minimum paid-up for REG)? | answer:
- [ ] Q-12.1 (phase 12) Stock quantities. | default used: whole units of each product's unit (pc, pack, sack, kg); goods sold by weight are set up per whole kilo or as packs. Does the store sell loose goods in fractions (e.g. ½ kg)? | answer:
- [ ] Q-12.2 (phase 12) Who keeps what in the store. | default used: the manager keeps products and prices (store.price) and approves purchase orders (new store.po_approve) and counts; the store clerk keeps suppliers, prepares POs, receives deliveries and counts; the bookkeeper prepares supplier payment vouchers, the manager approves them and a teller releases them. Everyone with read access to the books (and the store clerk) can see the store pages (new store.read) | answer:
- [ ] Q-12.3 (phase 12) VAT class of products. | default used: every product is VAT-exempt (a cooperative's sales to members); the class is kept per product for the BIR set-up but isn't used in the postings yet | answer:
- [ ] Q-12.4 (phase 12) Deliveries paid in cash. | default used: the receiving report posts Dr Merchandise Inventory / Cr AP–Trade (the supplier) like any delivery, and creates a cash payment voucher for it; the manager approves the voucher and a teller pays it from the drawer (Dr AP–Trade / Cr Cash on Hand), so the cash leaves through the counter (PLAN §5 rule 9). The spec says the RR credits Cash directly | answer:
- [ ] Q-12.5 (phase 12) Stock count overages. | default used: an overage comes in at the product's average cost, Dr Merchandise Inventory / Cr a new account 44150 Inventory Overage (Other Income); a shortage goes out at the average cost, Dr Inventory Losses (DOMAIN §6). Should overages instead reduce Inventory Losses? | answer:
- [ ] Q-12.6 (phase 12) Purchasing rules. | default used: deliveries may be received without a PO (small purchases); a PO is received in parts, never more than is still to come; the invoice cost may differ from the PO cost; the manager cancels a PO (what was received stays). Each delivery is due on its receiving date plus the supplier's terms; payments settle the oldest deliveries first. A supplier invoice no. is received once. Should a delivery without a PO above some amount need the manager's approval first (today the manager first sees it when approving the payment)? | answer:
- [ ] Q-12.7 (phase 12) Counting. | default used: the clerk counts blind (the system quantity is shown only after submission, and taken at submission); the approved adjustment is the variance as counted, even if stock moved before approval; a count covers all active products (and inactive ones still in stock) or one category; a product is on one open count at a time; the manager can send a submitted count back to the clerk. Stock count numbers are SC-{YYYY}-{00000} | answer:
- [ ] Q-12.8 (phase 12) Supplier payables aging groups. | default used: Not yet due, 1–30, 31–60, 61–90, Over 90 days past due (setting store.ap_aging_buckets) | answer:
- [ ] Q-13.1 (phase 13) The POS drawer. | default used: each store cashier has their own POS shift (the spec's drawer), separate from teller sessions; cash sales go to Cash on Hand. The shift closes with a cash count and the Z-reading; the manager then verifies it and any shortage or overage is posted to Cash Short/Over (as for teller sessions, cash.short_over_policy). The day's cash stays in Cash on Hand: its turnover to the treasurer or the bank isn't recorded separately. How is the store's cash handed over at day-end? | answer:
- [ ] Q-13.2 (phase 13) Discounts and member prices. | default used: none; members and non-members pay the shelf price (the sale's discount columns stay at zero). Does PCMPC give member discounts or senior/PWD discounts in the store? | answer:
- [ ] Q-13.3 (phase 13) VAT on store sales. | default used: none (every product VAT-exempt, Q-12.3); no output VAT is posted | answer:
- [ ] Q-13.4 (phase 13) Store credit. | default used: charges for ACTIVE members only, up to ₱1,000.00 owed (store.member_credit_limit) unless the manager sets the member's own limit; AR–Members holds only store charges; members pay at the teller (Store charges payment), up to what they owe | answer:
- [ ] Q-13.5 (phase 13) Voids. | default used: before a sale is completed, a supervisor (a user with store.supervise, the manager) types their username and password at the POS; never the cashier; a wrong password counts toward their lockout. The voided sale keeps its number and lines; nothing is posted | answer:
- [ ] Q-13.6 (phase 13) Returns. | default used: the cashier records them (no supervisor), any time after the sale; restocked at the sale's cost; a cash sale is refunded in cash from the cashier's open drawer; a charge sale is credited to the member's account first (up to what they owe) and only the rest is paid in cash. Note (reviewer): without a supervisor, a cashier could sell for cash and then refund it to themselves, the same effect as a void without the credential, found only at the next stock count. Should cash refunds (or returns of another cashier's sale) need a supervisor's credential, or have a time limit? | answer:
- [ ] Q-13.7 (phase 13) Store patronage. | default used: a member's completed purchases (cash and charge) in the year less what they returned in the year (by return date); only sales where the cashier picked the member count; walk-in sales never count; a year never goes below zero (a January return of a December purchase). Phase 15 may prefer to attribute returns to the sale's year | answer:
- [ ] Q-13.8 (phase 13) Sale numbers and the slip. | default used: sales S-{YYYY}-{000000} (a voided sale keeps its number), returns SR-{YYYY}-{000000}; the POS slip says "Not an official receipt" until the store has a BIR-accredited POS or invoice (PLAN R1); a BIR invoice no. can be kept per sale but the POS screen doesn't ask for it yet | answer:
- [ ] Q-14.1 (phase 14) The statement layout (PFRF for Cooperatives). | default used: Financial Condition lines: cash; loans receivable net of the allowance; accounts receivable; inventories; other assets; property and equipment at cost and accumulated depreciation; deposit liabilities; accounts payable – trade; accrued and other payables; paid-up share capital (subscribed less subscription receivable); statutory funds (one line); undivided net surplus; the year's net surplus (until the year-end close). Operations: sales net of returns; interest on loans; service fees, fines and other credit income; water service revenue; other income; cost of sales; interest expense on deposits; operating expenses. Please send the prior-year audited FS so the lines and captions can match | answer:
- [ ] Q-14.2 (phase 14) Business segments. | default used: credit (loan interest, fees, fines, recoveries, interest on deposits), water service (all water revenue), consumer store (sales, returns, cost of sales, inventory losses and overage), general (everything else: salaries, utilities, depreciation, membership fees…). Shared expenses aren't allocated to the segments | answer:
- [ ] Q-14.3 (phase 14) Depreciation. | default used: straight-line, a full month from the month acquired, HALF-UP with the last month taking the residue; an asset's purchase is posted by its DV or JV (the register doesn't post the cost); sample classes and lives: building 20 years, water system 15, office equipment 3, furniture 5, transportation 5. An asset already depreciated in the books before comes in with its accumulated depreciation through a month and is depreciated from the month after (please send the fixed-asset list with each asset's accumulated depreciation); a wrongly registered asset is voided, with a reason, until its first depreciation is posted | answer:
- [ ] Q-14.4 (phase 14) The month-close checklist. | default used: teller sessions and POS shifts verified (so cash short/over is posted; the spec says POS shifts CLOSED); water billing periods of the month posted; no draft JVs; the daily jobs ran for every date since the first posting; the depreciation run posted when assets need it; quarter-end savings interest for products with accounts; a saved bank reconciliation for every active bank account set up by then. A month is closed only after it ends; months may close in any order; only the administrator reopens, with a reason. Missed daily jobs are run from Period close (past dates, oldest first). The water item checks the zones billed in the month; should every zone with active connections be billed every month? | answer:
- [ ] Q-14.5 (phase 14) Year-end close. | default used: every other month closed first; one closing entry dated the year's last day (revenues and expenses into Undivided Net Surplus); the last month and the year are then closed and the next year opened; balances carry forward (no separate opening entry); a closed year's months can't be reopened. The next year opens with the first entry dated in it (so January is posted before the old year is closed); a year's close needs the year before closed | answer:
- [ ] Q-14.6 (phase 14) Cash flow classification. | default used: loans, receivables, inventories, deposits and payables are operating; property and equipment at cost is investing (accumulated depreciation is the operating add-back); share capital, statutory funds and undivided net surplus are financing | answer:
- [ ] Q-14.7 (phase 14) Bank reconciliation. | default used: the bookkeeper enters the statement's ending balance, ticks the book entries the bank cleared and lists the bank-only items (charges, interest); it saves only when it balances and isn't changed afterwards; the bank-only items are then posted by a JV, ticked as cleared on the next month's reconciliation. Months are reconciled in order, from the month the bank account was set up | answer:
- [ ] Q-15.1 (phase 15) The allocation percentages. | default used: the settings (reserve 10%, ETF 10% with half to the CETF, CDF 3%, optional 7%; of what remains, ISC 70% and PR 30%); an allocation may use other percentages approved by the GA, within the law (reserve ≥ 10%, ETF ≤ 10%, CDF ≥ 3%, optional ≤ 7%, PR ≥ 30% of what remains, ISC + PR = 100%). Please send the by-laws' allocation article and the last GA resolution on the net surplus | answer:
- [ ] Q-15.2 (phase 15) Who shares ISC and PR, and on what. | default used: active and inactive members when the allocation is drafted (applicants, terminated and deceased members don't); ISC by the year's ASM (month-end paid-up ÷ 12); PR by patronage = loan interest paid in the year (not penalties) + net store purchases (purchases less returns in the year); water bills paid count only if enabled (what receipts applied to bills, not penalties or advances). all over the fiscal year's own months | answer:
- [ ] Q-15.3 (phase 15) How ISC and PR are paid out. | default used: 100% to the member's savings unless the member chooses another split of savings, share capital and cash (setting surplus.default_payout); share capital subscribes whole shares as needed and, like CBU, isn't held to the 10% holding cap; cash goes out by a disbursement voucher (the manager approves, a teller releases). Withholding tax 0% (when set: on ISC and PR each, HALF-UP, before arrears) | answer:
- [ ] Q-15.4 (phase 15) Arrears offset. | default used: on (setting); the past-due amounts of the member's open loans on the distribution date (installments due before it, with penalties accrued), oldest loan first, are paid first as a loan payment (penalty → interest → principal); if they are more than the member's ISC and PR, all of it goes to the arrears | answer:
- [ ] Q-15.5 (phase 15) Posting dates and the CETF. | default used: the allocation entry is dated the day it is posted after the GA (in the new year), not the year-end; each member's payout entry is dated the distribution day; the CETF is remitted to the federation/union named on the DV (cash or check), tracked per year. Which federation/union receives PCMPC's CETF? | answer:
- [ ] Q-16.1 (phase 16) The CDA templates. | default used: none was provided, so the CAPR workbook holds the MIS's own data sheets (cover with the CDA reg. no. and year, every CAPR figure by key, officers and trainings) and an Unmapped fields sheet that says the template is missing. Please save the current CAPR and annex templates (Excel) in docs/cda-templates/ (capr.xlsx); their cells are then mapped to the figures in src/modules/reports/cda-templates.ts, and template fields with no MIS data are listed | answer:
- [ ] Q-16.2 (phase 16) Officers and committees. | default used: the Board, Audit, Election, Mediation and Conciliation, Ethics, Credit, Education and Training, and Gender and Development committees plus Management; positions are typed (Chairperson, Secretary, …); attendees of a training are entered by member no. Please send the current list of officers, committee members and their terms, and the trainings attended | answer:
- [ ] Q-16.3 (phase 16) Who sees members' contact numbers in reports. | default used: a new permission reports.contacts (the manager; the super admin has every permission); the Board and the Auditor see them masked, as the spec says, even though the Auditor holds members.read_sensitive for member profiles. Should loan officers or the credit committee see them too, e.g. for collection calls? | answer:
- [ ] Q-16.4 (phase 16) Loan collection efficiency. | default used: the principal and interest of the installments due in the month ÷ what was paid on those installments (penalties left out; installments paid ahead don't count for their own month until due). Water keeps its Phase 07 definition (bills due in the month) | answer:
- [ ] Q-16.5 (phase 16) Membership counts and tax reports. | default used: members = active and inactive (approved, not terminated or deceased); for a past year, as of its last day (membership date, and status history for those who left). ATIR/ABR data isn't built: is PCMPC tax-exempt (CDA certificate of tax exemption)? | answer:
- [ ] Q-16.6 (phase 16) The CAPR's fund figures. | default used: CETF remitted and CDF used in a year = the debits to CETF payable and to the CDF in entries dated in the fiscal year that stand (not reversed, not reversals); the fund balances are as of the year end. Social Audit and Performance Audit data beyond these figures isn't built yet (backlog). Does the CDA want the CETF remitted per year of allocation instead? | answer:

## Decisions log
<!-- Format: - 2026-10-07 · phase XX · decision · reason -->
- 2026-10-07 · plan · Stack: Next.js + TypeScript + Postgres (Neon via Vercel Marketplace) + Drizzle · must run on Vercel; local Postgres first, cloud later
- 2026-10-07 · plan · Money stored as bigint centavos; HALF-UP rounding at defined points only · accounting accuracy
- 2026-10-07 · plan v1.1 · Water service billing (member + non-member connections) is the core module, built right after the platform (Phases 05–07) · main purpose of the MIS
- 2026-10-07 · plan v1.1 · Cashiering is a pluggable registry (Phase 04); every module registers its own receipt items · one counter, one receipt
- 2026-10-07 · phase 00 · Local DB is PostgreSQL 18.6 portable binaries (no Docker, no admin), managed by `scripts/db.mjs`; T0.4 adapted (no docker-compose) · Docker and native Postgres not installed; user chose portable over SQL Server so dev matches Neon (Postgres)
- 2026-10-07 · phase 00 · Pinned stable versions: Node 24 LTS, Next.js 16.4.0 (Cache Components + Partial Prefetching on), React 19.3, TypeScript 5, Tailwind 4, shadcn 4 (base-nova), drizzle-orm 0.45.3 + drizzle-kit 0.31.11, pg 8.23, Vitest 5.0.3, Playwright 1.63, zod 4.6, decimal.js 10.6, date-fns 4.4 + @date-fns/tz 1.5, PostgreSQL 18.6 · PLAN §4 asks to record them
- 2026-10-07 · phase 01 · Auth library: **Better Auth 1.7.7** (username plugin, Drizzle adapter, DB sessions in Postgres, uuid ids), not Auth.js · Auth.js v5 never shipped a stable release (`next-auth` latest is 4.x) and its credentials provider only supports JWT sessions, while the spec requires sessions stored in Postgres. Better Auth's username sign-in needs no email (spec: email optional), and its before/after hooks let lockout and inactive checks run on every sign-in path. Users, roles and permissions stay in our own tables (Better Auth's admin/RBAC plugin is not used)
- 2026-10-08 · ui/module-shell (Rhold's request) · The full front-end shell is built now: every planned screen from PLAN §2/§6 is in the sidebar and on the dashboard, and unbuilt ones open a "Coming soon: under construction" page naming the phase that delivers them. This replaces PHASE-00 T0.3 "modules appear only once built". Coming-soon items are visible to every signed-in user (no data, no actions); live items stay permission-filtered. Registry: `src/components/layout/nav.ts` (flip `status` to `live` when a phase ships; a unit test fails if a live item has no page or a planned item already has one)
- 2026-10-08 · phase 02 · The duplicate rule ignores TERMINATED and DECEASED members (both terminal), so a deceased member's record never blocks a new applicant with the same name and birthdate · spec says "non-terminated"; DECEASED is treated the same way as the other terminal status (reviewer follow-up)
- 2026-10-08 · phase 03 · Excel exports write amounts as spreadsheet numbers (pesos, 2 decimals). It's the one place a bigint amount becomes a JS number, only to fill a cell; ledger math stays bigint · the bookkeeper needs numeric cells to work in Excel
- 2026-10-08 · phase 03 · The ledger table is `gl_accounts` (Drizzle export `accounts`); Better Auth's `accounts` table export was renamed `authAccounts` · both tables can't be called `accounts`
- 2026-10-09 · phase 06 · Members and non-members can have separate water tariffs (members-only / non-members-only versions take precedence over the version for all customers); seeded default stays one tariff for all (DOMAIN §2 water.member_rate_difference = none) · PCMPC: members' minimum ₱160, non-members' ₱200, entered by the admin
- 2026-10-09 · phase 06 · Meters are read by hand on the printed route sheets and encoded in the office; the reading app (/read) stays available but is optional, so the real-phone offline exit check is waived · PCMPC answer
- 2026-10-09 · phases 08+ · Only members may file loans or hold share capital (equity); non-members are water customers only · PCMPC answer, for the share-capital and loan phases
- 2026-10-10 · settings · Coop settings rewritten for non-technical staff: plain labels and help per setting (src/modules/settings/presentation.ts), proper fields (pesos, %, Yes/No, readable choices, small forms and lists) instead of keys/codes/JSON, "To confirm" instead of CONFIRM, read-only settings explain where to change them (e.g. water rates on Tariffs & fees), plain error messages; water fee settings now update the fee the teller collects; "Last changed" shows only after a person changes a setting · requested by Rhold: used by non-IT staff
- 2026-10-13 · phase 12 · The supplier sub-ledger is `journal_lines.supplier_id` (with `dv_lines.supplier_id` and `account_mappings.requires_supplier`), like the member and water-customer tags, not a separate `ap_ledger` table: AP–Trade lines must carry the supplier, so the supplier balances always tie to the GL and need no second ledger to reconcile · spec asks to decide and record it
- 2026-10-14 · phase 14 · The year-end close posts one closing entry (source `ledger.close`, CLOSE-YYYY) into Undivided Net Surplus; the statements leave it out of operations and cash flows, and the new year opens from the carried balances (no opening entry) · one entry the auditor can trace; balances stay cumulative in the GL
- 2026-10-14 · phase 14 · The trial balance lists only accounts with a non-zero balance · after the year-end close, revenue and expense rows would all be zero (A14.6)
- 2026-10-14 · phase 14 · Financial-statement lines and segments are data (`fs_lines`, `fs_line_accounts`, `account_segments`) edited from Financial statements › Account mapping, and every postable account must be mapped before the statements run · config over code; a new account can't silently drop off the FS
- 2026-10-14 · phase 15 · The bookkeeper prepares, posts and distributes the allocation; the manager approves it (new permissions surplus.prepare / surplus.approve); posting needs the GA resolution no. · separation of duties per the spec, on the roles that already do the books
- 2026-10-14 · phase 15 · Every split of the allocation (funds, ETF local/CETF, ISC/PR pools, each member's share) uses money.allocate, so the parts always add up; each payout is drawn from ISC payable first, then PR payable · DOMAIN §3 (pool splits); a fixed, auditable order
- 2026-10-14 · phase 15 · The Stop-hook gate may run up to 30 min (scripts/gate.mjs, .claude/settings.json; was 14/15 min); DB tests restore the seeded reference data from a per-worker snapshot instead of re-seeding (~0.35 s a test); ESLint uses its cache · with little free memory this PC runs 1–2 test workers and the full gate took 16–19 min, so a green run was cut off as red. Nothing the gate checks changed
- 2026-10-17 · admin seed · Without SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD the seed creates the first admin as admin / Pass123456 (src/db/seed.ts DEFAULT_ADMIN; the E2E specs use the same default); the env vars still win when set, and an existing admin is never replaced · Rhold's choice, so .env needs no admin password. Change it after the first sign-in (Admin › Users), and before any deployment: the default is in the repository
- 2026-10-19 · roles · ADMIN is the super admin: every permission (ROLE_PERMISSIONS.ADMIN = all), and it can view the system as any other role (header "View as"; a banner and "Back to Administrator"; cookie honored only for a real ADMIN; each switch audited as auth.view_as; sign-out clears it). A document's preparer ≠ approver rule still applies to the admin · Rhold's request, for running and demonstrating the system; switching only ever narrows what the admin can do
- 2026-10-19 · demo · `npm run db:seed:dev` (local databases only) creates the demo general manager "manager" (MANAGER); password from SEED_DEMO_PASSWORD or the default in scripts/db-seed-dev.mts · for client demos; change it in Admin › Users afterwards
- 2026-10-19 · phase 16 · Report money totals come from the GL control accounts and each report or statement shows a reconciliation with the member records where one applies (loans, deposits, share capital, interest, store sales); members' contact numbers are masked in reports unless the viewer holds members.read_sensitive · the spec's rule that totals reconcile to the GL; the existing Data Privacy masking
- 2026-10-19 · phase 16 · The CAPR data is one list of named figures (src/modules/reports/cda.ts) and a CDA template is mapped to it cell by cell (cda-templates.ts); without a template the workbook carries the data sheets · fields are never invented: the templates map onto data the MIS has
- (pending) · early water pilot after Phase 07? (see PLAN §6)

## Backlog (out-of-scope ideas found while building)
- Online bill payments (GCash / Maya)
- SMS / e-mail bill and due-date reminders
- Customer/member self-service portal (view bills, balances, SOA)
- Payroll-deduction integration
- 2FA for staff logins
- Self-service password change for staff (v1: the admin resets passwords; Better Auth's /change-password is disabled)
- Revoke TRUNCATE on audit_log, journal_entries and journal_lines from the app's DB role (Phase 18)
- Editable role → permission matrix in the UI (v1: read-only grid, changed via seed)
- Photo / signature capture (Vercel Blob); meter photo on reading
- Smart/IoT meters
- Printable passbook layout for the passbook printer (PHASE-09 Out)
- Approval or limits for large savings withdrawals (Q-09.6)
- Corrections for savings postings (a wrong interest run, a manual adjustment); today a GL reversal of a savings entry from the Journal screen would leave the passbook unchanged, so savings entries should be reversed only through the savings module
  - Since the Phase 11 review the Journal screen refuses to reverse module entries (only manual JVs), so the gap is now "no correction path" instead of "drift".
- Purchase returns to a supplier (debit memo) and corrections of a posted receiving report (Phase 12: an RR is immutable; a wrong one can't be reversed yet)
- Supplier and customer tags in the manual JV and DV forms (Phase 17 opening balances will need supplier balances)
- Block manual JVs to Merchandise Inventory (except opening balances, Phase 17), so the valuation can't drift from the GL; today the valuation page shows any difference (Phase 12 review)
- Truly blind counts: the Products page shows the clerk the quantities on hand (Phase 12 review)
- The store's cash turnover at day-end (POS drawer → treasurer/teller or bank deposit) recorded as its own entry (Q-13.1)
- BIR invoice no. on the POS screen once the store has an accredited POS or invoices (Q-13.8, PLAN R1)
- Store discounts / member prices if PCMPC adopts them (Q-13.2)
- Fixed-asset disposal (sale or retirement: the gain or loss and taking the asset off the register) (Phase 14)
- Statement lines in a hierarchy (current / non-current subtotals) and allocating shared expenses to the segments (Q-14.1, Q-14.2)
- A printable ISC/PR notice per member, and taking members' payout choices in bulk (e.g. from the GA forms) (Phase 15)
- Correcting a GA resolution no. after posting; re-issuing a cancelled ISC/PR cash DV from the allocation; distributing member by member (resumable) for a large membership (Phase 15 review)
- ATIR/ABR data if PCMPC is tax-exempt; Social Audit and Performance Audit figures beyond what the CAPR data gives (Q-16.5)
- Charts on the management dashboard (Phase 16 kept tiles and tables)
- Member statement: arrears that are past due shown apart from the installment due today; closed savings accounts left out (Phase 16 review)
- Water on the dashboards: one definition of the month's "billed" for the home page and the management dashboard; the NRW when a bulk meter reading is missing (Phase 16 review)
- A governance permission (the manager and the secretary) instead of members.write for officers and trainings (Phase 16 review)
- A load test of the loan-by-loan figures (portfolio, PAR, delinquency) with thousands of loans (Phase 16 review)
- Once the CDA template is in docs/cda-templates/: check that its logos and images survive the ExcelJS round trip; client-side filters on the operational reports through runReportAction (the pages render on the server today) (Phase 16 review)
- Importing the bank statement (CSV) instead of ticking entries by hand (Phase 14)
- The monthly allowance (provision) entry per aging bucket (`loan.allowance_rates`): the Phase 11 follow-up expected it at the period close, but the Phase 14 spec doesn't include it
- A pre-closing trial balance (or an option to list zero rows) for the auditor; locking the statement mapping of closed years (Phase 14 review)
- Bank accounts limited to cash-in-bank accounts (not cash on hand) once PCMPC's bank accounts are in the chart (Phase 14 review)
- A manager force-close for a POS shift a cashier left open; a blind cash count (the shift page shows the expected cash before the count, as the Phase 4 teller screen does) (Phase 13 review)
- Corrections for loan payments made without a receipt (pay from savings, share-capital offsets on termination): a reversal in the loans module that also reverses the savings or share posting (Phase 11 review)
- Penalty on the payment day: a payment made before the day's job runs collects penalties only up to the last run; compute the penalty to the payment date live (Phase 11 review)
- Lock order between the loans daily job (locks every open loan) and receipts with several loan payments; run the job before the counter opens or lock loans in id order everywhere (Phase 11 review)
- Concurrency tests (two payments on one loan, double release, double payout) and a dashboard/portfolio test for A11.6–A11.7 (Phase 11 review)
- Members with a written-off loan: block new loans (and termination) until it is recovered or the Board decides (Phase 11 review)

## Phase summaries
<!-- Claude appends "### Phase XX summary" here at the end of each phase:
Built · Decisions · Deviations from spec (with reason) · Follow-ups · Gate proof / test counts -->

### Phase 00 summary
**Built**
- Next.js 16.4 (App Router, TS `strict` + `noUncheckedIndexedAccess`, Tailwind 4, shadcn/ui), with a staff layout: a sidebar driven by `src/components/layout/nav.ts` (only built modules are listed), a top bar with the Manila business date, and a `<Peso>` display helper.
- Local PostgreSQL 18.6 with `scripts/db.mjs` (`db:up`, `db:down`, `db:reset`, `db:status`), which creates `pcmpc` and `pcmpc_test`. Drizzle client (`pg` Pool), `withTx`, migrate/seed scripts with a baseline migration, and a `SEED_STEPS` registry that later phases add to.
- `src/lib/money.ts`: bigint centavos, `parse`/`format`, `add`/`sub`/`sum`, `mulRate` (HALF_UP default, plus HALF_EVEN/DOWN/UP), and `allocate` (largest remainder). No floats.
- `src/lib/dates.ts`: `businessToday(now | clock)`, `setClock`, `addMonths` (clamped to month end), `addDays`, `daysBetween`, `monthEnd`, `quarterOf`, `formatDate`.
- Test harness: Vitest projects (unit / integration / acceptance). DB projects migrate once and truncate `public` before each test, refuse any DB not named `*_test`, and run with TZ=UTC. Playwright starts the dev server with the Asia/Manila timezone.
- `scripts/scan-placeholders.mjs` (with fixtures and its own unit tests), and the loop files copied verbatim from LOOP.md §2 (`.claude/settings.json` Stop hook, `scripts/gate.mjs`, the `reviewer` agent).
- `/health` page (version, `SELECT 1`, business date, environment) and `.github/workflows/ci.yml` (postgres:18 service → npm ci → db:up → migrate → seed → gate → build → e2e).

**Decisions**
- Portable PostgreSQL in `%LOCALAPPDATA%\pcmpc-pg`: Docker and native Postgres weren't installed, the user has no admin rights, and they chose this over SQL Server so dev matches Neon.
- An ESLint `no-restricted-syntax` rule bans `new Date()` and `Date.now()` in `src/**` except `src/lib/dates.ts`, so the business-date rule is checked mechanically.
- Next.js and shadcn create-app defaults kept: Cache Components, Partial Prefetching and the `base-nova` style. Request-time data, such as the business date, uses `connection()` inside `<Suspense>`.

**Deviations from spec (with reason)**
- T0.4: no `docker-compose.yml`. `scripts/db.mjs` supports portable/service/external modes instead, because Docker isn't available (user-approved). CI uses `PG_MODE=external` with a Postgres service container.
- LOOP §2.4 `typecheck` is `next typegen && tsc --noEmit`, not just `tsc --noEmit`. Next 16 generates route types such as `LayoutProps`, so a fresh clone fails typecheck without typegen.
- The acceptance tests were committed after T0.5, not before T0.1, because they need the Vitest harness and test DB from T0.5. They were confirmed red, failing on missing `@/lib/money` and `@/lib/dates` modules, before T0.6/T0.7 were written.
- `db:migrate` and `db:seed` scripts are `.mts` files run with `tsx`, because the package is CommonJS-typed and the scripts use top-level await.

**Gate proof (T0.12)**: on branch `scratch/gate-proof`, `mulRate`'s default was changed from HALF_UP to DOWN, and Claude tried to stop. The Stop hook **blocked** (attempt 1/8): A0.2 (1833n ≠ 1834n), A0.3 (12n ≠ 13n) and 2 unit tests failed. Claude restored HALF_UP and the gate went green (100 tests). The scratch branch was deleted. The hook then allows the stop when green, which is the normal end of this turn.

**Exit checks**: `npm run gate` green (6 test files, 100 tests: unit 85, integration 5, acceptance 10). `npm run build` green. `npm run e2e` green (A0.10). Fresh `db:reset → db:migrate → db:seed` OK. Fresh clone → `npm ci → db:up → db:migrate → next dev` → `/health` shows `DB: OK` and `Oct 07, 2026`.

**Follow-ups**
- CI has never actually run: nothing was pushed (pushing isn't allowed). Check the first run after Rhold pushes.
- `npm audit` reports advisories in the scaffold's dependency tree. Review them in Phase 18 (T18.2).
- The portable Postgres doesn't start with Windows: run `npm run db:up` after each reboot.
- The parent folder `C:\Users\rldejoya\source\repos` is itself a git repo, and it lists `PCMPC/` as untracked. Consider adding it to the parent's `.gitignore`.

### Phase 01 summary
**Built**
- **Auth (T1.1, T1.6):** Better Auth 1.7.7 with the username plugin, Drizzle adapter and sessions in Postgres (`sessions`), with an 8-hour sliding idle timeout. Lockout (5 failures → 15 minutes) and the inactive-user check run in Better Auth's before/after sign-in hooks, so every sign-in path enforces them. Sign-up, e-mail sign-in and self-service profile endpoints are disabled. Also: `/login`, Sign out, a `src/proxy.ts` cookie redirect, and a server-side `getCurrentUser()` check in the `(staff)` layout.
- **Schema (T1.2):** users, roles, role_permissions, Better Auth's sessions/accounts/verifications, audit_log (a trigger rejects UPDATE/DELETE), settings, settings_history and number_series.
- **Seed (T1.3):** 11 roles, a 49-permission catalog and the role matrix, 67 settings: DOMAIN §2 plus three `auth.*` limits from this spec, 20 number series from DOMAIN §5, and the first admin from `SEED_ADMIN_*`.
- **Guard (T1.4):** `getCurrentUser`, `requirePermission` (writes `auth.denied` outside the caller's transaction so the denial survives a rollback), `assertNotSameUser`, `runAs()` for jobs and tests, and `guardPage()` plus `<Forbidden>` for pages.
- **Audit (T1.5):** `audit(tx, …)` strips secret-looking keys and records the actor, IP and user agent. Login, failed login, lockout, logout and denied access are audited too. Viewer at /admin/audit (filters: user, entity, action, Manila date range).
- **Users (T1.7):** /admin/users and /admin/users/[id] (create, edit, reset password, activate/deactivate). Self-deactivation and changing your own role are blocked. Deactivating a user, changing their role or resetting their password ends their sessions.
- **Settings (T1.8):** `getSetting(key)` typed by a zod registry; updates are validated, keep history and are audited. /admin/settings has editors per kind: pesos→centavos, percent→fraction (exact string math), and JSON for tariffs. /admin/roles shows the read-only matrix.
- **Numbering (T1.9):** `numbering.next(code, tx, date)` uses `SELECT … FOR UPDATE` in the caller's transaction. Yearly series open a new row at 1 for a new year.

- **Last-admin guard (added after review, approved by Rhold 2026-10-08):** the last active ADMIN can't be deactivated or moved to another role. Active admin rows are locked in id order, so two admins removing each other at the same time can't leave zero admins.

**Decisions** (also in the Decisions log): Better Auth over Auth.js. Users, roles and permissions live in our own tables. Settings store money as centavo strings and rates as fraction strings, because JSON can't hold bigint.

**Deviations from spec (with reason)**
- Better Auth's own tables (sessions, accounts, verifications) have no `created_by`, because the library defines their shape. `users` carries two extra Better Auth columns (`email_verified`, `image`). `audit_log` has the spec's `at`/`user_id` plus `created_at`/`created_by`.
- The idle timeout is a constant, not a setting, because Better Auth reads its session config once at startup (Q-01.1). Password length and lockout limits are settings (`auth.*`), per "config over code".
- The audit trigger blocks UPDATE and DELETE as the spec says. TRUNCATE is not blocked: the test harness and `db:reset` rely on it.
- `/health` moved out of the staff layout so it stays public for monitoring (Phase 18). A0.10 still passes.
- **E2E file edited after the `test(phase-01)` commit:** `tests/e2e/phase-01.spec.ts` (not `tests/acceptance/`) started by opening `/admin/users`. The login then correctly returned the user to `/admin/users`, so the spec's "login → dashboard" step could never happen. The steps now follow the spec row: start at `/login`, and check the protected-URL redirect at the end. No assertion was removed. Playwright's `expect` timeout went from 5 to 15 s because cold dev compiles load Better Auth (about 7 s on this PC).

**Follow-ups**
- Answer Q-01.1 to Q-01.7.
- Cross-key settings checks (ISC% + PR% = 100%, the sum of statutory funds) belong to Phase 15.
- `member.no_format`, `water.customer_no_format` and `water.account_no_format` in settings duplicate the `number_series` formats. `number_series` is what numbering uses; decide in Phase 02/05 whether to drop the setting copies.
- Login rate limiting by IP, security headers and the cookie review are in Phase 18 (T18.2).
- Postgres was killed once when an interrupted command's process tree was torn down. If anything fails with ECONNREFUSED, run `npm run db:up`.

**Exit checks / counts:** `npm run gate` green, with 152 tests in 10 files: unit 114, integration 19, acceptance 19 (A0.x 10 + A1.1–A1.9). `npm run build` green. `npm run e2e` green (A0.10, A1.10). Fresh `db:reset → db:migrate → db:seed` OK (4 seed steps, admin created). Checked in the browser: sign-in redirect back to `next`, editing a peso setting (₱500.00 → ₱600.00, shown in the audit log), and the roles matrix (49 × 11, 85 grants).

### Phase 02 summary
**Built**
- **Schema (T2.1):** `members`, `member_beneficiaries`, `member_status_history`. A CHECK makes `member_no` present exactly when the status isn't APPLICANT. Name normalization in `src/lib/names.ts` (case, accents, punctuation and extra spaces ignored).
- **Service (T2.2):**
  - New records start as APPLICANT with no member no.
  - **Duplicates:** same normalized last + first name + birthdate as a non-terminated member blocks the save. The message names the member no., or the applicant if there is no number yet. An advisory lock stops two saves racing past the check.
  - **Approval** needs a PMES date (not in the future), a BOD resolution no. and privacy consent. It assigns the next `MEMBER` number and sets membership_date to the business date.
  - **Status changes** follow DOMAIN §4. TERMINATED and DECEASED are terminal. A `canTerminate` rule registry is in place with no rules yet; Phases 08, 09 and 11 add theirs.
  - Every change writes history and the audit log.
- **Beneficiaries (T2.3):** shares must total exactly 100%, compared in hundredths of a percent (no floats). The list is replaced as a whole, and an empty list clears it.
- **Actions and masking (T2.4):**
  - Every action runs requirePermission → zod → service → audit.
  - Birthdate, valid ID no., TIN and mobile are masked on the server unless the user has `members.read_sensitive`.
  - Editors without that permission can't overwrite the masked fields: the server keeps the stored values.
- **Screens (T2.5):** /members (search, filters, pagination), /members/new, /members/applications (approval queue), /members/[id] (Profile, Beneficiaries and Status history tabs, approval panel, status change), /members/[id]/edit. The sidebar shows Member registry and Membership applications as Live.
- **Dev fixture (T2.6):** `npm run db:seed:dev` loads 6 sample members: 4 approved (2 with beneficiaries) and 2 applicants. The data lives in `scripts/fixtures/`, not `src/`, and the script refuses production and non-local databases.

**Decisions**
- `members.write` is now also granted to MANAGER (Q-02.3).
- Status changes need `members.approve` (Q-02.2).
- Beneficiary birthdates are not masked, because the spec's masking list covers only the member's own birthdate, ID no., TIN and mobile.

**Deviations from spec (with reason)**
- **A2.9 "history has 1 row":** approval also writes a history row (APPLICANT → ACTIVE), because the rules say every status change does. The test asserts that the ACTIVE → TERMINATED → ACTIVE scenario adds exactly one row and the rejected change adds none (Q-02.1).
- **E2E spec edited after the `test(phase-02)` commit** (`tests/e2e/`, not `tests/acceptance/`): the PMES date and BOD resolution locators now match their labels exactly. Next 16 keeps the previous page hidden in the DOM after navigating, so the application form's similar labels also matched. No assertion changed.
- **Playwright config:** the per-test timeout is now 90 s (from 30 s). The two-user A2.10 flow compiles five pages cold on the dev server.

**Follow-ups**
- Answer Q-02.1–Q-02.4, and get PCMPC's membership form, ID requirements and PMES process (PLAN §9).
- Photo and signature capture stay in the Backlog.
- Termination rules come with share capital (08), savings (09) and loans (11).

**Exit checks / counts:** `npm run gate` green: 189 tests (unit 132, integration 29, acceptance 28: A0 10 + A1 9 + A2 9). `npm run build` green. `npm run e2e` green, 5 specs including A2.10. Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK.

### Phase 03 summary
**Built**
- **Schema and immutability (T3.1):**
  - Tables: `gl_accounts`, `account_mappings` (with a `requires_member` flag), `fiscal_years`, `periods`, `journal_entries`, `journal_lines` (bigint centavos).
  - CHECKs: exactly one of debit/credit is > 0; drafts have no JE no.; a REVERSED entry links to its reversal.
  - Triggers: lines of POSTED/REVERSED entries can't change. A POSTED entry can only become REVERSED. Posted entries can't be deleted. No lines can be added to an entry posted in an earlier transaction. A deferred check makes every non-draft entry balance at commit.
- **Chart of accounts seed (T3.2):**
  - `docs/coa/pcmpc-coa.csv` is imported when it exists (format in `docs/coa/README.md`).
  - Otherwise a **provisional** CDA-style chart is seeded: 63 accounts, flagged provisional, mapping all 44 DOMAIN §6 keys.
  - 8 member-ledger keys require a member on every line.
  - `docs/coa/provisional-coa.csv` is a template for the bookkeeper.
  - The fiscal year of today's business date is seeded with 12 OPEN periods.
- **Ledger service (T3.3):**
  - `postJournal` is the single door to the GL. It checks balance (the message names both totals), postable and active accounts, an OPEN period, and members on member-ledger lines. Then it assigns the gapless per-book number. It runs in the caller's transaction and is audited.
  - `reverseJournal` posts a mirror entry and marks the original REVERSED, once only. A reversal can't itself be reversed.
  - Queries: `accountBalance`, `trialBalance`, `generalLedger`, `subsidiaryLedger`, `journalBook`.
- **Manual JV (T3.4):** draft with live debit/credit totals → approve and post (SoD: the preparer can't approve) → reverse or discard. Screens: /accounting/journals, /new, /[id].
- **Reports (T3.5):** /accounting/ledger has the trial balance, general ledger (opening and running balance), journal books, and member subsidiary ledger. Excel export of the TB and GL via exceljs.
- **COA management (T3.6):** /accounting/coa: add under headers, rename, activate/deactivate. Deactivation is blocked when the account has a balance, a posting key, or active sub-accounts.
- **Dev fixture:** `db:seed:dev` also posts 5 sample entries for the sample members, and its trial balance balances (₱18,150.00 = ₱18,150.00).
- **Sidebar:** Journal vouchers, Ledger & trial balance, and Chart of accounts are Live.

- **Review follow-ups (approved by Rhold 2026-10-08):**
  - Migration `0006` makes a journal line's entry link unchangeable, and re-runs the deferred balance check after line updates. Before this, raw SQL could move a draft line into a posted entry.
  - The person who prepared an entry can't reverse it (`reverseEntryByUser`, used by the Journal vouchers screen). The base `reverseJournal` stays unrestricted for module flows.
  - Regression tests cover both.
  - TRUNCATE on the ledger tables is left for Phase 18 (revoke it from the app's database login), as for the audit log.

**Decisions** (also in the Decisions log and Questions)
- BOOKKEEPER now holds `gl.jv_approve` (Q-03.2), and SoD stops self-approval.
- New permission `gl.coa` for BOOKKEEPER (Q-03.3).
- Member-ledger keys are listed in Q-03.4.
- Manual JVs post to the General Journal (GJ).
- Excel cells hold numbers.
- Table name `gl_accounts`.

**Deviations from spec (with reason)**
- **Provisional COA (Q-03.1):** PCMPC's real chart isn't available yet, as the spec anticipates.
- **Templated keys:** `accumulated_depreciation_{class}` waits for Phase 14, which defines the asset classes. `loans_receivable_{product}` is expanded for the sample products REG, EMR and PRD.
- **Phase 01 code touched:** Better Auth's Drizzle export was renamed `authAccounts` because of the table-name clash. There is no behavior change.
- **Bugs found by the E2E run and fixed:**
  - In the account picker, an unqualified `id` in a subquery bound to `account_mappings.id`.
  - The `/login` Suspense fallback was a working form, so typing before the real form streamed in was lost.
- **Playwright now runs a single worker.**

**Follow-ups**
- Answer Q-03.1–Q-03.4. Get the real COA (with water accounts) before Phase 05 posts water revenue.
- Customer-tagged lines (`ar_water`, `customers_deposits`, `customers_advances`) arrive in Phase 05 with `journal_lines.customer_id`.
- Period close and reopen (with reason and audit) are Phase 14. For now periods are only OPEN, or CLOSED in the database.

**Exit checks / counts:** `npm run gate` green: 218 tests (unit 142, integration 38, acceptance 38: A0 10 + A1 9 + A2 9 + A3 10). `npm run build` green. `npm run e2e` green: 6 specs including A3.11. Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK, and the TB on the seeded fixture balances.

### Phase 04 summary
**Built**
- **Schema (T4.1):** `teller_sessions` (one OPEN per teller), `receipts` (gapless `AR-` no., `je_id`, cancel link), `receipt_items`, `cash_outs` (`je_id`), `disbursement_vouchers` with `dv_lines`, and `cash_counts`. All amounts are bigint centavos with positive-amount CHECKs. Migration `0008` adds the count `kind` (BILL/COIN), because ₱20 exists as both.
- **Registry (T4.2):** `registerReceiptItem`, `registerCashOut`, `registerPayorType` and `duesFor()`. Built-ins:
  - `OTHER_INCOME`: items and accounts come from the new setting `cash.other_income_items`.
  - Cash-outs `DV` and `BANK_DEPOSIT`.
  - Payor types `MEMBER` (normalized-name search in SQL) and `WALK_IN`.
- **Sessions (T4.3):**
  - Open one session for today's business date.
  - Close with a denomination count. Expected = opening + cash and check receipts − cash-outs; variance = counted − expected.
  - Manager verification, never by the session's teller, posts any variance to Cash Short/Over on the session's date.
- **Receipts (T4.4):**
  - One receipt covering many items makes exactly one CRJ entry: Dr Cash for the total plus each item's credit lines. Everything runs in one transaction.
  - If any item fails, nothing is saved and the AR number isn't used.
  - The BIR receipt no. is required by setting.
  - The payor is resolved on the server, and each item type's permission is checked.
  - Cancellation: same business day, by a supervisor who isn't the teller, while the session is open. Each item's reverse hook runs, the receipt's JE is reversed with an exact mirror, and the number stays used.
- **DVs and deposits (T4.5):**
  - DV lifecycle: DRAFT (gapless `DV-` no.) → approve (SoD) → release (CDJ; a cash DV is a cash-out of the releasing teller's session) or cancel.
  - Bank deposit: Dr Cash in Bank / Cr Cash on Hand.
  - Cash-outs can't exceed the cash in the drawer.
- **Screens (T4.6):**
  - Teller counter: payor search, dues, other-income items, cart total, mode, BIR no., bank deposit.
  - Printable acknowledgement receipt with supervisor cancellation.
  - Cash count and close.
  - Manager session verification.
  - DV list, new and detail (approve, release, cancel).
- **Cash position (T4.7):** built from the counter's records: beginning (GL as of the day before) + receipts by item type − cash-outs by type + other postings to Cash on Hand (listed per entry) = ending. That ending is compared to the GL balance. Excel export via `/api/reports/cash-position`.
- **Sidebar:** Teller counter, Teller sessions (new), Disbursement vouchers and Daily cash position are Live. Nav items can now require any one of several permissions.

- **Review follow-ups (approved by Rhold 2026-10-08):**
  - Integration tests now exercise the SoD checks directly: a DV approved by its preparer, and a receipt cancelled by its own teller. Before this, the default roles only ever hit the permission check.
  - Cancelling a cash or check receipt is refused if its cash already left the drawer (deposited or paid out).
  - Post-close receipt corrections and BIR number uniqueness are logged as Q-04.6 and Q-04.7.

**Decisions** (see Questions Q-04.1–Q-04.5)
- Other-income items and their posting keys are a setting.
- Certification Fee Income and Rental Income were added to the provisional COA.
- Checks received go to Cash on Hand and count toward the expected drawer cash. Bank transfers go to Cash in Bank.
- Denominations are a setting.
- There are no DV approval limits yet.
- The receipt is an acknowledgement receipt that carries the BIR receipt no.

**Deviations from spec (with reason)**
- **Item `reverse` hook:** it undoes sub-ledger effects and returns nothing. The ledger side of a cancellation is an exact mirror of the receipt's JE (`reverseJournal`), not debit lines returned by each item. This gives the same result and guarantees the reversal matches the original entry.
- **Cancellation needs the teller's session to be still OPEN.** That keeps the cash count consistent; the spec only says "same business date".
- **Cash position:** "other postings to Cash on Hand" (short/over, manual JVs) are listed explicitly so the reconciliation is real. Without them, the ending figure would differ from the GL whenever such entries exist.
- **E2E:** the UI-shell test now checks a still-planned item, because the teller counter went Live.

**Follow-ups**
- Answer Q-04.1–Q-04.5, including the receipt layout and BIR series (PLAN R1).
- Phases 05–13 register their receipt items (WATER_BILL, share payment, savings, loans, store AR) and payor types (WATER_CUSTOMER).
- DV approval limits (Q-04.4).

**Exit checks / counts:** `npm run gate` green: 239 tests (unit 142, integration 49, acceptance 48: A0 10 + A1 9 + A2 9 + A3 10 + A4 10). `npm run build` green. `npm run e2e` green: 7 specs including A4.11. Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK.

### Phase 05 summary
**Built**
- **Schema (T5.1):** migration `0009_water`. Tables:
  - `water_customers`: MEMBER or NON_MEMBER; at most one MEMBER record per member; a normalized name+address key for duplicate checks.
  - `water_zones` and `water_routes`.
  - `water_accounts`: account no. `WA-`, classification, route + `sequence_no`, status, `deposit_amount`.
  - `water_applications` (`WAPP-`).
  - `water_meters` (3–9 dial digits).
  - `water_meter_installations`: at most one active installation per meter and per account.
  - `water_rate_schedules`: versioned; unique on classification + effective date; blocks priced in centavos.
  - `water_fees`, `water_senior_eligibility`, `water_account_history`.
  - The migration also adds `journal_lines.customer_id` and `account_mappings.requires_customer`. `ar_water`, `customers_deposits` and `customers_advances` are customer sub-ledgers: `postJournal` requires the customer tag on those lines and checks that the customer exists.
  - Seeds: zone PIPINDAN / route R-01; the DOMAIN §2 sample tariffs as versions effective 2026-01-01; fees CONNECTION, METER_DEPOSIT, RECONNECTION. The provisional COA gains 42170 Reconnection Fee Income.
- **Customers (T5.2):**
  - A member customer links to an ACTIVE or INACTIVE member and copies the member's name, address and mobile. "Customer already exists for M-000001" if one is already linked.
  - Non-members are checked for duplicates on name + address.
  - A member hook (`members/hooks.ts`) turns a TERMINATED or DECEASED member's customer into NON_MEMBER (Q-05.6).
  - Read models mask mobile, ID no. and OSCA ID unless the viewer has `members.read_sensitive` (Q-05.5).
  - Teller payor type `WATER_CUSTOMER`: search by name or account no.
- **Workflow (T5.3):**
  - Application, optional inspection, then approval. The approver can't be the encoder (SoD). Approval opens a PENDING account at the end of its route.
  - The connection fee and meter deposit are paid at the teller. Installing the meter then activates the account; an account can't be ACTIVE without an installed meter.
  - Reject.
  - Transfer of ownership; the deposit stays with the account.
  - Move to another route; reorder a route.
  - Every change is written to the account history and the audit log.
- **Meters (T5.4):**
  - Inventory with the serial uppercased and unique.
  - Installation needs an IN_STOCK meter; "already installed at WA-…" otherwise. Readings are checked against the dial digits.
  - Replacement records the old meter's final reading and new status plus the new meter's initial reading, both as installation rows.
  - An installed meter's status changes only through replacement.
- **Rates (T5.5):**
  - Pure `chargeFor()` returns itemized lines. It is checked against a unit-by-unit reference for 0–500 m³.
  - Schedule validation: no gaps, only the last block is open-ended, integer centavo rates.
  - `computeWaterCharge(classification, m³, periodEnd)` uses the version in force on the period-end date.
  - New versions are insert-only and must be dated after the latest version.
- **Teller items (T5.6):**
  - `WATER_CONNECTION_FEE` and `METER_DEPOSIT` are offered as dues for approved applications. The amount must equal the fee, and each fee can be paid only once.
  - The deposit credits Customers' Deposits with the customer tag and adds to the account's deposit.
  - Cancelling the receipt reverses the deposit, but is refused once the meter is installed.
  - `WATER_OTHER_FEE` covers fees by code, such as reconnection.
- **Senior citizens (T5.7):** eligibility records apply to RESIDENTIAL accounts only. `isSeniorEligible(account, date)` is ready for Phase 06 billing.
- **Screens (T5.8):**
  - Customers: list/search, new (member lookup by member no.), profile with accounts and applications plus the application form.
  - Application queue and detail: inspect, approve/reject, fee status, install form.
  - Connections & meters: account list, meter inventory with add and status.
  - Account profile: meter history, replace meter, senior eligibility, move route, transfer, account history.
  - Zones & routes: reading order per route, reordered by drag-and-drop or ↑/↓, then saved.
  - Tariffs & fees: versions with "In force" / "Upcoming", the add-version form, the fee schedule.
  - The five water nav items are Live.
- **Teller desk:** a due already in the cart is no longer offered again. Manual items appear only after the chosen payor's dues have loaded, so the dues stay above them.
- **Fix found while seeding:** Drizzle's `jsonb` column parsed JSON strings a second time, so a setting such as `"350000"` came back as a number. Settings and audit values now use a `jsonbValue` column type, with a regression test.

**Decisions** (see Questions Q-05.1–Q-05.6)
- One seeded zone and route until PCMPC sends its puroks and reading routes. An application without a route goes to the first route.
- Only the RESIDENTIAL and COMMERCIAL sample tariffs are seeded. INSTITUTIONAL and BULK accounts can be opened, but they need a rate version added on the Tariffs screen before Phase 06 bills them.
- Transfers have no fee, and the deposit stays with the account.
- Both fees must be paid before installation.
- Billing clerks see masked mobile and ID numbers.
- A member's customer becomes NON_MEMBER on termination or death.

**Deviations from spec (with reason)**
- **Zones and routes have no create/edit screen.** They are seeded (Q-05.1) and the screen manages the reading order. Assigning meter readers to routes is left to Phase 06, where the readers' screens are built.
- **Fee amounts:** they are read from settings when the water seed runs. Changing `water.fee.*` later does not change `water_fees`, and there is no fee edit screen yet (Follow-ups).
- **E2E:** the UI-shell test's "coming soon" example changed from water Customers (now Live) to Meter readings (Phase 06).

**Follow-ups**
- Answer Q-05.1–Q-05.6, especially the real zones/routes and the NWRB-approved tariff with its reference.
- A fee-schedule edit screen, or syncing `water_fees` from settings.
- Zone/route maintenance and assigning readers to routes (Phase 06).
- The real COA with water accounts (Q-03.x) before Phase 06 posts water revenue.

**Exit checks / counts:** `npm run gate` green: 295 tests (unit 167, integration 69, acceptance 59: A0 10 + A1 9 + A2 9 + A3 10 + A4 10 + A5 11). `npm run build` green. `npm run e2e` green: 8 specs including A5.12. Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK.

### Phase 06 summary
**Built**
- **Jobs and schema (T6.1):**
  - `job_runs` plus `runOnce(tx, job, key, …)` in `src/lib/jobs.ts`. The claim is made inside the caller's transaction, so a failed run rolls back and can be retried, and two runs racing on the same key are tested.
  - Migration `0010` adds the tables:
    - `water_billing_periods`: unique per period and zone; OPEN → READING → REVIEW → BILLED → CLOSED; due date = bill date + `water.due_days`.
    - `water_readings`: unique per period and account, and per `client_uuid`.
    - `water_billing_exclusions`.
    - `water_bills`: CHECKs tie the amounts together.
    - `water_bill_lines`.
    - `water_bill_adjustments`.
  - Migration `0011` adds triggers: bills can't be deleted and only their status can change (for Phase 07 payments); bill lines are immutable; approved memos are immutable.
- **Consumption engine (T6.2):** `consumption.ts` is pure. It covers:
  - normal reads;
  - marked rollover: 10^digits − previous + present;
  - a lower reading without rollover, rejected with "Reading is lower than previous (1,250)";
  - chained meter changes;
  - estimates: the average of recent actual months, HALF-UP;
  - reconciling estimates at the next actual reading (present − last actual − estimated m³);
  - flags: HIGH, LOW, ZERO, and LOWER on rollover.
  - 27 unit tests.
- **Periods, readings and review (T6.3):**
  - Open a period per zone.
  - Keyboard-fast reading grid by route: Enter saves and jumps to the next account, R marks a rollover. It shows the previous reading and the 3-month average.
  - Re-entering a reading replaces any reading that hasn't been billed.
  - Flagged readings wait for approval or rejection. Estimates and exclusions record a reason.
  - "Flagged only" filter.
- **Reading app (T6.4):** `/read` is a phone layout for meter readers. It shows only their assigned routes, in sequence, with:
  - previous reading and 3-month average;
  - a large keypad, with consumption and flag warnings as you type;
  - an IndexedDB offline queue that syncs on reconnect, every minute and on demand.
  - Sync is idempotent (dedupe by `client_uuid`, then by period + account) and refuses accounts outside the reader's routes.
  - The service worker (`public/sw.js`) loads `/read` from the network first, falls back to the cached copy, and caches static assets.
  - Web app manifest and icon.
  - Clerks now add zones and routes and assign readers on the Zones & routes page.
- **Billing (T6.5):**
  - Preview, then post per (period, zone) with `runOnce("water-billing", "{period}:{zone}")`. Posting is blocked, naming each account and its problem, until every billable account has an APPROVED reading or an approved exclusion.
  - Basic charge from the Phase 05 rate engine, using the schedule effective on `reading_to`.
  - Senior discount: 5% when eligible on the bill date and ≤ 30 m³.
  - Customer advances are applied automatically.
  - Previous balance is shown on the bill only, never re-posted.
  - Bills are numbered WB-YYYYMM-000000 in route order.
  - ONE SJ entry per run: Dr AR–Water (per customer, net of discount) + Dr Senior Citizen Discounts / Cr Water Revenue–Members and –Non-members (by customer-type snapshot). Advances are in the same entry: Dr Customers' Advances / Cr AR–Water.
- **PDFs (T6.6):** built with `@react-pdf/renderer` and an embedded DejaVu Sans font, so ₱ prints.
  - Reading sheets per route (A4 landscape), with blank Present column for hand-written readings.
  - Bills one per A5 page, single or batched per route in sequence order. Each bill has readings, charge lines, previous balance, total due, due date and a 6-month history.
- **Memos (T6.7):** credit and debit memos on a posted bill. The approver can't be the preparer, and a credit can't exceed what the bill still owes. Approval posts a GJ entry: Dr Water Revenue Adjustments / Cr AR–Water (customer-tagged), or the reverse for a debit memo. Memos appear in the queue, on the bill and in the previous balance.
- **Final bill (T6.8):** closing an account takes a FINAL reading in the zone's open period and posts the final bill at once (its own SJ entry). It also returns the meter to stock, closes the account and records the history. The zone's run then skips the account.
- **Screens:** Meter readings (periods and reading grid), Billing runs (preview and post, bill PDFs per route), Bills & adjustments (search, memo queue, bill detail with memos), a closure form and bill list on the account profile, and a "Reading app (phone)" nav item for readers.

**Decisions** (see Questions Q-06.1–Q-06.8)
- Periods are opened by hand per zone.
- Bills print one per A5 page.
- LOW and ZERO flags come from a new setting, `water.low_flag` (0.3 × average, zero flagged).
- When estimates exceed the next actual use, that month bills 0 m³ and is flagged; the excess isn't carried forward.
- The senior discount applies as in DOMAIN §2.
- Non-member revenue is kept separate.
- The bill-number counter resets yearly.
- The clerk who encodes a flagged reading may also approve it.
- Bills are posted in the SJ (sales journal) and memos in the GJ.

**Deviations from spec (with reason)**
- **Extra table and columns:** `water_billing_exclusions` (for the spec's "approved exclusion with a reason"), plus `water_bills.customer_id`, `reading_id`, `bill_date` and `is_final`, and status and approval columns on adjustments. The spec's data model doesn't list them, but the rules need them.
- **Zone/route maintenance and reader assignment** were built here. They were deferred from Phase 05, and T6.4 needs them for "assigned routes".
- **Readings stay editable until billed**, since they aren't financial rows. Bills and lines are locked by trigger.
- **E2E:** the UI-shell test's "coming soon" examples moved to Phase 07, and Teller dues now hide items already in the cart (Phase 05 change, kept).
- **Opening the reading app with no signal needs a production build:** `next dev` can't hydrate from the cache. That test is tagged `@prod`, the dev E2E run leaves it out (config `grepInvert`), and the new `npm run e2e:prod` builds, starts and runs it.

**Follow-ups**
- **Real-phone exit check is still to do.** Install `/read` on a phone, use airplane mode to read a meter, reconnect, and confirm it synced. Automated Chromium offline emulation passes against the production build (`npm run e2e:prod`), but nobody has done this on a real phone yet.
- Answer Q-06.1–Q-06.8, plus the bill layout and paper size from PCMPC.
- Phase 07: payments update bill status (UNPAID/PARTIAL/PAID), add penalties, and refund deposits on closure.
- The reading grid computes context per account. If a zone grows past a few hundred accounts, batch those queries.

**Exit checks / counts:**
- `npm run gate` is green: 351 tests:
  - unit 194;
  - integration 86;
  - acceptance 71: A0 10 + A1 9 + A2 9 + A3 10 + A4 10 + A5 11 + A6 12.
- `npm run build` is green.
- `npm run e2e` is green: 10 tests, including A6.13 and the offline-queue test.
- `npm run e2e:prod -- phase-06-reader` is green: reopening with no signal.
- Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK.
- Real-phone offline test: pending (needs a person and a phone).

**Addendum (2026-10-09): changes after PCMPC's answers and a gate fix**
- **Gate fix:** the test suite had grown to 16 min and timed out the Stop-hook gate (14 min limit). Tests now reset the DB with DELETE under `session_replication_role = replica` instead of TRUNCATE (TRUNCATE alone was ~2.5 s per test), and run on 4 workers, each with its own copy of the test database. The full suite takes about 3 min; no assertion changed.
- **Reading schedule (Q-06.1):** set by the admin in the setting `water.reading_schedule` (reading start/end day, bill day of the month). It pre-fills each new billing period.
- **Bill paper (Q-06.2):** setting `water.bill_paper`: ¼ of short or long bond (4 bills per sheet, 2 × 2) or ½ lengthwise (2 bills side by side), with dashed cut lines. The default is ¼ short.
- **Minimum consumption (Q-06.3):** set by the admin on each tariff version (min m³ and min charge); the ADMIN role now has `water.rates`.
- **Estimation (Q-06.4):** the number of months averaged (`water.estimate_basis`) is editable in settings. Readers type readings by hand on the keypad.
- **Senior discount (Q-06.5):** kept, with an on/off switch (`enabled`, default on, as DOMAIN §2 and golden A6.7/A6.8 expect).
- **Bill numbers (Q-06.7):** the WB series never restarts. Migration `0012` folds the yearly counter into one running counter.
- **Open:** Q-06.9 asks what "non-member does not have revenue" means for the posting, because golden A6.8 requires a separate non-member revenue account.

**Addendum 2 (2026-10-09): more PCMPC answers**
- **Member vs non-member rates (Q-06.9):** a tariff version applies to all customers, members only, or non-members only (migration `0013`). A bill uses its customer type's own version when one is in effect, otherwise the version for all. The admin adds e.g. a members-only RESIDENTIAL version with a ₱160 minimum on Tariffs & fees; non-members keep ₱200. Low or zero consumption still pays the minimum.
- **Estimates (Q-06.4):** the clerk enters the estimated m³ (the 3-month average is shown as a hint, not used as a default). The API still falls back to the average when no m³ is given (golden A6.6).
- **Reading app:** PCMPC reads meters by hand and encodes them in the office, so the app is optional and the real-phone check is waived.
- **For later phases:** only members may file loans or hold share capital.

**Review follow-ups (reviewer agent, 2026-10-09; merged at Rhold's request)**
- **Fixed:** a credit memo's cap is checked again when it is approved, with the bill row locked, so two pending credits can't together exceed the bill. Tested.
- **Fixed:** a reading the office rejected can be re-sent from the phone; other readings are still never overwritten by a sync. Tested.
- **Fixed (nits):** the senior-discount percentage is printed without float maths; the grid's 3-month average rounds HALF-UP like estimates; an unneeded dynamic import was removed.
- **Added:** a test that the seeded water bill series never resets (year 0).
- **Acceptance file note:** after the test commit, `tests/acceptance/phase-06.test.ts` got one type-only fix: `let zoneId = ""` → `let zoneId = 0`, because zone ids are serial numbers. No golden value or assertion changed. It is recorded here for the human reviewer.
- **Deviations from the spec made on PCMPC's answers (2026-10-09)**, to be folded into PHASE-06 / DOMAIN by a human:
  - tariff versions by customer group (`water_rate_schedules.applies_to`, migration 0013);
  - the settings `water.reading_schedule` and `water.bill_paper`, and `water.senior_discount.enabled`;
  - ADMIN gets `water.rates` (the admin sets the minimum m³ and minimum charge: 10 m³ per house, PCMPC);
  - the WB bill series never resets (migration 0012);
  - clerk-entered estimates.
- **Follow-up for Phase 07:** `previousBalance` skips CANCELLED bills, but cancellation arrives in Phase 07, so add a test there.
- **Follow-up:** the test reset deletes all rows in `public` (as superuser, `session_replication_role = replica`). Data a migration inserts is therefore checked through the seed, not directly.

### Phase 07 summary
**Built**
- **Schema (T7.1):** migrations `0014` and `0015`.
  - Tables:
    - `water_payment_allocations`: from a receipt item or a deposit settlement;
    - `water_penalties`: unique per bill;
    - `water_customer_advances`;
    - `water_disconnections`: one open notice per account; each reconnection-fee receipt used once;
    - `water_production_readings`;
    - `water_deposit_settlements`.
  - Allocations, penalties, advances and settlements are immutable (triggers).
  - `dv_lines.customer_id` lets a DV debit a customer sub-ledger account (the deposit refund).
- **Payments (T7.2):** teller item `WATER_BILL`.
  - Dues show each account's unpaid total, with penalties.
  - Allocation goes oldest bill first, penalty before bill.
  - Overpayment becomes an advance (Cr Customers' Advances), applied by the next billing run.
  - GL: Dr Cash / Cr AR–Water (customer-tagged).
  - The receipt shows the balance after payment.
  - Bill status moves UNPAID → PARTIAL → PAID (a status-only update, which the 0011 trigger allows).
  - Cancelling a receipt restores the bills, but is refused once its advance was applied.
  - Several water items in one receipt never pay the same bill twice.
  - The cashiering registry gained an optional `recorded` hook, which runs after the receipt's item rows exist.
- **Cron and penalties (T7.3):**
  - `src/lib/cron.ts` registry with `runDailyJobs(date)`: `runOnce(job, date)` per job, one transaction each.
  - `GET /api/cron/daily` checks `CRON_SECRET` (Bearer, constant-time compare) and is excluded from the login proxy.
  - `vercel.json` schedules it at 17:00 UTC (1:00 AM Manila).
  - Penalty job: `water.penalty_pct` × the bill's unpaid amount on its due date, once per bill. One GJ per run: Dr AR–Water per customer / Cr Penalty Income–Water.
  - "Run today's daily jobs" button on Collections, for setups without the cron.
- **Disconnection (T7.4):**
  - The list: ACTIVE accounts with ≥ `water.disconnect_after_bills` unpaid bills.
  - Notice: DN number, a "pay by" date `water.notice_days` later, and a printable PDF.
  - Disconnect order: only after the "pay by" date, with a reading → DISCONNECTED. The next billing run skips the account.
  - Reconnect order: needs every arrear and penalty paid, plus a reconnection fee paid after the disconnection → ACTIVE.
  - Notices can be cancelled.
- **Closure (T7.5):** closing an account (Phase 06 final bill) now settles the meter deposit. It offsets what the account owes (GJ Dr Customers' Deposits / Cr AR–Water, allocated oldest first), and the rest is refunded through a DRAFT DV (Dr Customers' Deposits, tagged / Cr Cash on release).
- **SOA (T7.6):** built from the water records:
  - bills, advances applied and penalties;
  - memos and payments;
  - deposit offsets, with a running balance.

  It equals the customer's AR–Water subsidiary in GL (A7.10 and an integration test).
- **Reports (T7.7):** on screen, printable, and exported to Excel (`/api/water/reports/{key}`):
  - billing summary;
  - member vs non-member revenue;
  - daily collection report;
  - AR aging (current / 1–30 / 31–60 / 61–90 / > 90);
  - collection efficiency;
  - disconnection list;
  - disconnection and reconnection log;
  - consumption by zone and route;
  - top consumers;
  - zero-consumption and estimated accounts;
  - senior discount report;
  - NRW (with production meter readings);
  - customer SOA.

  Dashboard tiles (billed, collected, efficiency, accounts for disconnection, NRW %) appear on Water reports, on Collections and on the main Dashboard for water staff. Customer and account profiles show the balance due and link to the SOA.
- **Phase 06 updates:**
  - The previous balance on a bill now counts payments and penalties.
  - The credit-memo limit is what the bill still owes.
  - A bill fully covered by an advance is posted as PAID.
  - Memo approval refreshes the bill status.
- **`npm run water:cycle`** (local only) runs one full simulated cycle on the local data: connect → read → bill → penalty → disconnect → pay → reconnect. It then checks that the bills are PAID and that the SOA and GL AR are both ₱0.00.

**Decisions** (see Questions Q-07.1–Q-07.7)
- Penalty: 10% of the unpaid bill amount on the due date, assessed the day after; final bills too.
- Disconnection after 2 unpaid bills, counting a bill as unpaid even before its due date; 7-day notice.
- Reconnection: everything paid, plus a ₱300 fee paid after the disconnection.
- Overpayment becomes an advance.
- The deposit settles automatically at closure.
- Collection efficiency counts advances applied to a bill as collected, and leaves penalties out.

**Deviations from spec (with reason)**
- **A7.3 golden value:** "₱180.00 left" is tested as ₱140.00. The spec's own allocation (penalty 40, bill 260) leaves 400 − 260 = 140, consistent with A7.4. Rhold approved this on 2026-10-09; PHASE-07 should be corrected.
- **Extra table** `water_deposit_settlements` (records the offset, refund and DV), and allocations can come from a settlement. The spec's data model has no place for the closure offset.
- **`water_customer_advances.applied_bill_id` stays empty:** advances are applied by amount, from the Customers' Advances sub-ledger, and each bill shows `advance_applied`.
- **`issueReceiptAction` now also returns `jeId`** (additive).
- **E2E:** the UI-shell examples moved to Phase 08 (`/share`).

**Follow-ups**
- Answer Q-07.1–Q-07.7.
- **Set `CRON_SECRET` in Vercel** (Settings → Environment Variables); otherwise the daily job refuses to run. Until it's set, use "Run today's daily jobs" on Collections.
- Cancelling a posted bill (status CANCELLED via an approved memo) isn't built yet. `previousBalance` and the balances already skip CANCELLED bills.

**Exit checks / counts:**
- `npm run gate` is green: 386 tests.
- `npm run build` is green.
- `npm run e2e` is green: 11 tests, including A7.14.
- Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK.
- `npm run water:cycle` on the fresh seed data: OK (connect → read → bill 2 months → penalty ₱40.00 → notice DN-2026-00001 → disconnect → pay ₱840.00 + ₱300.00 fee → reconnect; bills PAID; SOA = GL AR = ₱0.00).

**Review follow-ups (reviewer agent, 2026-10-09; merged at Rhold's request)**
- **Fixed (must-fix):** the reconnection fee must be the exact fee amount, and it names the DISCONNECTED account it is for (`RECONNECTION:<account id>`). Only that account can use it, and only if paid after the disconnection. The teller sees it as a due. A fee already used for a reconnection can't be refunded by cancelling its receipt. Other water fees must also be paid in full. Tested.
- **Fixed:**
  - Cancelling a water bill payment is refused when the account was closed and settled, or when the receipt's advance was already used by a billing run (advances are used oldest first).
  - Closing a disconnected account closes its disconnection record.
  - The SOA, NRW and consumption reports skip cancelled bills.
  - Running the daily jobs by hand is audited.
  - Only `/api/cron/daily` bypasses the login redirect.
- **Dropped** the unused `water_customer_advances.applied_bill_id` (migration 0016); bills record `advance_applied`.
- **Not changed (noted):**
  - The Excel export turns peso amounts into spreadsheet numbers. They are exact for any realistic amount and used for display only.
  - `dv_lines.customer_id` makes cashiering reference water customers, the same way journal lines already do.

### Phase 08 summary
**Built**
- **Schema (T8.1):** `share_subscriptions`, `share_transactions` (the member share ledger) and `member_fees`, plus the view `v_member_share_balance` (subscribed, paid-up, unpaid). The view leaves out rows whose receipt was cancelled. Share rows and fees are immutable (triggers); a subscription can only change status. A unit test checks that every GL key the module posts to is mapped.
- **Share service (T8.2/T8.3):** every money movement posts its journal entry in the same transaction as its share rows.
  - **Subscribe:** the first subscription must reach `share.min_subscription_shares` (100 shares). GJ Dr Subscription Receivable / Cr Subscribed Share Capital, member-tagged.
  - **Pay** (teller item `SHARE_PAYMENT`): the teller sees the unpaid subscription as a due. A payment above it is rejected ("Payment exceeds unpaid subscription (₱…)"), unless `share.auto_subscribe_excess` is on (then whole shares are subscribed first). The holding cap (10%) is checked.
  - **Membership fee** (teller item `MEMBERSHIP_FEE`): a due until paid; it must be the exact fee and is paid once. `isGoodStanding()` = paid-up ≥ minimum paid-up and fee paid.
  - **Transfer:** needs both members ACTIVE, a Board resolution no., and an amount ≤ the transferor's paid-up. GL Dr capital (from) / Cr capital (to) nets to zero; both members' ledgers move.
  - **Withdrawal** (termination only): cancels the unpaid subscription and pays out the paid-up in cash from the teller's drawer (cash-out `SHARE_WITHDRAWAL`, through the new generic `payOut()` in cashiering). `registerShareOffset()` is the hook Phase 11 uses to deduct loans first.
  - **Termination rule:** "share capital must be fully withdrawn/settled first (paid-up ₱…, unpaid subscription ₱…)".
  - **For Phase 11:** `cbuLines()` + `retainCbu()` credit CBU retention to paid-up.
  - **ASM:** Σ of the 12 month-end paid-up balances ÷ 12, HALF-UP (new `divide()` in `src/lib/money.ts`).
  - **Cancelling a receipt:** cancelling a share payment or fee receipt takes it off the balances. It's refused if that capital was already transferred or paid out.
- **Screens (T8.4):**
  - **Member profile → "Share capital" tab** (needs `share.read`):
    - subscribed, paid-up, unpaid and the ASM for a chosen year;
    - membership fee and good-standing badges;
    - subscriptions, and the share ledger with running balances.
  - **Forms on the tab:**
    - Subscribe (membership staff);
    - Transfer (manager; finds the other member by member no.);
    - Pay out share capital (teller, with a confirmation).
  - **`/share` registry:** coop totals plus each member's subscribed, paid-up and unpaid, with search. The nav item is live.
  - **Teller desk:** cart amounts can be edited, so a due can be paid in part (e.g. ₱2,500.00 of a ₱10,000.00 unpaid subscription). The server re-checks every amount.
- **Report (T8.5):** the member share ledger for a date range, with the opening balance carried, exported to Excel at `/api/share/ledger?member=&from=&to=` (needs `share.read`).

**Decisions** (see Questions Q-08.1–Q-08.6)
- **Holding cap:** applies only above the minimum paid-up (₱2,500.00). Otherwise no early member could pay the minimum. Transfers don't check the cap.
- **CBU retention above the unpaid subscription:** subscribes whole shares first.
- **Who does what:** subscriptions by membership staff (`members.write`); transfers by the manager (`members.approve`); payouts by the teller (`cash.session`); payments and fees only at the teller.
- **Partial payments:** made by editing the cart amount.

**Deviations from spec (with reason)**
- **Extra columns:**
  - `share_transactions.seq`: same-day rows keep their order in the ledger;
  - `share_transactions.subscription_id` and `receipt_item_id`, plus `member_fees.receipt_item_id`: tie rows to their source, so a cancelled receipt drops out of the balances.
- **Withdrawal is paid out at the teller,** as a cash-out from the open session, not by a DV. The spec says "pays out paid-up"; the teller already handles cash and the drawer check.
- **Phase 08 E2E:** I wrote this file in the tests-first commit; three selectors were fixed since, assertions unchanged:
  - the tab link is matched exactly, because the main nav also has "Share capital & CBU";
  - the "Add" button is taken from the share-capital due row, not the first due.
- **Phase 04 E2E:** the manual item's "Amount" field is now matched exactly. The new cart inputs are labelled "Amount for …".
- **UI-shell E2E / nav unit test:** the "coming soon" example moved to Phase 09 (`/savings`), since `/share` is now live.
- **Vitest DB projects:** test and hook timeout raised to 30 s.
  - A8.6 builds 37 paying members through the real actions. Under load it took 6 s, over Vitest's 5 s default.
  - A test that times out keeps querying while the next test resets the database, which caused a deadlock.
  - No assertion changed.
- **Vitest DB worker count now follows free memory** (1–4, about 0.75 GB each; `PCMPC_TEST_WORKERS=<n>` overrides).
  - The Stop-hook gate went red twice with only timeouts, when the PC had ~2.6 GB free (30 GB committed on 16 GB RAM, ~4,000 pages/s): 474 s, then 532 s.
  - With 2 workers the same suite was green in 360 s.
  - A healthy PC still gets 4 workers.

**Follow-ups**
- Answer Q-08.1–Q-08.4.
- **Phase 11:** register the loan offset (`registerShareOffset`) and call `retainCbu()` on loan release.
- **Phase 15:** `ISC_CAPITALIZED` and `PR_CAPITALIZED` ledger types are ready; nothing posts them yet.
- **Older code** (cashiering, water) runs `Promise.all` on one transaction. pg 9 will refuse this; it now logs a deprecation warning. Fixed in the share module; offered as a separate task.
- **Full E2E on `next dev`:** timing-sensitive on this PC (cold route compiles against the 15 s expect timeout). The full suite is more reliable against a production build: `E2E_SERVER=prod npx playwright test`.

**Exit checks / counts:**
- `npm run gate` is green: 422 tests (35 files), scan clean.
- `npm run build` is green (`/share`, `/api/share/ledger`).
- `npm run e2e -- phase-08` is green (A8.10).
- Full E2E:
  - **Production build:** 13 of 14 green in one run. A3.11 timed out once waiting for the dashboard after sign-in, then passed on rerun.
  - **Dev server:** two full runs each had 2 different 15 s timeouts (slow first-time page renders); every spec passed in at least one run.
- **TB balances after the fixture:**
  - The integration test (subscribe, pay, fee, transfer, withdraw) checks that the TB balances and that GL paid-up equals the share ledgers.
  - A8.7 checks that the TB control totals are unchanged.
  - A8.9 checks that the ledger equals the GL subsidiary at every row.
- Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK; the sample trial balance balances.

**Review follow-ups (reviewer agent, 2026-10-12)**
- **Fixed (must-fix): withdrawals need two people.**
  - The manager approves the withdrawal on the Board's termination resolution (`members.approve`): reason plus resolution no.
  - A different person, the teller, then pays it out from the drawer (`cash.session`). The amount is the paid-up at payout time.
  - Approvals can be cancelled; payout is refused without an approval, or by the approver.
  - New table `share_withdrawals` (migration 0020): APPROVED → PAID or CANCELLED, one open approval per member, with the payout entry. Paying out also marks the member's subscriptions CANCELLED (shown as "withdrawn").
  - Tested, including the denied paths.
- **Fixed:**
  - A second share item in one receipt counts the shares the first item auto-subscribed (it subscribed too many when `share.auto_subscribe_excess` is on).
  - Cancelling a share payment is refused once capital was transferred out or withdrawn *after* it, even if the paid-up still covers it (and the member row is locked).
  - The membership fee can't be taken from a TERMINATED or DECEASED member. The member row is locked, so two tellers can't both collect it.
  - `retainCbu()` checks that the entry credits the member's share capital with exactly that amount, so the share ledger can't drift from the GL. The shares-for-excess maths is now one helper.
  - The Share tab's ASM year accepts only 1900–2099 (a year like 0000 crashed the page). The ledger export refuses `from` after `to`.
  - The teller item validates the stored breakdown instead of casting it. The unused `shareBalances` was removed.
- **New tests:**
  - immutability triggers (share rows, fees, subscriptions);
  - the permission matrix of the share actions;
  - a terminated member's water customer becomes NON_MEMBER;
  - `divide()` HALF-UP;
  - the reversed export date range.
- **Logged as Questions:** Q-08.1 now says the cap doesn't apply to transfers or CBU retention; new Q-08.5 (ASM rounding) and Q-08.6 (good standing for associate members).
- **Not changed (noted):**
  - The `/share` registry is the nav item Phase 08 owns (`nav.ts`, phase "08").
  - The Vitest worker-count change stays on this branch (it was needed to get the gate green).
  - The fourth copy of the Excel `pesos()` helper and fractional-share transfers are left as they are.
- **After the fixes:** `npm run gate` green (430 tests, 35 files; 2 DB workers at 2.2 GB free memory, 260 s), `npm run build` green, `npm run e2e -- phase-08` green (A8.10 and the new withdrawal flow: the manager approves, the teller pays out, the balances settle to ₱0.00).

### Phase 09 summary
**Built**
- **Schema (T9.1):**
  - `deposit_products`: the configuration, seeded with Regular Savings "SAV" from the DOMAIN §2 savings defaults and Time Deposit "TD" at 3%, CONFIRM.
  - `deposit_accounts` (SA-/TD- numbers): OPEN / DORMANT / CLOSED.
  - `deposit_transactions`, the passbook: signed amounts with `balance_after`; immutable (trigger).
  - `time_deposits`: certificates; after placement only the closing fields change, once (trigger).
  - A unit test checks the GL mappings.
- **Deposit service (T9.2):**
  - Open: ACTIVE members only, "Member must be ACTIVE"; one Regular Savings account per member.
  - Deposits: teller receipt item `SAVINGS_DEPOSIT`. A deposit to a dormant account reopens it. Cancelling the receipt adds an ADJUSTMENT on the reversal entry, refused if the money was already withdrawn.
  - Withdrawals: teller cash-out `SAVINGS_WITHDRAWAL`, never below the maintaining balance, and not from a dormant account.
  - Close: pays out the whole balance. Refused while a time deposit pays back into the account.
  - Reactivate: manager, with a reason.
  - Passbook with a date range.
  - Termination rule: "all deposit accounts must be closed (zero balance) first (…)".
- **Interest (T9.3):**
  - Pure engine (`savings/interest.ts`): Σ daily closing balances, ADB, and interest = Σ × rate ÷ 365, rounded HALF-UP once per account (new exact `mulRateRatio()` in `money.ts`). Zero below the minimum ADB.
  - Quarterly run `savings-interest:{product}:{periodEnd}` (runOnce): preview, then post.
  - One GJ entry dated the quarter end: Dr Interest Expense / Cr Savings Deposits per member (net) / Cr Withholding Tax Payable. INTEREST and WTAX passbook rows.
  - Only after the quarter ends, and only on quarter ends.
- **Time deposits (T9.4):**
  - Place: from the member's savings account, keeping its maintaining balance (GJ Dr Savings Deposits / Cr Time Deposits).
  - Mature: from the maturity date; principal × rate × term ÷ 365, to savings.
  - Pre-terminate: before maturity, at the regular savings rate for the days held.
  - Roll over: a new certificate on the same TD account, with or without the interest.
- **Dormancy job and teller (T9.5):**
  - Daily job `savings-dormancy`: OPEN accounts with no deposit or withdrawal for the product's months (counted from the opening if there was none) become DORMANT. The job is idempotent per date.
  - Teller: the member's savings accounts appear as **open-amount** deposits (a new `openAmount` option on cashiering dues; the teller types the amount in the cart).
- **Screens (T9.6):**
  - Member profile **Savings** tab (`savings.read`): balance, passbook, withdraw / close / reactivate, time deposits (place, mature, pre-terminate, roll over).
  - **Savings accounts**: totals, search, dormant filter.
  - **Time deposits**: by maturity, flagging the ones due.
  - **Interest runs** (`savings.run_interest`): preview by product and quarter, then post once; list of posted runs.
  - **Savings products** (admin edits, others view). The savings settings on Coop settings are now read-only and link there.

**Decisions** (see Questions Q-09.1–Q-09.7)
- One Regular Savings account per member.
- TD at 3% with any term in days; the rate is fixed at placement.
- TDs are funded from and paid back to savings.
- Closed accounts earn no interest for the quarter; dormant accounts earn.
- Withholding tax 0% (HALF-UP per account when set).
- The manager reactivates dormant accounts; tellers handle accounts and cash.
- The interest run uses the product's current rate for the whole quarter.

**Deviations from spec (with reason)**
- **TD placement posts Dr Savings Deposits instead of Dr Cash (DOMAIN §6).** Time deposits move money to and from the member's savings account, so every peso still passes through the teller once (PLAN rule 9) without a third teller registration. Q-09.3.
- **Extra columns:**
  - `deposit_transactions.receipt_item_id`, `seq` and `remarks`;
  - `time_deposits.savings_account_id`, `rolled_from_id`, `closed_at` and `close_je_id`;
  - `deposit_products.active` and the three GL keys.

  They tie rows to their source and keep the passbook in order.
- **Cashiering changes:**
  - Receipt cancellation now posts the reversal entry *before* running the items' `reverse` hooks (same transaction), and gives them `ctx.cancelJeId`, so corrections tie to the reversal.
  - Dues can be `openAmount`; the teller desk lists them under "Deposits".
- **E2E:** the UI-shell and nav examples of a "coming soon" screen moved to Phase 10 (`/loans/applications`).

**Follow-ups**
- Answer Q-09.1–Q-09.7, and the TD rate table if PCMPC has rates per term.
- A printable passbook layout (out of scope; Backlog).
- Large-withdrawal approval or limits, if PCMPC wants them (Q-09.6).

**Exit checks / counts:**
- `npm run gate` is green: 470 tests (39 files), scan clean. Phase 09 adds:
  - 10 acceptance tests (A9.1–A9.10);
  - 16 integration tests;
  - 14 unit tests (interest engine including `mulRateRatio`, and mappings).
- `npm run build` is green (`/savings`, `/savings/interest`, `/savings/products`, `/savings/time-deposits`).
- `npm run e2e -- phase-09` is green: A9.11, and the products / interest-run smoke test.
- The full E2E against a production build is green: 17 of 17 (phases 00–09).
- Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK (8 seed steps, including the deposit products); the sample trial balance balances.

**Review follow-ups (reviewer agent, 2026-10-12)**
- **Fixed (must-fix): the opening balance of an interest quarter.**
  - It is now the sum of everything dated before the quarter.
  - Before, it was the stored balance of the last earlier-dated row. Interest dated Mar 31 but posted on Apr 1, after an Apr 1 deposit, made the next quarter count that deposit twice.
  - The passbook (and its date-range view) is now shown in date order with the running balance computed from the amounts.
  - A re-preview of a quarter after its run leaves out that quarter's own interest.
  - Tested: Q2 ADB ₱15,049.32 after an Apr 1 deposit and a late Q1 run; the re-preview equals the posted ₱4,931.51.
- **Fixed:**
  - Quarters must be run in order.
  - An account can be closed only after the last finished quarter's interest is posted (Q-09.4 rewritten to say what the code does).
- **Lock order fixed:**
  - Receipt cancellation runs the items' checks (and their sub-ledger locks) *before* the reversal entry again, the same order as issuing.
  - A new optional `reversed` hook writes the savings ADJUSTMENT on the reversal entry (`ctx.cancelJeId`) afterwards.
  - Withdrawals and closures lock the teller session before the account.
- **Permissions:** withdrawals and closures need `savings.post` as well as `cash.session`.
- **Smaller fixes:**
  - The rate field accepts tiny rates without "1e-7".
  - The dormancy job moved to `savings/jobs.ts`.
  - New index on `time_deposits.savings_account_id` (migration 0023).
  - The rollover `je_id` comment and the products-page wording were corrected.
- **New tests:**
  - mid-quarter opening (Q-09.8);
  - dormancy from the opening date, leaving closed accounts alone;
  - time deposit with 20% withholding tax (net ₱591.78 to savings, Withholding Tax Payable credited);
  - the pre-termination GL;
  - `lastQuarterEnd`.
- **Logged as Questions:** Q-09.8 (ADB for mid-quarter openings), Q-09.9 (member status for deposits and withdrawals), Q-09.10 (TD interest rounding). Q-09.7 now notes that interest needs the quarter's last month open.
- **Backlog:** a correction path for savings postings (a JV reversal from the Journal screen would not update the passbook).
- **Not changed (noted):**
  - Reactivation keeps `members.approve` (the manager, as for share transfers and withdrawal approvals).
  - The "one Regular Savings account" rule is enforced under the member row lock, not by an index.
  - `interest_basis` and `crediting` describe the only method the engine has.
  - TD accounts show their certificates, not a separate passbook.
  - Pre-termination uses the Regular Savings product's rate (the only `td.pretermination_rate` choice).
  - The deviation "TD funded from savings (Dr Savings Deposits)" needs PCMPC's sign-off (Q-09.3).
- **After the fixes:**
  - `npm run gate` green: 478 tests, 39 files. Only 1.5 GB of memory was free, so it ran on 1 DB worker (572 s).
  - `npm run build` green.
  - `npm run e2e -- phase-09` green: 2 tests.

### Phase 10 summary
**Built**
- **Schema (T10.1):**
  - `loan_products`, `loan_product_deductions`.
  - `loan_applications` (LA-YYYY-#####), with snapshots of rate, method, eligibility, schedule preview, deductions and net proceeds. After submission only the status changes (trigger).
  - `loan_application_comakers` and `loan_approvals`: insert-only (triggers).
  - Seeded with the DOMAIN §2 sample products REG/EMR/PRD and their deductions (CONFIRM). A mappings check covers every receivable and deduction account.
- **Amortization engine (T10.2, `loans/amortization.ts`, pure):**
  - Diminishing equal amortization: A = P·r ÷ (1 − (1+r)^−n), HALF-UP.
  - Diminishing equal principal: P ÷ n, interest on the opening balance.
  - Add-on: I = P × r × n, payment (P + I) ÷ n.
  - Every row's interest is HALF-UP; the last row absorbs the residue; due dates are `addMonths(first, k)`, clamped.
  - Tested with the goldens and a 600-loan property test (principal sums to P, balance ends at 0).
- **Net proceeds (T10.3):** deductions by percentage (HALF-UP) or fixed amount, and the net. Also the effective interest rate (monthly IRR) for the disclosure.
- **Eligibility (T10.4):** five rules, each pass/fail with a message, kept on the application:
  1. ACTIVE and in good standing ("Member must be ACTIVE" / "Member is not in good standing (…)");
  2. "Exceeds loanable amount ₱…" (product max and the multiple of paid-up);
  3. term;
  4. past due;
  5. comakers (count, ACTIVE, not the borrower, not twice, not past due).

  The past-due checks are a hook registry (`registerPastDueHook`) that Phase 11 fills in; `loan.block_if_past_due` turns them off.
- **Applications (T10.5):**
  - Submit (loan officer). The manager reviews: up to `loan.manager_approval_limit` that APPROVES it, above it the application is RECOMMENDED and a Credit Committee member APPROVES it.
  - The encoder can never decide (SoD), and a person decides once. Rejection needs remarks.
  - Eligibility is re-checked on approval.
  - The encoder can cancel an undecided application.
  - Product admin (terms and deductions; applications keep their snapshot).
- **Screens (T10.6):**
  - **Loan calculator** (all staff): schedule, deductions, net proceeds, effective rate.
  - **Loan applications**: queues for the manager and the Credit Committee.
  - **New application**: borrower and comaker lookup by member no., live schedule preview in the browser.
  - **Application page**: eligibility results, decisions, approve/reject, cancel.
  - **Disclosure statement** (RA 3765, printable).
  - **Loan products** (admin edits).

**Decisions** (see Questions Q-10.1–Q-10.6)
- Sample products as in DOMAIN, with 1 comaker for REG and PRD and none for EMR.
- Any one Credit Committee member's approval suffices above the limit.
- The tentative first due date is one month after the application.
- The disclosure statement treats CBU as the member's capital, not a finance charge, and computes the EIR on the amount financed.
- Comakers must be ACTIVE (good standing not required).
- Eligibility is re-checked on approval.
- **Cancel (not in the spec):** the encoding loan officer can cancel an undecided application (with a reason), so a member who withdraws doesn't leave it in the queues.

**Deviations from spec (with reason)**
- **No DRAFT status.** Applications start SUBMITTED, as the spec's workflow says, though DOMAIN §4 lists DRAFT first.
- **Approval levels follow permissions.** A decider who holds `loans.recommend` (the manager) acts at the MANAGER level on SUBMITTED applications; one who only holds `loans.approve` (the Credit Committee) acts on RECOMMENDED ones. So A10.8's loan officer is refused with Forbidden: they lack `loans.approve`, and SoD would refuse them anyway.
- **Extra snapshot columns on `loan_applications`:** `method`, `rate_pm`, `first_due_date`, `deductions`, `net_proceeds` and `total_interest`, so the disclosure and the Phase 11 release use exactly what was approved.
- **E2E:** the "coming soon" example moved to Phase 11 (`/loans/servicing`).

**Follow-ups**
- Answer Q-10.1–Q-10.6, and send the PCMPC loan policy (products, rates, deductions, comaker rules, approval limits).
- **Phase 11:** register the past-due hooks, release approved applications (with the real schedule), and post the GL.

**Exit checks / counts:**
- `npm run gate` is green: 514 tests (43 files), scan clean. Phase 10 adds:
  - 10 acceptance tests (A10.1–A10.10);
  - 12 integration tests;
  - 14 unit tests (engine goldens, the 600-loan property test, net proceeds, EIR, mappings).
- `npm run build` is green (`/loans/calculator`, `/loans/applications`, `/new`, `/[id]`, `/[id]/disclosure`, `/loans/products`).
- `npm run e2e -- phase-10` is green: A10.11, and the loan products smoke test.
- The full E2E against a production build is green: 19 of 19 (phases 00–10).
- Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK (9 seed steps); the sample trial balance balances.

**Review follow-ups (reviewer agent, 2026-10-12)**
- **Fixed (must-fix):** a small application gave a server error when the deductions were more than the loan.
  - Products now have a minimum amount: ₱1,000.00 for the samples (Q-10.9; migration 0026). Rule 2 says "The smallest Regular Loan is ₱1,000.00".
  - A product whose deductions don't fit returns a message.
  - Percentage deductions can't reach 100%, and fixed deductions can't take the whole minimum.
  - The form disables Submit when the deductions don't fit.
- **Fixed (must-fix):** the engine kept its invariants only above a few pesos.
  - Equal-principal and add-on rows are now clamped to what is left, so no row is negative.
  - A boundary sweep tests 1 centavo to ₱50 at 1 to 360 months, 4 rates and every method. The property test now also asserts principal ≥ 0, and its generator is exact (MINSTD).
- **Fixed:**
  - **One effective interest rate** (the disclosure's: the monthly IRR of the amount financed, CBU not a finance charge). The calculator shows the same figure: 1.9924% a month on REG ₱10,000 for 12 months.
  - **More snapshots for Phase 11:** the application keeps the receivable account, penalty rate and grace days (the disclosure prints them from the snapshot). Each approval keeps its eligibility re-check and the status it led to; the page shows "recommended to the Credit Committee".
  - **Status transitions only move forward in the database** (trigger: SUBMITTED → RECOMMENDED / APPROVED / REJECTED / CANCELLED, RECOMMENDED → APPROVED / REJECTED / CANCELLED, APPROVED → RELEASED / CANCELLED).
  - **Disclosure statement:** a "PREVIEW" banner until approved, none for rejected or cancelled applications, dated the approval, and the annual figure labelled the simple annual rate.
  - **Loan penalty and grace settings** on Coop settings are read-only and link to Loan products (each product carries them).
  - **Calculator:** keeps to the product's term and amount limits and says so; the EIR search was cut to 60 halvings, plenty for 6 decimals.
  - **Past-due hook:** the default pass hook is registered now (`loans/hooks.ts`, name "loans"; Phase 11 replaces it).
  - **Smaller fixes:** a ₱1,000,000,000.00 ceiling per loan; the deduction→account table is shared by the service and the form; rates are shown without float maths; `previewLoan` lost its unused overrides.
- **New tests:**
  - the minimum and deduction guards;
  - the snapshots;
  - "a person decides once" and encoder SoD at both levels;
  - the status transitions in the database;
  - the EIR basis.
- **Logged as Questions:** Q-10.7 (loanable amount vs. existing loans and pending applications), Q-10.8 (rounding points not in DOMAIN §3), Q-10.9 (smallest loan). The cancel flow is under Decisions.
- **Not changed (noted):**
  - The approval level comes from `loans.recommend` (no role holds `loans.apply` and `loans.approve` together, so SoD is covered by the service-level tests).
  - Products and their deductions are read in two statements.
  - T10.2/T10.3 and T10.4/T10.5 were committed together.
- **After the fixes:**
  - `npm run gate` green: 522 tests, 43 files. Only 1.8 GB of memory was free, so it ran on 2 DB workers (469 s).
  - `npm run build` green.
  - `npm run e2e -- phase-10` green: 2 tests.

### Phase 11 summary
**Built**
- **Schema (T11.1):**
  - `loans` (LN-YYYY-#####; PENDING → ACTIVE/PAST_DUE → PAID/RESTRUCTURED/WRITTEN_OFF; terms copied from the application).
  - `loan_schedule`: due amounts frozen, paid amounts updated.
  - `loan_payments`: with their per-installment allocation, so a reversal is exact.
  - `loan_penalty_accruals`: basis × days.
  - `loan_aging_snapshots`.
  - Triggers keep terms, due amounts, payments (except the reversal mark) and accruals immutable.
  - New account 44140 Recovery of Loans Written Off (CONFIRM).
- **Release (T11.2), two people:**
  - A manager who is neither the encoder nor an approver authorizes it (first due date ≤ 3 months, cash or savings). The loan is PENDING.
  - A teller pays out the net proceeds (cash-out LOAN_PROCEEDS through `payOut`, with the drawer check). Proceeds credited to savings are released at once.
  - The release entry: Dr Loans Receivable / Cr Cash or Savings (net) / Cr service fee and notarial income / Cr Subscription Receivable for CBU (`share.cbuLines` + `retainCbu`). The schedule comes from the Phase 10 engine.
- **Payments (T11.3):**
  - Teller receipt item LOAN_PAYMENT: penalty → interest → principal, oldest installment first; the excess advances the next installments. It can't exceed what is still owed. GL: Cr Fines and Penalties Income / Interest Income / Loans Receivable.
  - Cancelling the receipt reverses the latest payment exactly, and a PAID loan reopens.
- **Penalties and the daily job (T11.4):**
  - Unpaid installment × rate × days ÷ 30 once past the grace days, accrued by `loans-daily` (runOnce per date). Σ(basis × days) is rounded once, so daily runs and a catch-up run give ₱18.34 either way.
  - The job also refreshes ACTIVE/PAST_DUE and writes the aging snapshot.
- **Aging and PAR (T11.5):** days past due from the oldest unpaid installment, the `loan.aging_buckets`, PAR over `loan.par_threshold_days`, and a delinquency list with the borrower's and comakers' mobile numbers.
- **T11.6:**
  - Write-off on a Board resolution (Dr Allowance / Cr Loans Receivable), then recoveries at the teller (Cr 44140).
  - Restructure into a new loan (principal + due interest + penalties).
  - Termination offset: share capital pays the loans first on withdrawal (share offset hook, now with a `recorded` callback).
  - Pay from savings.
  - Past-due eligibility hook (borrower and comakers) and the `canTerminate` loan rule.
- **Screens (T11.7):**
  - Authorize release on the application page.
  - Loan ledger card `/loans/{id}`: pay out, write-off, restructure, pay from savings, installments, payments.
  - Releases & collections queues.
  - Aging & PAR with the delinquency list.
  - PAR tiles on the dashboard.
  - Member profile Loans tab.
- **Teller (T11.8):**
  - LOAN_PAYMENT dues (what is due now incl. penalties, or the next installment; recoveries for written-off loans) and LOAN_PROCEEDS.
  - Water bills can now be paid on a **member's** receipt (the member's own water customer), so A11.14's single receipt holds all five modules.

**Decisions** (see Questions Q-11.1–Q-11.7)
- **Release:** two-person; cash or savings.
- **Penalty:** counted from the due date once past grace, computed exactly; income on collection.
- **Payments:** no pay-off discount of future interest.
- **Recoveries** go to a new Other Income account.
- **Restructure** capitalizes due interest and penalties.
- **Termination:** share capital is offset first.
- **PAST_DUE** from the day after a missed due date.

**Deviations from spec (with reason)**
- **Release has a PENDING step** (authorize → pay out). The spec says release is by `loans.release` (≠ approver) and registers the LOAN_PROCEEDS cash-out; the manager holds no teller drawer, so the cash leaves through a teller.
- **Extra columns:**
  - `loans`: `disbursement`, `savings_account_id`, `deductions`, `net_proceeds`, the penalty and grace snapshot, `authorized_by`/`released_by`, the write-off fields, `restructured_from_id`.
  - `loan_payments`: `kind` (PAYMENT / OFFSET / RECOVERY), `allocations`, `receipt_item_id`, `remarks`.
  - `loan_penalty_accruals`: `basis` and `days`.

  They are needed for the exact reversal, the drift-free penalties and the release audit trail.
- **Other modules:**
  - Water's WATER_BILL accepts a MEMBER payor for the member's own water accounts (A11.14).
  - Savings exposes transfer helpers.
  - The share offset hook gained `recorded`.
  - The Phase 10 pass hook was replaced by the real past-due check.
- **Fixtures (tests only):** REG is set to 4× paid-up in the Phase 11 helpers (the golden ₱10,000 loan on ₱2,500 paid-up). A11.14's fixture adds 14 ₱2,500 shareholders so the member's ₱1,000 share payment stays within the 10% holding cap.
- **E2E:** the "coming soon" example moved to Phase 12 (`/store/inventory`).

**Follow-ups**
- Answer Q-11.1–Q-11.7.
- Allowance (provision) entries per aging bucket (`loan.allowance_rates`) are for Phase 14 (period close).
- The loanable amount still ignores existing balances (Q-10.7).

**Exit checks / counts:**
- `npm run gate` is green: 550 tests (45 files), scan clean. Phase 11 adds:
  - 13 acceptance tests (A11.1–A11.12, A11.14);
  - 15 integration tests: release SoD, savings release, teller payout, payment reversal, catch-up penalties, restructure and termination with the trial balance balanced, recovery, pay from savings, past-due eligibility.
- `npm run build` is green (`/loans/[id]`, `/loans/servicing`, `/loans/aging`).
- `npm run e2e -- phase-11` is green: A11.13 (release → pay at the teller → the ledger card shows ₱4,166.67).
- The full E2E against a production build is green: 20 of 20 (phases 00–11).
- The trial balance balances after release, payment, write-off, recovery, restructure and termination (integration tests).
- Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK (9 seed steps); the sample trial balance balances.

**Review follow-ups (reviewer agent, 2026-10-12)**
- **Fixed (must-fix): a loan waiting for its payout could get stuck.**
  - Once its first due date passed, the payout was refused for good: the application was RELEASED (final), the first due date was frozen, and nothing could re-authorize or cancel it. The loan stayed PENDING and blocked the member's termination.
  - Now a manager who neither encoded nor approved it can **authorize it again** with a new first due date (eligibility is re-checked), or **cancel** it with a reason. A cancelled loan is CANCELLED, its application is CANCELLED too, and nothing was posted.
  - Migration 0030: the CANCELLED status; the loans trigger lets the first due date, maturity and authorizer change only while PENDING; the application trigger allows RELEASED → CANCELLED only when its loan was cancelled.
  - The loan page explains a passed first due date and shows the forms.
- **Fixed (must-fix): "As of" on Aging & PAR was not historical.** An earlier date read today's schedule with a different day count.
  - Now today's aging is live, and an earlier date reads that day's snapshot from the daily job, so later payments don't change it.
  - A date with no snapshot says so; a future date shows today's.
  - Snapshots now keep the amount past due (new nullable column).
- **Fixed:**
  - **Closed loans show no live balance:** a restructured, written-off or cancelled loan shows ₱0.00 outstanding (the member Loans tab and the loan card); a written-off loan shows what is left to recover.
  - **Restructured loans keep their comakers** on the delinquency list (followed back to the original application).
  - **Payout SoD:** the manager who authorized a release can't also pay it out; the page hides the button for them.
  - **Eligibility is checked again** when a release is authorized (or authorized again) and at the payout (shared with approval: `assertStillEligible`).
  - **Restructure needs a Board resolution no.**, kept on the new loan (`restructure_ref`) and as the entry's reference.
  - **Mobile numbers on the delinquency list follow the masking policy:** full numbers only with `members.read_sensitive` (manager, auditor).
  - **Journal screen:** only manual JVs (and entries with no business record) can be reversed there. An entry posted by a module (receipts, bills, loans, savings, shares) is corrected in its module, so its records follow; the page says so.
  - **Settings:** "When loan interest is recorded as income" is read-only (only on collection is built); the payment allocation must list penalty, interest and principal once each; a payment that can't be fully applied is refused.
  - **The first due date limit** (3 months) is a setting, `loan.max_first_due_months` (CONFIRM).
  - **Share offsets on termination** record the teller as the loan payment's creator.
  - **Loans trigger:** the release and write-off fields are recorded once, and the closing date changes only with the status.
- **New tests:** authorize again and cancel; payout SoD; encoder SoD; eligibility at release and payout; the forbidden checks on every servicing action; aging from the snapshot; comakers after a restructure; closed balances; the Board resolution; the Journal-screen refusal; the allocation setting; the trigger rules.
- **Logged:**
  - As Questions: Q-11.8 (the golden REG loan vs. 3× paid-up), and the Q-11.5 note (restructure income vs. interest on collection).
  - As Backlog: corrections for payments made without a receipt; the penalty on the payment day; the lock order with the daily job; concurrency tests; members with written-off loans.
  - Q-10.7 (netting existing loans from the loanable amount) is still open: it is outside the Phase 11 spec.
- **Not changed (noted):**
  - The restructure still has one person: the manager, on the Board's resolution.
  - A11.6 and A11.7 test the pure helpers; the dashboard tile uses the same `portfolio()`.
- **After the fixes:**
  - `npm run gate` green: 555 tests, 45 files, scan clean (1 DB worker; little memory free).
  - `npm run build` green.
  - E2E on a production build green: phase-11 (A11.13), phase-10, phase-03 and settings.
  - Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK (migration 0030; the new setting is seeded).

### Phase 12 summary
**Built**
- **Schema (T12.1):** categories, products (SKU, barcode, unit, selling price, reorder level, VAT class, active), price history, suppliers (terms), purchase orders and lines, receiving reports and lines, the stock ledger (`stock_moves` with the balance after each move; one `stock_balances` row per product), stock counts and lines.
  - Triggers keep moves, receiving reports, their lines and price history immutable; PO and count statuses move forward only; products, suppliers and categories are deactivated, never deleted.
  - **AP sub-ledger:** `journal_lines.supplier_id` (see Decisions). AP–Trade requires the supplier on every line, including DV lines (`dv_lines.supplier_id`); a manual DV can't debit AP–Trade without one.
  - New permissions `store.read` and `store.po_approve`; new account 44150 Inventory Overage (CONFIRM); number series SC (stock counts).
- **Stock engine (T12.2, pure):** the moving average stored at 4 decimals (HALF-UP) with the value in centavos as the source of truth; COGS = qty × average rounded to the centavo, except the issue that empties the stock takes the remaining value; never below zero ("Insufficient stock (15)"). Property tests over 300 random runs: the value never goes negative and Σ moves = the balance.
- **Item master (T12.3):** the manager keeps categories, products and prices (every price change kept in the history); the store clerk keeps suppliers. Stock planning locks the products' balances in product order (no deadlocks) and applies the moves in order.
- **Purchasing (T12.4):** the clerk prepares a PO, the manager (not the preparer) approves or cancels it; deliveries are received against it in parts (never more than is still to come), or without a PO.
  - A receiving report posts at once: stock in at cost and one Purchases Journal entry, Dr Merchandise Inventory / Cr AP–Trade tagged with the supplier; the delivery is due on its receiving date plus the supplier's terms.
  - Cash on delivery also creates a supplier payment voucher for the teller (CONFIRM Q-12.4).
  - Supplier payments: the bookkeeper prepares a DV (up to what is owed less vouchers already prepared), the manager approves, a teller releases it: Dr AP–Trade (the supplier) / Cr Cash on Hand or Cash in Bank.
- **Counts (T12.5):** the clerk counts blind (all active products or a category); the system quantities are taken on submission; nothing is posted until the manager (not the preparer) approves. Approval posts one entry: shortages Dr Inventory Losses / Cr Merchandise Inventory at the moving average, overages Dr Merchandise Inventory / Cr Inventory Overage at the average cost. A variance of no value needs no entry.
- **Reports (T12.6):** the stock card (opening, each move with its RR or count, closing), inventory valuation as of a date with the GL Merchandise Inventory balance beside it (they agree), the reorder list (with what is on order) and supplier payables aging (oldest deliveries settled first; groups in `store.ap_aging_buckets`).
- **Screens:** Products & inventory (list, product page with the stock card and price history, new product, categories, stock counts, valuation, reorder list) and Purchasing (purchase orders, receiving, suppliers with their ledger, payables with the pay-supplier form). Both are live in the navigation.

**Decisions** (see Questions Q-12.1–Q-12.8 and the Decisions log)
- The supplier sub-ledger is a tag on the journal lines (no separate AP ledger to reconcile).
- Whole-unit quantities; VAT-exempt by default; blind counts; receiving without a PO allowed; payables due on receipt + terms, paid oldest first.

**Deviations from spec (with reason)**
- **Cash deliveries are paid by a DV, not credited to Cash by the RR:** the receiving report credits AP–Trade and creates a cash payment voucher that a teller releases from the drawer. PLAN §5 rule 9 (every cash-out goes through the counter); the store clerk holds no drawer. The net GL effect is the same (Dr Inventory / Cr Cash once the voucher is released).
- **New permissions:** `store.read` (store pages) and `store.po_approve` (PO approval); the catalog had none for either.
- **New account and settings:** 44150 Inventory Overage (count overages; DOMAIN §6 has only shortages), `store.ap_aging_buckets`, number series SC.
- **Extra columns:** `receiving_reports.due_date` and `dv_id`, `stock_moves` keeps the balance after each move (`qty_after`, `avg_cost_after`, `value_after`) and `stock_counts.je_id`; `stock_count_lines.variance_value` holds the posted value. `stock_moves.je_id` may be empty only for a move of no value (migration 0033).
- **Navigation tests:** the "coming soon" example moved to Phase 13 (`/store/pos`).

**Follow-ups**
- Answer Q-12.1–Q-12.8.
- Backlog: purchase returns and corrections of a posted receiving report; supplier tags in the manual JV and DV forms (needed for Phase 17 opening balances).
- Phase 13 sells through `planStockMoves` / `recordStockMoves` (SALE out at the moving average, RETURN in at the original unit cost).

**Exit checks / counts:**
- `npm run gate` is green: 587 tests (48 files), scan clean. Phase 12 adds:
  - 8 acceptance tests (A12.1–A12.7; A12.1 both on the engine and through receiving reports);
  - 20 integration tests (data rules, item master, purchasing and payments, counts, reports);
  - 4 unit tests (the stock engine, including the property test).
- `npm run build` is green (the 17 store routes).
- `npm run e2e -- phase-12` is green: A12.8 (product → PO → approval → receiving → the stock card shows 10 @ ₱1,200.0000, ₱12,000.00).
- The full E2E against a production build is green: 21 of 21 (phases 00–12).
- The valuation total equals the GL Merchandise Inventory balance (A12.7 and on past dates), and the trial balance balances after receiving, supplier payments and counts (integration tests).
- Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK (9 seed steps); the sample trial balance balances.

**Review follow-ups (reviewer agent, 2026-10-13)**
- **Fixed (must-fix): the stock card and the valuation could read a stale balance.**
  - Moves were ordered by date, then the transaction's start time and a random id. Two lines of the same product on one receiving report (one insert), or two reports at the same moment, could sort in the wrong order. "Latest" then picked an earlier balance: the valuation disagreed with the GL, and the stock card closing was wrong.
  - Moves now carry `seq`, an identity taken while the product's balance is locked, so it is the order they were applied. The stock card and the valuation order by it (migration 0034).
  - Tests: a report with the same product on two lines; two reports at once (the stock card closing equals the balance, and the valuation equals the GL).
- **Fixed:**
  - **One open count per product:** a product on a draft or submitted count can't be put on another, so a variance can't be posted twice. Creating a count locks the products' balances.
  - **The manager sends a submitted count back to the clerk** with a reason; it is a draft again, and the system quantities are taken again on the next submission. The trigger now allows SUBMITTED → DRAFT.
  - **Separation of duties in the database:** a PO's approver isn't its preparer, and a count's approver is neither its preparer nor whoever submitted it (`submitted_by`, new).
  - **A supplier invoice no. is received once** (unique per supplier, ignoring case), with a plain message.
  - **The count page no longer fails** when a shortage's product has since run out (it is worth ₱0.00 then).
  - **Limits:** quantities 1 to 1,000,000 and unit costs up to ₱10,000,000.00 per line, and counted quantities up to 10,000,000, all with plain messages (no database error).
  - **A count of all products** includes inactive products that still have stock.
  - **The reorder list** leaves out products with no reorder level.
  - **docs/coa/README.md:** PCMPC's chart must also map the CONFIRM keys `recovery_income_loans` and `inventory_gains`.
- **New tests:**
  - an issue through the stock service (as the POS will), refused below zero with nothing written;
  - a reversal keeps the supplier tag;
  - the database's SoD checks;
  - return to the clerk;
  - one open count per product;
  - duplicate invoices;
  - the limits.
- **Logged:**
  - As Questions: Q-12.6 now asks whether a delivery without a PO above an amount needs approval; Q-12.7 notes one open count per product and the return.
  - As Backlog: block manual JVs to Merchandise Inventory; truly blind counts (the Products page shows quantities).
- **Note:** databases set up before Phase 12 need `npm run db:migrate && npm run db:seed` (the SC series, account 44150 and its mapping, `store.ap_aging_buckets`, the new permissions).
- **After the fixes:**
  - `npm run gate` green: 594 tests, 48 files, scan clean. Phase 12 now has 27 integration tests.
  - `npm run build` green.
  - E2E on a production build green: phase-12 (A12.8) and ui-shell.
  - Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK (migration 0034).

### Phase 13 summary
**Built**
- **Schema (T13.1):**
  - Tables: POS shifts, sales and sale lines, returns and return lines, member charge limits.
  - Triggers: sales and returns are records, never changed. A shift keeps its cashier, date and opening fund; it moves OPEN → CLOSED → VERIFIED and closes and is verified once. One open shift per cashier.
  - Number series SR (returns); permission `store.supervise` (manager).
- **Sales (T13.2):**
  - A sale needs the cashier's open shift for today. Prices come from the item master, never the screen.
  - Cash: the amount tendered covers the total, and the change is given. Charge: an ACTIVE member only, and what they owe plus the sale stays within their credit limit; the member is locked while it is checked.
  - Stock goes out at the moving average (Phase 12 engine).
  - One Sales Journal entry per sale: Dr Cash or AR–Members (member-tagged) / Cr Sales; Dr COGS / Cr Merchandise Inventory.
  - `storePatronage(memberId, year)` is ready for Phase 15.
- **Voids and returns (T13.3):**
  - **A void** (before completion) needs a supervisor's username and password (`verifySupervisor`: an active, unlocked user with `store.supervise`, never the cashier; a wrong password counts toward their lockout). The voided sale keeps its number and lines, with no entry and no stock.
  - **A return** can't be more than was sold less earlier returns. It is restocked at the sale's unit cost, and the last units of a line take what is left of its COGS, so nothing drifts.
  - **The refund** is cash from the cashier's open drawer or, for a charge sale, a credit to the member's account (up to what they owe). One entry: Dr Sales Returns / Cr Cash or AR; Dr Inventory / Cr COGS.
- **Shifts (T13.4):**
  - The X/Z-reading: sales (cash and charge), voids, returns (cash and account), net sales, net cash sales, and the expected cash = opening fund + cash sales − cash refunds.
  - The cashier closes with the cash counted, and the Z-reading is kept. The manager (not the cashier, `cash.verify`) verifies, and a variance goes to Cash Short/Over.
- **Member charges (T13.5):**
  - The manager sets a member's own credit limit (the default is `store.member_credit_limit`, ₱1,000.00). The Member charges page shows what each member owes and can still charge; the statement of account comes from the AR–Members sub-ledger.
  - Teller receipt item STORE_AR_PAYMENT: Cr AR–Members, up to what is owed, one per member per receipt. Cancelling the receipt puts the charge back.
- **The POS screen (T13.6):**
  - The barcode/SKU field keeps the focus, with "next quantity" and ×2/×3/×6/×12 shortcuts, +/− per line, member lookup, and cash with exact/quick amounts and the change, or charge to the member.
  - Void with a supervisor's credential. Large buttons for a tablet.
  - Shift open/close/verify pages; the sale slip (printable) with the return form.
- **Reports (T13.7):** sales and gross margin by day, category and product (returns by return date; margin net of returned cost), top items and slow movers (in stock, fewest sold, last sold), on the new Sales & margin page.

**Decisions** (see Questions Q-13.1–Q-13.8)
- The POS shift is the store's own drawer, verified by the manager like a teller session.
- No discounts or VAT.
- Credit limits per member over a default.
- Supervisor voids by credential; returns by the cashier.
- Patronage is net of returns by return date.

**Deviations from spec (with reason)**
- **Shifts have a VERIFIED status** (spec: OPEN|CLOSED). The cash short/over is posted after the manager's verification (`cash.short_over_policy`), as for teller sessions, so a cashier never books their own shortage.
- **Extra columns:**
  - `pos_shifts`: expected cash, closed at, verified by/at, the variance entry.
  - `sales`: the cashier, the voiding supervisor and the void reason.
  - `sale_returns`: return no., the shift, total, cost, reason and cashier; their lines keep price, amount and cost.
  - `member_charge_limits`: who set it and when.
- **New permission and nav item:** `store.supervise` (supervisor voids and credit limits) and Sales & margin (`/store/sales`).
- **Auth service:** `verifySupervisor` checks a typed credential with the same lockout as sign-in.
- **Navigation tests:** the "coming soon" example moved to Phase 14 (`/accounting/statements`).

**Follow-ups**
- Answer Q-13.1–Q-13.8.
- Backlog: the POS cash turnover at day-end; the BIR invoice no. on the POS screen; discounts / member prices if adopted.
- Phase 15 reads `storePatronage` (with the loan interest paid) for the patronage refund.

**Exit checks / counts:**
- `npm run gate` is green: 617 tests (50 files), scan clean. Phase 13 adds:
  - 9 acceptance tests (A13.1–A13.9);
  - 14 integration tests (data rules, sales, voids, returns, shifts and the Z-reading, charge accounts and STORE_AR_PAYMENT, reports).
- `npm run build` is green (`/store/pos`, its shift and sale pages, `/store/charges` and its statements, `/store/sales`).
- `npm run e2e -- phase-13` is green: A13.10 (scan the barcode → quantity 5 → ₱500.00 tendered → change ₱150.00 shown). The screen was also checked at tablet size (1024 × 768).
- The full E2E against a production build is green: 22 of 22 (phases 00–13).
- The trial balance balances after sales, returns, store-charge payments and shift verification (integration tests).
- Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK.
- Databases set up earlier need `npm run db:migrate && npm run db:seed` (migrations 0035–0036, the SR series, `store.supervise`).

**Review follow-ups (reviewer agent, 2026-10-14)**
- **Fixed (must-fix): a charge sale could be refunded in cash while the member still owed it.**
  - The member then had the cash and the debt, and the store had the goods: a cash loan from the drawer without approval.
  - Now a return on a charge sale is credited to the member's account first, up to what they owe, and only the rest is paid in cash. Asking for cash while they owe is refused.
  - Returns keep the split (`ar_credit` + `cash_refund` = total; migration 0037, which backfills the existing rows), and the Z-reading counts the cash part as cash refunds.
- **Fixed (must-fix): a return to the account wasn't serialized with payments and charges.** It now locks the member, as charges and teller payments do, so a concurrent payment and return can't take the account below zero (test with both at once).
- **Fixed:**
  - **Supervisor checks:**
    - Unknown, wrong, locked and inactive accounts all get the same message after the same password work, so a counter can't probe usernames; an expired lock is cleared as at sign-in.
    - Failures and successes are audited with the cashier who asked and why (`auth.supervisor_failed`, `auth.supervisor_check`).
  - **Credit limits by member no.:** the manager can set any member's limit, e.g. ₱0.00 before their first charge.
  - **Limits and the tablet screen:**
    - POS amounts are capped (₱100,000,000.00) with plain messages instead of database errors.
    - The POS screen caps a line at 100,000 (a huge number no longer breaks the cart), and the +/− buttons are larger for a tablet.
  - **Store patronage never goes below zero.**
- **New tests:**
  - no cash refund on a charge sale while owed;
  - the split;
  - the concurrent return and payment;
  - the supervisor answers and their audit;
  - the void audit;
  - the "over" short/over entry;
  - limits by member no.
- **Logged:**
  - Q-13.6 now carries the reviewer's point that cash refunds without a supervisor work like voids without one.
  - Q-13.7 notes the zero floor.
  - Backlog: a manager force-close for abandoned shifts, and a blind cash count.
- **After the fixes:**
  - `npm run gate` green: 622 tests, 50 files, scan clean. Phase 13 now has 19 integration tests.
  - `npm run build` green.
  - E2E on a production build green: phase-13 (A13.10) and ui-shell.
  - Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK (migration 0037).

### Phase 14 summary
**Built**
- **Schema and seed (T14.1):**
  - Tables: statement lines and their accounts, segments and account segments, asset classes, fixed assets, depreciation runs and per-asset depreciation, bank accounts, statements, statement lines and reconciliations, close checklists, year-end closes.
  - Triggers keep the closing records, depreciation, reconciliations and statements immutable; a fixed asset changes only by its depreciation.
  - The seed adds a PFRF-for-Cooperatives layout (CONFIRM) and maps the chart onto it: by DOMAIN key, then by heading. It never moves an account already mapped.
  - The provisional chart gains property-and-equipment classes (cost and accumulated depreciation), salaries and utilities.
- **The statements (T14.2),** computed from the GL through the line each account is mapped to, with comparatives. Every postable account must be mapped; the unmapped ones are listed.
  - **Financial Condition:** includes the year's unclosed net surplus.
  - **Operations:** by segment (water, credit, consumer store, general).
  - **Changes in Equity:** the net surplus, year-end transfers and other changes.
  - **Cash Flows:** the indirect method, reconciled to the GL cash.
  - Year-end closing entries are left out of operations.
- **Fixed assets (T14.3):** the register and monthly straight-line depreciation (HALF-UP, from the acquisition month, the last month takes the residue). One run per month, in order, posted on the month's last day: Dr Depreciation / Cr Accumulated Depreciation per class.
- **Bank reconciliation (T14.4):** bank accounts on cash GL accounts. A month's reconciliation (statement balance, entries cleared, bank-only items) saves once, and only when it balances.
- **Close (T14.5):**
  - **Month-close checklist:**
    - teller sessions and POS shifts verified;
    - water billing posted;
    - no draft JVs;
    - daily jobs for every date since the first posting;
    - depreciation;
    - quarter-end savings interest;
    - bank reconciliations.
  - **Closing a month:** keeps its checklist and locks the month (posting into it is refused).
  - **Reopening:** the administrator, with a reason, audited; not in a closed year.
  - **Year-end close:** every other month closed, then one closing entry into Undivided Net Surplus. The last month and the year close and the next year opens; balances carry forward.
- **Screens and exports (T14.6):**
  - Financial statements (tabs, comparatives, segment columns, Excel and PDF exports through `/api/reports/fs`), statement mapping, Period close (live checklists), Fixed assets, Bank reconciliation (a balancing preview).
  - Navigation: the three Phase 14 items are live, plus Bank reconciliation.

**Decisions** (see Questions Q-14.1–Q-14.7)
- The layout, segments, depreciation convention, checklist, year-end and cash-flow classes are all defaults to confirm with the bookkeeper and the auditor.

**Deviations from spec (with reason)**
- **`fs_lines`:** the spec lists `parent` and `sign`. Here each line has a `section` (its amount is taken on the section's side, so contra accounts such as the allowance, accumulated depreciation, subscription receivable and sales returns reduce it), a `cash_flow` class, and `computed` for the year's net surplus. Hierarchy and subtotals are in the backlog.
- **The checklist requires POS shifts VERIFIED** (the spec says CLOSED), so their cash short/over is posted before the month locks; teller sessions are treated the same way.
- **Extra tables and columns:** `asset_classes` (classes and default lives, CONFIRM), `asset_depreciation` (per asset per month) and `year_end_closes`; fixed assets carry the depreciation brought forward, the month depreciation starts and a void reason; bank accounts carry the date they were set up.
- **The next fiscal year opens with the first entry dated in it** (the spec opens it at the year-end close), so January is posted while the old year is being closed. The year-end close still opens it if nothing was posted yet.
- **The trial balance now lists only accounts with a balance,** so revenues and expenses disappear after the year-end close (A14.6). A3.6 already treated a missing row as zero.
- **COA:** new provisional accounts and keys. `accumulated_depreciation_{class}` keys are required for the sample classes (DOMAIN §6 templated key); `property_equipment_{class}`, `salaries_wages` and `utilities_expense` are optional.
- **Navigation:** a new Bank reconciliation item. The "coming soon" example moved to Phase 15.
- **This branch was built on `phase-13-store-pos`** before Phase 13 merged; main (with Phase 13) was then merged into it.

**Follow-ups**
- Answer Q-14.1–Q-14.7; send the prior-year audited FS (format reference), the fixed-asset list and the bank accounts.
- Backlog: asset disposal; line hierarchy and segment allocation; bank statement import; the monthly allowance (provision) entry, which the Phase 11 follow-up expected here but the Phase 14 spec does not include.
- Phase 15 allocates the net surplus closed into Undivided Net Surplus by the year-end close.

**Exit checks / counts:**
- `npm run gate` is green: 650 tests (52 files), scan clean. Phase 14 adds:
  - 9 acceptance tests (A14.1–A14.9);
  - 19 integration tests (seed mapping, statements, depreciation, bank reconciliation, the checklist, closes, mapping from the screen, the workbook).
- `npm run build` is green (`/accounting/statements` and its mapping, `/accounting/close`, `/accounting/fixed-assets`, `/accounting/bank`, `/api/reports/fs`).
- `npm run e2e -- phase-14` is green: the bookkeeper sees a balanced Financial Condition, the net surplus on Operations, downloads the Excel workbook and opens Period close with its checklist.
- The full E2E against a production build is green: 23 of 23 (phases 00–14).
- Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK: every account mapped, and the dev trial balance balances.
- Databases set up earlier need `npm run db:migrate && npm run db:seed` (migrations 0038–0041, the statement-line seed step, the new accounts and keys).

**Review follow-ups (reviewer agent, 2026-10-14)**
- **Fixed (must-fix): the next fiscal year opened only at the year-end close, so from January 1 nothing could be posted.**
  - Receipts, the daily jobs and JVs were refused until the old year was fully closed, which takes weeks in practice.
  - Now the next fiscal year opens with the first entry dated in it, once it has started. It opens only the year right after the latest one; a year two ahead still says "not set up".
  - The year-end close now needs the year before closed, since its closing entry sweeps balances since the books began.
- **Fixed (must-fix): the asset register could be blocked for good.**
  - **Old assets:** an asset acquired before the books began could never be depreciated. Its first run waited on months the books don't have, so no month or year could close.
  - **Late registrations:** an asset registered after its months were run was never caught up.
  - **Typos:** a wrongly registered asset could never be changed or removed.
  - **Now:**
    - An asset can come in with its accumulated depreciation brought forward through a month, and is depreciated from the month after.
    - Registering into months already run, or into a closed month, or before the books start, is refused, and the message says what to bring forward.
    - Runs never go back, and only active assets due by the month need last month's run.
    - A wrongly registered asset can be voided, with a reason and audited, until its first depreciation is posted. Its tag is then free again.
  - Migration 0040: `opening_accumulated`, `depreciate_from` (backfilled from the acquisition month), `void_reason`, the VOID status, and a tag unique only among assets that aren't void. The trigger allows voiding only with no depreciation posted, and a voided asset never changes.
- **Fixed:**
  - **Period locks:**
    - Posting reads its month FOR SHARE, so a close waits for entries being posted and a posting waits for a close.
    - The year-end close locks every month of the year.
    - Reopening takes the year's lock first, in the same order as the year-end close.
  - **Missed daily jobs:** Period close has "Run the missed daily jobs" (gl.close, audited) for a month whose checklist is missing job dates. It runs only past dates, oldest first, and stops at the first failure. One missed cron day no longer blocks a month for good.
  - **Bank reconciliation:**
    - A bank account counts from the month it was set up (`opened_on`, migration 0041), so adding one doesn't hold up earlier months.
    - Months are reconciled in order, so a later statement can't hide an earlier month's open entries.
    - A double submit waits and then finds the month saved.
  - **Depreciation runs, registering and voiding take turns** (an advisory lock): a double submit says "already run" instead of a database error.
  - **Statement mapping:** an account goes only on a line of its own kind (an expense on an expense line, and so on). A receivable may still reduce an equity line (subscription receivable on share capital).
  - **Statements and the export:**
    - They start at the fiscal year's first day (`fiscal.year_start_month`), not January 1.
    - The export clamps a start later than the end, as the page does.
    - Period close opens on the current fiscal year.
  - **Period close screen:** "Closed on" shows the Manila date and time, not the UTC date. The water item now reads "Water billing of the month posted", which is what it checks.
- **New tests:**
  - the next year opening and the year-before guard;
  - assets brought forward, late registrations, runs not going back, voids and the trigger;
  - the missed-jobs action;
  - the year-end close blocked by the last month's checklist;
  - reopening then closing again;
  - bank accounts from their month and reconciling in order;
  - the line-kind check;
  - property and equipment and depreciation in the Financial Condition and Cash Flows;
  - Changes in Equity after the year-end close, and a net loss closing into UNS.
- **Not changed (logged):**
  - The water item checks the zones billed in the month, not every zone with connections (Q-14.4).
  - December can be closed from the month card before the year-end close; the year-end close then asks for it to be reopened (the acceptance tests close December by itself).
  - A14.7 depreciates the current month (an entry dated its last day).
  - Mapping changes restate closed years' statements (audited, not locked).
  - The trial balance leaves out zero rows.
  - Any bank-type cash account can be a bank account.
  - `segments` and `asset_classes` are keyed by code.
  - A daily job added in a later phase is due on every open month's dates since the first posting; run it with "Run the missed daily jobs".
  - The PDF export's totals aren't checked by a test (the workbook's are).
- **After the fixes:**
  - `npm run gate` green: 660 tests, 52 files, scan clean. Phase 14 now has 29 integration tests.
  - `npm run build` green.
  - E2E on a production build green: phase-14, now 2 tests (the new one adds an asset brought forward and voids a wrong one), and ui-shell. The full E2E: 24 of 24 (phases 00–14).
  - Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK (migrations 0040–0041).

### Phase 15 summary
**Built**
- **Schema (T15.1):**
  - `surplus_allocations`: one per fiscal year, with the percentages applied, the split, the ISC and PR rates, the GA resolution, who prepared, approved, posted and distributed it, and the entry.
  - `surplus_member_lines`: per member, the ASM, ISC, patronage (loan interest, store, water), PR, gross, the payout choice, and once paid the withholding, arrears offset, net, payouts, the entry and the DV.
  - `cetf_remittances`.
  - Triggers: a posted allocation only gets its distribution recorded; member amounts change only on a draft (a re-draft replaces its lines); a paid line never changes; allocations are never deleted.
- **Engine (T15.2):** the law's floors and ceilings, each with its own message; every split uses `allocate`.
- **Per member (T15.3):** ISC by ASM (`averageShareMonth`); PR by patronage: loan interest paid (new `loanInterestPaid`), net store purchases (`storePatronage`) and, when the basis says so, water bills paid (new `waterBillsPaid`). Active and inactive members share.
- **Workflow (T15.4):**
  - **Draft:** from the closed year's net surplus, with the settings or the GA's percentages. A re-draft recomputes and keeps members' choices.
  - **Approve:** by the manager, never the preparer.
  - **Post:** with the GA resolution: Dr Undivided Net Surplus / Cr the funds, CETF payable, ISC payable, PR payable.
  - **Payout choices:** savings / share capital / cash, per member.
  - **Distribute:** withholding, then arrears offset as a loan payment, then savings, ISC/PR capitalized (share ledger) and cash by DV.
- **CETF (T15.5):** the report (allocated, remitted, pending, left) and the remittance by DV.
- **Screens and export (T15.6):**
  - Net surplus allocation: the percentages in force, drafting, the allocations, the CETF to remit.
  - The allocation page: summary, next step, payout choices, distribution, CETF.
  - The Excel workbook (summary + per-member list for the GA).
  - Navigation live.

**Decisions** (see Questions Q-15.1–Q-15.5)
- Eligibility, the patronage basis, the payout default, withholding, arrears, dates and the CETF payee are defaults to confirm.

**Deviations from spec (with reason)**
- **Data model:** more columns than the spec lists:
  - the percentages, basis, withholding rate and offset flag the allocation used (so a posted year doesn't change when the settings do);
  - who and when for each step;
  - the water patronage, the payout choice in basis points, and the savings account, entry and DV of each line;
  - a `cetf_remittances` table (tracking per year).
- **New setting `surplus.default_payout`** (the spec says the default comes from settings; DOMAIN has no key), CONFIRM.
- **New permissions:** `surplus.prepare` (bookkeeper), `surplus.approve` (manager).
- **The law's limits are constants** (RA 9520 Art. 86; the PR floor is CDA guidance); the settings registry already bounds them the same way. The percentages themselves come from the settings or the GA.
- **Other modules gained small helpers:**
  - share: `cbuLines` takes a purpose; `capitalizeIscPr` records ISC_CAPITALIZED / PR_CAPITALIZED;
  - loans: `loanInterestPaid`, `pastDueLoans`;
  - water: `waterBillsPaid`.
- **The acceptance fixture** raises the minimum paid-up (outside the 10% holding cap) while its three members pay up, then restores it, so no filler shareholders are needed. It marks January–November closed directly (their checklists are Phase 14's).
- **Navigation:** the "coming soon" example moved to CDA reports (Phase 16).
- **E2E:** covers the Net surplus allocation page (the E2E database has no closed year). The allocation page is covered by the build and the integration tests of its actions.

**Follow-ups**
- Answer Q-15.1–Q-15.5; send the by-laws' allocation article and the CETF recipient.
- Backlog: a printable ISC/PR notice per member and taking payout choices in bulk.

**Exit checks / counts:**
- `npm run gate` is green: 683 tests (55 files), scan clean. Phase 15 adds:
  - 10 acceptance tests (A15.1–A15.10);
  - 9 integration tests (schema and triggers; each member's ASM and patronage, water; the workflow, distribution with withholding/arrears/savings/capital/cash and the DVs released, arrears larger than the refund; the CETF; the workbook);
  - 4 engine unit tests.
- A first gate run broke midway: Postgres was stopped by a console Ctrl+C event (its log: a backend "terminated by exception 0xC000013A"). After `npm run db:up` it ran green.
- `npm run build` is green (`/year-end/surplus`, `/year-end/surplus/[id]`, `/api/reports/surplus/[id]`).
- `npm run e2e -- phase-15` is green: the bookkeeper opens Net surplus allocation (the percentages in force, the CETF to remit).
- The full E2E against a production build passed 24 of 25: the dashboard test still expected the old "coming soon" example. Fixed, then ui-shell and phase-15 re-ran green.
- The Stop-hook gate was cut off at 14 minutes. With 1.2–1.7 GB free, vitest runs 1–2 workers and the full gate takes 16–19 minutes. Fixes:
  - the gate may now run 30 minutes;
  - DB tests restore the seeded reference data from a snapshot (`tests/helpers/phase01.ts`);
  - ESLint uses its cache.
  - Then: `npm run gate` green in 19 minutes on 1 worker (683 tests; vitest 1,037 s, versus 815 s on 2 workers before).
- Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK.
- Databases set up earlier need `npm run db:migrate && npm run db:seed` (migrations 0042–0043, the surplus permissions and the default-payout setting).

**Review follow-ups (reviewer agent, 2026-10-14)**
- **Fixed (must-fix): a fiscal year not starting in January mixed date windows.**
  - ASM and store purchases were taken by calendar year, while loan interest and water bills used the fiscal year.
  - Now all four use the fiscal year's own months:
    - `averageShareMonthFrom` (share);
    - `storePatronageBetween` (store).
- **Fixed:**
  - **Workflow:**
    - The manager can send an approved allocation back to draft, with a reason (audited), e.g. when the GA changes the percentages.
    - The approval names the revision the manager looked at, so a draft recomputed in the meantime isn't approved unseen (new `revision` column, migration 0044).
    - Recompute keeps the draft's own (GA) percentages; new ones are entered on the draft form.
    - Before posting, the members' ISC and PR are checked to add up to the pools.
  - **Triggers (migration 0044):**
    - an approved allocation keeps its figures (only posted or sent back);
    - member lines are added only to a draft.
  - **Locks:** an election locks the allocation before the line, and the distribution locks each member before their loans, savings and capital, the same order as elsewhere.
  - **Default payout:** odd percentages (33.333 / 33.333 / 33.334) become basis points that add up to exactly 100% (`allocate`).
  - **Wording:** the screens say "past-due loan amounts" (what is offset), not "unpaid balances".
  - **Seed snapshot:** taken from and restored into a database only when every `public` table is empty.
  - **Engine:** the remainder weight is never in exponent form.
- **New tests:**
  - sending back to draft and its permission;
  - approving a stale revision;
  - posting twice;
  - frozen approved figures and no lines added (raw SQL);
  - recompute keeping the GA percentages;
  - fiscal-year windows for ASM and store purchases;
  - the odd default payout.
- **Logged:**
  - Backlog: correcting a GA resolution no. after posting; re-issuing a cancelled ISC/PR cash DV; a member-by-member (resumable) distribution for a large membership.
  - The reviewer accepts the 30-minute gate timeout as reasonable (it changes how long a run may take, not what it checks). Because I changed my own guardrail files, it should be confirmed by Rhold.
- **After the fixes:**
  - `npm run gate` green: 684 tests, 55 files, scan clean (15 min, 2 workers).
  - `npm run build` green.
  - E2E on a production build green: phase-15 and ui-shell.
  - Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK (migration 0044).

### Phase 16 summary
**Built**
- **Officers, committees and trainings (T16.1):**
  - A `governance` module: officers with their board/committee, position, term and electing GA; trainings with their attendees.
  - Who serves on a date; training hours per member.
  - Staff with members.write (the manager, loan officers) edit; every change is audited. There is an Officers & trainings page.
  - `report_runs` records generated reports.
- **CDA reports (T16.2):**
  - Every figure the MIS gives the CAPR, by key:
    - the cooperative's details;
    - membership by type and sex as of the year end, with joined, terminated and deceased;
    - capital and statutory funds from the GL;
    - the financial highlights and revenue by business line from the statements;
    - CETF/CDF use;
    - officers and trainings.
  - The CAPR workbook: the CDA template filled cell by cell where it is mapped, otherwise the data sheets. It always has a cover (CDA reg. no., year, deadline) and an Unmapped fields sheet.
  - Downloads are recorded. There is a CDA reports page with the template status and a preview.
- **Management dashboard (T16.3):**
  - **Members and capital:** members by type, new this month, paid-up capital, deposits.
  - **Credit:** the loan portfolio from the GL control accounts, PAR, and loan collection efficiency of the month.
  - **Water:** billed and collected on bills due this month, efficiency, active connections, accounts for disconnection, NRW.
  - **Store and cash:** sales and margin MTD/YTD; cash on hand and in bank.
  - **Alerts:** loans due this week, maturing TDs, products to reorder.
  - A reconciliation of the GL with the member records.
- **Operational reports (T16.4):**
  - The reports: loan releases, collections, delinquency (borrowers and comakers with contacts), maturity schedule, savings interest, TD maturities, store sales by product, margin by category, slow movers, reorder list.
  - Reconciliation footers where a control account applies; Excel export.
  - Contacts are masked without `members.read_sensitive`.
  - `runReportAction` (reports.read) returns plain JSON.
- **Member statement of account (T16.5):** share capital, savings, time deposits, loans (balance, unpaid interest and penalties, past due) and the store account, each checked against the member's GL lines. It is printable (the app shell hides when printing) and has a PDF.
- **Performance (T16.6):**
  - A fixture of 1,000 members and 50,000 journal lines.
  - The trial balance, the four statements, the dashboard and the CAPR data answer in 30–210 ms.
  - The existing ledger indexes suffice: an as-of total over the whole ledger is a hash aggregate.

**Decisions** (see Questions Q-16.1–Q-16.5 and the Decisions log)
- Report totals come from the GL control accounts, with reconciliations.
- Contact masking uses the existing `members.read_sensitive` permission.
- The CAPR is a named-figure dictionary plus a template mapping.

**Deviations from spec (with reason)**
- **No CDA template was provided:** the workbook carries the MIS's data sheets and says so on Unmapped fields. The filler is tested with a sample template.
- **Extra table:** `training_attendees` (the spec's "attendees → officers/members").
- **`report_runs.file_url`** stays empty: reports are generated on demand.
- **Dashboard water figure:** "billed" is the billed amount of the bills due this month, so it equals the Phase 07 collection efficiency report (A16.8).
- **ATIR/ABR** is not built, pending PCMPC's tax status (Q-16.5). The Social Audit and Performance Audit attachments get only the CAPR figures (membership, funds, CETF/CDF, officers and trainings); the rest is in the backlog (Q-16.6).
- **The performance figures** cover the GL aggregates (trial balance, statements, CAPR) and the dashboard on a ledger-heavy fixture. The loan-by-loan parts (portfolio, delinquency) weren't load-tested: the fixture has no loans.
- **Navigation:** new items Operational reports and Officers & trainings. The "coming soon" example is now Data migration (Phase 17).
- **Printing:** the app shell (sidebar, header) is hidden when printing, for every printable page.

**Follow-ups**
- Answer Q-16.1–Q-16.5. Save the CDA CAPR and annex templates in `docs/cda-templates/`, and send the officers list and trainings.
- **Phase 18 (deployment):** include `docs/cda-templates/` and `src/assets/fonts/` in the serverless bundle (Next `outputFileTracingIncludes`).
- **Backlog:** ATIR/ABR and audit figures; charts on the dashboard.

**Exit checks / counts:**
- `npm run gate` is green: 703 tests (58 files), scan clean. Phase 16 adds:
  - 8 acceptance tests (A16.1–A16.8);
  - 9 integration tests (officers and trainings; the CAPR data, the workbook with and without a template, the run log; the dashboard and its reconciliation; the reports, masking, reconciliations and Excel; the member statement and PDF; the performance fixture).
- `npm run build` is green (`/reports/management`, `/reports/operational` and `/[key]`, `/reports/cda`, `/reports/statements` and `/[memberId]`, `/reports/governance`, and the CDA, report and statement routes).
- `npm run e2e -- phase-16` is green. The full E2E against a production build passed 27 of 27, after a fix: the super admin's role picker label ("View as role") also matched the user form's Role field in the E2E helpers, and it is now "View the system as".
- Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK (migration 0045; the default admin and the demo manager).
- Databases set up earlier need `npm run db:migrate && npm run db:seed` (migration 0045).

**Review follow-ups (reviewer agent, 2026-10-19)**
- **Fixed (must-fix): the dashboard counted an active time deposit twice in the deposits reconciliation** (its own passbook and its principal). Only savings passbooks are summed now, plus the active TDs' principal (test with a TD placed).
- **Fixed (must-fix): the delinquency footer of a past date compared that day's aging with today's loans.** The rows and the footer now come from the same aging (live for today, the day's snapshot for a past date). Without a snapshot there is no footer.
- **Fixed (must-fix): the CAPR's "CETF remitted" and "CDF used" had no year window and counted reversals.**
  - They are now the debits in entries dated in the fiscal year that stand: not reversed, and not reversals.
  - Logged as Q-16.6; tested with values and a reversed entry.
- **Fixed (must-fix): the Auditor saw members' contact numbers in reports, against the spec.** A new permission, reports.contacts, is given to the manager (and the super admin). The Board and the Auditor see them masked (test).
- **Fixed:**
  - **Fiscal year:** store sales "this year" start at the fiscal year's first day, and the CAPR's period follows the fiscal-year setting when the year isn't set up.
  - **Maturing time deposits:** a matured TD not yet processed stays on the alert.
  - **Rates:** shown as percentages on screen, in the action's JSON and in Excel.
  - **CAPR cover:** shows the CDA deadline date.
  - **Template sheets:** the MIS's sheets get "(MIS)" if a template already has a sheet with that name.
  - **Excel downloads:** `private, no-store`.
  - **Deployment:** the report routes trace the PDF fonts and the CDA templates (next.config).
  - **Loan accounts:** found by a key prefix match that doesn't treat `_` as a wildcard.
  - **Officers and trainings:** the same position can't be held twice in one term, and a training needs its date.
  - **Build:** the CDA template paths are marked for Turbopack not to trace (the templates are already included through next.config), so the build no longer warns that it traces the whole project.
- **Logged:**
  - Q-16.3 updated (reports.contacts) and Q-16.6 added.
  - Deviations: the Social and Performance Audit attachments, and the scope of the performance figures.
  - Backlog: the statement's arrears and closed accounts, the water figures on the two dashboards, a governance permission, a load test with many loans, and the template images.
- **After the fixes:**
  - `npm run gate` green: 707 tests, 58 files, scan clean (18 min, 2 workers).
  - `npm run build` green, no warnings.
  - E2E on a production build green: phase-16 and ui-shell, with SEED_ADMIN_* unset (the default admin).
  - Fresh `db:reset → db:migrate → db:seed → db:seed:dev` OK (migration 0045; the default admin and the demo manager are created).
