# PROGRESS.md — PCMPC MIS build log

> Claude updates this file (ticks, questions, summaries). Humans set ✅ after review.
> Legend: ⬜ not started · 🔨 in progress · 🟡 awaiting review · ✅ done (reviewed & merged) · ⛔ blocked

**Current phase:** 01

## Status
| # | Phase | Status | Branch / tag | Reviewed by / date |
|---|---|---|---|---|
| 00 | [Foundation & Loop Gate](docs/phases/PHASE-00-foundation.md) | ✅ | phase-00-foundation · tag `phase-00` | rldejoya (reviewer agent: no must-fix) · 2026-10-07 |
| 01 | [Auth, Roles, Audit Trail & Coop Settings](docs/phases/PHASE-01-auth-roles-audit.md) | 🔨 | phase-01-auth-roles-audit | |
| 02 | [Members Registry](docs/phases/PHASE-02-members.md) | ⬜ | | |
| 03 | [Accounting Core (GL engine)](docs/phases/PHASE-03-accounting-core.md) | ⬜ | | |
| 04 | [Cashiering Core (Teller) & Daily Cash Position](docs/phases/PHASE-04-cashiering.md) | ⬜ | | |
| 05 | [Water: Customers, Service Connections, Meters & Rates](docs/phases/PHASE-05-water-connections.md) | ⬜ | | |
| 06 | [Water: Meter Reading & Billing](docs/phases/PHASE-06-water-billing.md) | ⬜ | | |
| 07 | [Water: Collections, Penalties, Disconnection & Water Reports](docs/phases/PHASE-07-water-collections.md) | ⬜ | | |
| 08 | [Share Capital & CBU](docs/phases/PHASE-08-share-capital.md) | ⬜ | | |
| 09 | [Savings & Time Deposits](docs/phases/PHASE-09-savings.md) | ⬜ | | |
| 10 | [Loan Products, Amortization Engine & Applications](docs/phases/PHASE-10-loan-applications.md) | ⬜ | | |
| 11 | [Loan Release, Collections, Penalties & Aging](docs/phases/PHASE-11-loan-servicing.md) | ⬜ | | |
| 12 | [Store: Inventory & Purchasing](docs/phases/PHASE-12-store-inventory.md) | ⬜ | | |
| 13 | [Store: POS, Charge-to-Member & Store Patronage](docs/phases/PHASE-13-store-pos.md) | ⬜ | | |
| 14 | [Financial Statements, Period Close & Fixed Assets](docs/phases/PHASE-14-fs-close.md) | ⬜ | | |
| 15 | [Net Surplus Allocation, Interest on Share Capital & Patronage Refund](docs/phases/PHASE-15-surplus-allocation.md) | ⬜ | | |
| 16 | [Reports: CDA, Management Dashboard & Member Statements](docs/phases/PHASE-16-reports.md) | ⬜ | | |
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
- [ ] T1.1 Choose Better Auth vs Auth.js, record the decision, install & configure
- [ ] T1.2 Schema + migrations: users, roles, permissions, audit_log (+ trigger), settings, number_series
- [ ] T1.3 Seed: roles, permission matrix, settings defaults, number series, first admin
- [ ] T1.4 `src/lib/auth-guard.ts` (requirePermission, assertNotSameUser)
- [ ] T1.5 `src/lib/audit.ts` audit() + audit log viewer
- [ ] T1.6 Login/logout pages, lockout logic, and protected `(staff)` layout redirect
- [ ] T1.7 Users admin UI and actions
- [ ] T1.8 Settings service (`getSetting<T>(key)` with zod-typed keys) and the settings UI
- [ ] T1.9 `src/lib/numbering.ts` `next(code, tx, date)`
- [x] Acceptance tests written first (tests/acceptance/phase-01.test.ts)
- [ ] Exit checks passed

### Phase 02 — Members Registry
- [ ] T2.1 Schema + migrations + name normalization helper
- [ ] T2.2 Member service (create, approve, status, duplicates, canTerminate registry)
- [ ] T2.3 Beneficiaries service and validation
- [ ] T2.4 Server actions with permissions + audit; server-side masking
- [ ] T2.5 UI: list/search, application form (zod shared), approval queue, profile tabs
- [ ] T2.6 Seed fixture: 6 sample members (dev only)
- [ ] Acceptance tests written first (tests/acceptance/phase-02.test.ts)
- [ ] Exit checks passed

### Phase 03 — Accounting Core (GL engine)
- [ ] T3.1 Schema, migrations, immutability trigger, CHECK constraints
- [ ] T3.2 COA import (CSV) + provisional seed + account mappings seed + fiscal year 2026 periods
- [ ] T3.3 Ledger service (postJournal, reverseJournal, balances)
- [ ] T3.4 Manual JV workflow + UI (draft, approve, post, reverse)
- [ ] T3.5 Reports: TB, GL, journal books, subsidiary ledger + Excel export
- [ ] T3.6 COA management UI (add/edit/deactivate; can't deactivate an account with a balance)
- [ ] Acceptance tests written first (tests/acceptance/phase-03.test.ts)
- [ ] Exit checks passed

### Phase 04 — Cashiering Core (Teller) & Daily Cash Position
- [ ] T4.1 Schema + migrations
- [ ] T4.2 Registry (receipt items, cash-outs, payor types) + built-ins
- [ ] T4.3 Session service (open, close with count, verify with variance posting)
- [ ] T4.4 Receipt service (registered items in one transaction) + cancellation
- [ ] T4.5 DV workflow + bank deposit
- [ ] T4.6 Teller UI (payor search → dues cart → slip print, cash count, verification)
- [ ] T4.7 Daily cash position report + Excel export
- [ ] Acceptance tests written first (tests/acceptance/phase-04.test.ts)
- [ ] Exit checks passed

### Phase 05 — Water: Customers, Service Connections, Meters & Rates
- [ ] T5.1 Schema + migrations (incl. `journal_lines.customer_id`) + seeds (zones, tariff, fees)
- [ ] T5.2 Customer service (member/non-member) + payor type `WATER_CUSTOMER`
- [ ] T5.3 Application → approval → installation → activation workflow + transfers
- [ ] T5.4 Meter inventory, installation and replacement service
- [ ] T5.5 Versioned rate schedules + pure rate engine + fee schedule
- [ ] T5.6 Teller items `WATER_CONNECTION_FEE`, `METER_DEPOSIT`, `WATER_OTHER_FEE`
- [ ] T5.7 Senior-citizen eligibility records
- [ ] T5.8 UI: customers, applications, account profile, routes/sequence, tariff admin, meters
- [ ] Acceptance tests written first (tests/acceptance/phase-05.test.ts)
- [ ] Exit checks passed

### Phase 06 — Water: Meter Reading & Billing
- [ ] T6.1 `job_runs` + `runOnce`; schema for periods, readings, bills, lines, memos
- [ ] T6.2 Consumption engine (normal, rollover, meter change, estimate, flags)
- [ ] T6.3 Periods + office reading-entry grid + flag review queue
- [ ] T6.4 Mobile reading PWA with offline queue + idempotent sync
- [ ] T6.5 Billing engine + billing run (preview → post) + GL + advances
- [ ] T6.6 PDF printing: reading sheets and bills per route
- [ ] T6.7 Credit/debit memos with SoD
- [ ] T6.8 Final reading + final bill on account closure (deposit refund handled in Phase 07)
- [ ] Acceptance tests written first (tests/acceptance/phase-06.test.ts)
- [ ] Exit checks passed

### Phase 07 — Water: Collections, Penalties, Disconnection & Water Reports
- [ ] T7.1 Schema + migrations
- [ ] T7.2 `WATER_BILL` teller item (dues, allocation, advances, reverse)
- [ ] T7.3 Daily cron runner + penalty job
- [ ] T7.4 Disconnection list, notices, disconnect/reconnect orders, reconnection fee rule
- [ ] T7.5 Account closure settlement + deposit refund
- [ ] T7.6 Customer ledger/SOA
- [ ] T7.7 Water reports + dashboard tiles (+ optional NRW)
- [ ] Acceptance tests written first (tests/acceptance/phase-07.test.ts)
- [ ] Exit checks passed

### Phase 08 — Share Capital & CBU
- [ ] T8.1 Schema, migrations, view, mappings check
- [ ] T8.2 Share service (subscribe, pay, fee, transfer, withdraw, retainCbu, isGoodStanding, ASM)
- [ ] T8.3 GL integration via `postJournal` in the same transaction
- [ ] T8.4 Actions, UI tab/forms, teller registrations (fee, share payment, withdrawal)
- [ ] T8.5 Member share ledger report (per member, date range) + Excel export
- [ ] Acceptance tests written first (tests/acceptance/phase-08.test.ts)
- [ ] Exit checks passed

### Phase 09 — Savings & Time Deposits
- [ ] T9.1 Schema + migrations
- [ ] T9.2 Deposit service (open, deposit, withdraw, close, reactivate, ledger)
- [ ] T9.3 ADB + interest engine (pure functions + tests), interest run with preview and post
- [ ] T9.4 Time deposits (place, mature, pre-terminate, rollover)
- [ ] T9.5 Dormancy job + teller registrations (`SAVINGS_DEPOSIT`, `SAVINGS_WITHDRAWAL`)
- [ ] T9.6 UI + actions + permissions + audit
- [ ] Acceptance tests written first (tests/acceptance/phase-09.test.ts)
- [ ] Exit checks passed

### Phase 10 — Loan Products, Amortization Engine & Applications
- [ ] T10.1 Schema, migrations, product + deduction seed (DOMAIN sample products, flagged CONFIRM)
- [ ] T10.2 Amortization engine + golden and property tests
- [ ] T10.3 Net proceeds calculator
- [ ] T10.4 Eligibility engine with the hook registry
- [ ] T10.5 Application service + approval matrix + SoD
- [ ] T10.6 UI: product admin, loan calculator, application form, approval queue, disclosure print
- [ ] Acceptance tests written first (tests/acceptance/phase-10.test.ts)
- [ ] Exit checks passed

### Phase 11 — Loan Release, Collections, Penalties & Aging
- [ ] T11.1 Schema + migrations
- [ ] T11.2 Release service (GL, CBU, schedule persistence, loan_no)
- [ ] T11.3 Collection service (allocation, excess handling, GL, reversal of a payment)
- [ ] T11.4 Penalty engine + daily job + job_runs idempotency
- [ ] T11.5 Aging/PAR service + snapshot + delinquency list (with comakers and contact numbers)
- [ ] T11.6 Write-off, restructure, termination offset, eligibility hooks, `canTerminate`
- [ ] T11.7 UI: release screen, loan ledger card, delinquency/aging reports, PAR tile
- [ ] T11.8 Teller registrations (`LOAN_PAYMENT`, `LOAN_PROCEEDS`) + cross-module receipt test
- [ ] Acceptance tests written first (tests/acceptance/phase-11.test.ts)
- [ ] Exit checks passed

### Phase 12 — Store: Inventory & Purchasing
- [ ] T12.1 Schema + migrations
- [ ] T12.2 Stock engine (moving average, issue costing) + property tests
- [ ] T12.3 Products, categories, suppliers, price history services + UI
- [ ] T12.4 PO → RR flow with GL; AP subledger; supplier payment via DV
- [ ] T12.5 Stock count + approval + adjustment posting
- [ ] T12.6 Reports: stock card per product, valuation, reorder list, AP aging per supplier
- [ ] Acceptance tests written first (tests/acceptance/phase-12.test.ts)
- [ ] Exit checks passed

### Phase 13 — Store: POS, Charge-to-Member & Store Patronage
- [ ] T13.1 Schema + migrations
- [ ] T13.2 Sale service (cash/charge) with stock + GL in one transaction
- [ ] T13.3 Returns and voids
- [ ] T13.4 Shifts + Z-reading + cash count
- [ ] T13.5 Member charge accounts, statement of account, `STORE_AR_PAYMENT` receipt item in cashiering
- [ ] T13.6 POS UI (keyboard/barcode-first) and the slip print
- [ ] T13.7 Store reports (sales, margin, top items, slow movers)
- [ ] Acceptance tests written first (tests/acceptance/phase-13.test.ts)
- [ ] Exit checks passed

### Phase 14 — Financial Statements, Period Close & Fixed Assets
- [ ] T14.1 Schema + migrations + FS line seed (PFRF-for-Coops layout; mark it CONFIRM)
- [ ] T14.2 FS engine (all 4 statements + comparatives) + mapping completeness check
- [ ] T14.3 Fixed assets + depreciation run
- [ ] T14.4 Bank reconciliation
- [ ] T14.5 Month close checklist + lock/reopen; year-end close + new FY opening
- [ ] T14.6 UI + Excel (exceljs) and PDF exports
- [ ] Acceptance tests written first (tests/acceptance/phase-14.test.ts)
- [ ] Exit checks passed

### Phase 15 — Net Surplus Allocation, Interest on Share Capital & Patronage Refund
- [ ] T15.1 Schema + migrations
- [ ] T15.2 Allocation engine (pure) + validation
- [ ] T15.3 Per-member ISC/PR computation using `averageShareMonth`, loan interest paid, `storePatronage`
- [ ] T15.4 Workflow: draft → approve → post (GL) → distribute (savings/share/cash/offset)
- [ ] T15.5 CETF payable report + remittance via DV
- [ ] T15.6 UI + reports (allocation summary, per-member list for GA, Excel export)
- [ ] Acceptance tests written first (tests/acceptance/phase-15.test.ts)
- [ ] Exit checks passed

### Phase 16 — Reports: CDA, Management Dashboard & Member Statements
- [ ] T16.1 Officers/committees/trainings module
- [ ] T16.2 CDA template filler (exceljs) with field-mapping config per template + "Unmapped fields" sheet
- [ ] T16.3 Dashboard (server-rendered KPIs; charts kept simple)
- [ ] T16.4 Operational reports + Excel export
- [ ] T16.5 Member SOA (print CSS + PDF)
- [ ] T16.6 Performance fixture (50,000 journal lines, 1,000 members) + query tuning/indexes
- [ ] Acceptance tests written first (tests/acceptance/phase-16.test.ts)
- [ ] Exit checks passed

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

## Decisions log
<!-- Format: - 2026-10-07 · phase XX · decision · reason -->
- 2026-10-07 · plan · Stack: Next.js + TypeScript + Postgres (Neon via Vercel Marketplace) + Drizzle · must run on Vercel; local Postgres first, cloud later
- 2026-10-07 · plan · Money stored as bigint centavos; HALF-UP rounding at defined points only · accounting accuracy
- 2026-10-07 · plan v1.1 · Water service billing (member + non-member connections) is the core module, built right after the platform (Phases 05–07) · main purpose of the MIS
- 2026-10-07 · plan v1.1 · Cashiering is a pluggable registry (Phase 04); every module registers its own receipt items · one counter, one receipt
- 2026-10-07 · phase 00 · Local DB is PostgreSQL 18.6 portable binaries (no Docker, no admin), managed by `scripts/db.mjs`; T0.4 adapted (no docker-compose) · Docker and native Postgres not installed; user chose portable over SQL Server so dev matches Neon (Postgres)
- 2026-10-07 · phase 00 · Pinned stable versions: Node 24 LTS, Next.js 16.4.0 (Cache Components + Partial Prefetching on), React 19.3, TypeScript 5, Tailwind 4, shadcn 4 (base-nova), drizzle-orm 0.45.3 + drizzle-kit 0.31.11, pg 8.23, Vitest 5.0.3, Playwright 1.63, zod 4.6, decimal.js 10.6, date-fns 4.4 + @date-fns/tz 1.5, PostgreSQL 18.6 · PLAN §4 asks to record them
- 2026-10-07 · phase 01 · Auth library: **Better Auth 1.7.7** (username plugin, Drizzle adapter, DB sessions in Postgres, uuid ids), not Auth.js · Auth.js v5 never shipped a stable release (`next-auth` latest is 4.x) and its credentials provider only supports JWT sessions, while the spec requires sessions stored in Postgres. Better Auth's username sign-in needs no email (spec: email optional), and its before/after hooks let lockout and inactive checks run on every sign-in path. Users, roles and permissions stay in our own tables (Better Auth's admin/RBAC plugin is not used)
- (pending) · early water pilot after Phase 07? (see PLAN §6)

## Backlog (out-of-scope ideas found while building)
- Online bill payments (GCash / Maya)
- SMS / e-mail bill and due-date reminders
- Customer/member self-service portal (view bills, balances, SOA)
- Payroll-deduction integration
- 2FA for staff logins
- Photo / signature capture (Vercel Blob); meter photo on reading
- Smart/IoT meters

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
