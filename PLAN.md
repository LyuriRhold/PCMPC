# PCMPC MIS — Master Plan

**Project:** Management Information System for **Pipindan Community Multi-Purpose Cooperative (PCMPC)**, Pipindan, Binangonan, Rizal
**Main purpose:** **water service billing** for member and non-member connections, plus the coop's membership, savings & credit, store and accounting.
**Owner / Lead dev:** Rhold Lyuri De Joya
**Built with:** Claude Code, one phase per closed loop (see `LOOP.md`)
**Plan version:** 1.1 — 2026-10-07 (adds Water Billing as the core module; phases renumbered 00–18)

> How the files fit together
> - `PLAN.md` (this file): the why, what, architecture and roadmap.
> - `CLAUDE.md`: standing instructions Claude Code follows every session.
> - `LOOP.md`: how to run each phase as a self-verifying loop (Stop-hook gate, `/goal`, ceilings).
> - `PROGRESS.md`: live state, including checkboxes, questions, decisions and phase summaries.
> - `docs/DOMAIN.md`: glossary, business rules, GL postings and configurable defaults.
> - `docs/phases/PHASE-XX-*.md`: the detailed spec and golden acceptance tests for each phase.

---

## 1. Goal

One web-based MIS for PCMPC where **every peso movement posts to the general ledger automatically**, so that customer and member ledgers, the books and CDA reports always agree.

Success looks like:
1. **Water:** every connection (member or non-member) is read monthly, on paper or on a phone even without signal. Bills are computed from the approved tariff and printed per route. Payments, penalties and disconnection/reconnection are tracked with no manual ledgers.
2. Tellers serve anyone at one counter with one receipt: water bill, share capital, savings, loan payment, store charges.
3. Loan officers process an application from eligibility to release to collection, with automatic schedules, penalties and aging.
4. The store runs its POS and inventory with moving-average costing, and member purchases count toward patronage refund.
5. The bookkeeper closes the month and produces PFRF-for-Cooperatives financial statements, by business line (water, credit, store), without re-encoding.
6. At year-end the system computes statutory funds, interest on share capital (ISC) and patronage refund (PR) per member, and extracts CDA annual-report data.

## 2. Scope

### In scope (v1)
| Module | Summary |
|---|---|
| **W Water Service (core)** | Customers (member/non-member), applications, connections, meters, zones/routes, NWRB tariff, reading (office + offline phone app), billing, bills, payments, penalties, disconnection/reconnection, deposits, water reports |
| M1 Members & Share Capital | Registry, PMES/BOD approval, subscriptions, paid-up, CBU, transfers, withdrawals |
| M2 Savings & Time Deposits | Products, accounts, deposits/withdrawals, interest runs, TD placements, dormancy |
| M3 Loans | Products, applications, eligibility, approvals, release with deductions, schedules, collections, penalties, aging/PAR, restructure, write-off |
| M4 Cashiering | Teller sessions, one receipt for many items (pluggable), disbursement vouchers, cash count, daily cash position |
| M5 Store / Consumer | Inventory, purchasing, receiving, POS, charge-to-member, returns, Z-reading |
| M6 Accounting | Chart of accounts, journals/books, GL, trial balance, FS by business line, period close, depreciation |
| M7 Year-end & CDA | Net surplus allocation, ISC, PR, CDA report extracts, management dashboards |
| Platform | Auth, roles/permissions, audit trail, settings, document numbering, data migration, backups |

### Out of scope for v1 (stays in the Backlog in `PROGRESS.md`)
Online payments (GCash/Maya), SMS/e-mail bill reminders, member/customer self-service portal, payroll-deduction integration, native mobile app (the reading app is a web PWA), multi-branch, budgeting, SCADA/IoT meters.

## 3. Users & roles

| Role | Typical person | Can do |
|---|---|---|
| ADMIN | IT / system admin | Users, roles, settings, period reopen |
| MANAGER | General Manager | Approvals within limits, all reports, verify teller sessions, approve water applications/memos |
| BOOKKEEPER | Bookkeeper / Accountant | Journals, adjustments, FS, period close, year-end allocation |
| **BILLING_CLERK** | Water billing staff | Water customers/applications, billing periods, review readings, billing runs, prepare memos, disconnection lists |
| **METER_READER** | Field meter reader | Enter readings for **assigned routes only** (phone/tablet) |
| TELLER | Cashier / Teller | Receipts (water bills, fees, share, savings, loans), withdrawals, cash count |
| LOAN_OFFICER | Credit staff | Loan applications, schedules, collection follow-up |
| CREDIT_COMMITTEE | Credit Committee member | Approve loans above the manager's limit |
| STORE_CLERK | Store staff | POS, receiving, stock counts |
| AUDITOR | Audit Committee / external auditor | Read-only everything, including the audit log |
| BOARD | Board of Directors | Read-only reports and dashboards |

Segregation of duties (SoD): the person who prepares a journal voucher, disbursement voucher, water application/credit memo, loan application or stock adjustment **cannot approve it**.

## 4. Tech stack (Vercel-ready, start local)

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js** (App Router, Server Components, Server Actions), **TypeScript strict** | First-class on Vercel, one codebase for UI and API |
| DB | **PostgreSQL**: local Docker in dev, **Neon via Vercel Marketplace** in prod | Vercel Postgres was retired; Neon is its successor. Real transactions and constraints for accounting |
| DB driver | `pg` (node-postgres) with Neon's **pooled** connection string in prod | Interactive transactions are required (ledger posting). Neon's HTTP driver can't do them |
| ORM / migrations | **Drizzle ORM + drizzle-kit** | SQL-like, typed, light on serverless; versioned migrations |
| Auth | **Better Auth** (username + password; admin/roles plugin) or Auth.js, decided in Phase 01 | Self-hosted sessions in our own Postgres, no per-user fees |
| UI | Tailwind CSS + shadcn/ui, TanStack Table, react-hook-form + zod | Fast to build data-heavy staff screens |
| Meter-reading app | **PWA** (service worker + IndexedDB queue) inside the same Next.js app | Readers work offline in areas with weak signal and sync later. No app store needed |
| Money | **bigint centavos** with `src/lib/money.ts`; rates via decimal.js | No floating-point errors in accounting |
| Dates | `src/lib/dates.ts` wrapping date-fns with TZ `Asia/Manila` | Vercel runs in UTC, while business dates are Manila dates |
| Reports / bills | exceljs (CDA asks for editable Excel), PDF via @react-pdf/renderer or print CSS | Batch bill printing per route |
| Tests | **Vitest** (unit + DB integration), **Playwright** (E2E) | These are the loop's gate |
| Jobs | Vercel Cron, calling `/api/cron/daily` with `CRON_SECRET` | Water penalties, loan penalties, aging, dormancy |
| Hosting | Vercel (functions region **sin1 Singapore**) + Neon (**AWS ap-southeast-1 Singapore**) | Lowest latency from Rizal |

Pin the latest **stable** versions in Phase 00 and record them in `PROGRESS.md › Decisions`.

## 5. Architecture

```
 Staff browser (office PC)        Meter reader phone (PWA, works offline)
          │ HTTPS                          │ sync when online
          ▼                                ▼
 Next.js app (local: npm run dev │ prod: Vercel sin1)
   src/app/(staff)/...            pages & layouts per module
   src/app/(reader)/...           mobile reading PWA (assigned routes only)
   src/modules/<module>/
        schema.ts                 Drizzle tables for the module
        service.ts                business logic, the ONLY place rules live
        actions.ts                server actions: auth → zod → service → audit
        ui/                       module components
   src/modules/ledger/            postJournal(), reverseJournal(): the single door to the GL
   src/modules/cashiering/        receipt-item / cash-out / payor REGISTRY: every module plugs in here
   src/lib/                       money, dates, auth guard, numbering, audit, runOnce
   src/app/api/cron/daily         daily jobs (protected by CRON_SECRET)
          │ pg (pooled)
          ▼
 PostgreSQL (local Docker │ Neon prod/staging branches)
```

### Non-negotiable architecture rules
1. **Ledger-first.** Modules never write GL tables directly. They call `ledger.postJournal()` **inside the same DB transaction** as their business record. If either fails, both roll back.
2. **Money is bigint centavos.** No JS `number` for amounts. Round HALF-UP to the centavo only at the points defined in `docs/DOMAIN.md §3`.
3. **Posted means immutable.** Posted financial records (journal entries, bills, receipts) are never updated or deleted. A reversal or an approved memo corrects them. DB triggers enforce this.
4. **Manila business date.** All business dates come from `dates.businessToday()` (Asia/Manila), never from `new Date()` directly.
5. **Every mutation is authorized and audited:** `requirePermission()` → zod → service → `audit()`.
6. **Gapless document numbers** (receipts, bills, JV, DV, loan no., member/customer no.) come from `numbering.next(series, tx)` with a row lock.
7. **Config over code.** Tariffs, rates, percentages, limits and account mappings live in versioned settings tables seeded from `docs/DOMAIN.md`. They are never hard-coded.
8. **Idempotent jobs and runs.** Every cron job, billing run or interest run is keyed via `runOnce(job, key)` and refuses to run twice.
9. **One counter.** Every cash-in/cash-out goes through the cashiering registry, so the teller's session, the receipt and the GL always agree.

### Folder layout (target)
```
PCMPC/
  CLAUDE.md  PLAN.md  LOOP.md  PROGRESS.md
  docs/DOMAIN.md  docs/phases/*.md  docs/cda-templates/  docs/coa/  docs/tariff/
  .claude/settings.json  .claude/agents/reviewer.md
  scripts/gate.mjs  scripts/scan-placeholders.mjs
  docker-compose.yml  drizzle.config.ts  vercel.json  .env.example
  src/app/  src/modules/  src/lib/  src/db/
  tests/unit/  tests/integration/  tests/acceptance/  tests/e2e/  tests/fixtures/
```

## 6. Phase roadmap

Each phase is **one closed loop**: tests first from the spec's golden values, build until `npm run gate` is green, then a human reviews and merges. Water comes first because it is PCMPC's main service.

| # | Phase | Delivers | Depends on |
|---|---|---|---|
| 00 | [Foundation & Loop Gate](docs/phases/PHASE-00-foundation.md) | Next.js skeleton, local Postgres, money/date libs, test harness, Stop-hook gate | – |
| 01 | [Auth, Roles, Audit, Settings](docs/phases/PHASE-01-auth-roles-audit.md) | Login, RBAC, SoD helper, audit log, coop profile, numbering | 00 |
| 02 | [Members Registry](docs/phases/PHASE-02-members.md) | Applicants → PMES → BOD approval → active members, beneficiaries | 01 |
| 03 | [Accounting Core (GL engine)](docs/phases/PHASE-03-accounting-core.md) | COA, periods, `postJournal`, JV approval, GL, TB, subsidiary ledgers | 01 |
| 04 | [Cashiering Core](docs/phases/PHASE-04-cashiering.md) | Teller sessions, pluggable multi-item receipts, DVs, cash count, cash position | 02, 03 |
| **05** | [**Water: Customers, Connections, Meters & Rates**](docs/phases/PHASE-05-water-connections.md) | Member/non-member customers, applications, accounts, meters, zones/routes, NWRB tariff engine, fees | 02, 03, 04 |
| **06** | [**Water: Meter Reading & Billing**](docs/phases/PHASE-06-water-billing.md) | Billing periods, reading sheets, offline reading PWA, validation, consumption, billing runs, bills, memos | 05 |
| **07** | [**Water: Collections, Penalties & Disconnection**](docs/phases/PHASE-07-water-collections.md) | Bill payments at the teller, penalties, disconnection/reconnection, SOA, deposits, water reports, daily cron | 06 |
| 08 | [Share Capital & CBU](docs/phases/PHASE-08-share-capital.md) | Subscriptions, payments, transfers, ASM, member share ledger | 02, 03, 04 |
| 09 | [Savings & Time Deposits](docs/phases/PHASE-09-savings.md) | Deposit products/accounts, interest runs, TDs, dormancy | 02, 03, 04 |
| 10 | [Loan Products & Applications](docs/phases/PHASE-10-loan-applications.md) | Products, amortization engine, eligibility, approval matrix, disclosure | 08 |
| 11 | [Loan Release, Collections & Aging](docs/phases/PHASE-11-loan-servicing.md) | Release with deductions, payments, penalties, aging, PAR, write-off | 10 |
| 12 | [Store: Inventory & Purchasing](docs/phases/PHASE-12-store-inventory.md) | Products, POs, receiving, moving average, counts, AP | 03, 04 |
| 13 | [Store: POS & Charge-to-Member](docs/phases/PHASE-13-store-pos.md) | POS, charge accounts, returns, Z-reading, store patronage | 12 |
| 14 | [Financial Statements & Close](docs/phases/PHASE-14-fs-close.md) | PFRF-for-Coops FS by business line, month/year close, depreciation, bank recon | 03–13 |
| 15 | [Net Surplus, ISC & Patronage Refund](docs/phases/PHASE-15-surplus-allocation.md) | Statutory funds, ISC, PR, distribution | 14 |
| 16 | [Reports: CDA, Management, Member](docs/phases/PHASE-16-reports.md) | CDA extracts, dashboards (incl. water), SOA, governance records | 15 |
| 17 | [Data Migration & Opening Balances](docs/phases/PHASE-17-migration.md) | Excel templates, validation, reconciliation, opening JE (incl. water accounts, last readings, arrears) | 16 |
| 18 | [Hardening, Deploy, UAT & Go-Live](docs/phases/PHASE-18-golive.md) | Security, Vercel + Neon prod, backups, UAT, water compliance, cut-over | 17 |

Milestones:
- **M-A (after 04):** the platform, GL engine and teller counter work, so every later module plugs into them.
- **M-B (after 07): the water billing system is complete** for member and non-member connections.
- **M-C (after 11):** the financial-services core is ready (share capital, savings, loans).
- **M-D (after 13):** the store is live.
- **M-E (after 16):** a full year-end cycle and CDA reports are possible.
- **M-F (after 18):** full production go-live on Vercel.

### Optional early water pilot (recommended if water billing is urgent)
Right after Phase 07, before Phase 08:
1. Run Phase 17's templates/import for **water entities only**: customers, accounts, meters with last readings, unpaid bills, deposits.
2. Run Phase 18 tasks T18.1–T18.8 (security, deploy, backups).
3. Go live with water billing.

Later phases then ship as updates to the live system. Record this choice in `PROGRESS.md › Decisions`.

## 7. Definition of Done (every phase)

1. All of the phase's tasks are ticked in `PROGRESS.md`.
2. The phase's acceptance tests in `tests/acceptance/phase-XX.test.ts` exist, use the **exact golden values** from the spec, and pass.
3. `npm run gate` is green (typecheck + lint + all tests + placeholder scan).
4. `npm run build` succeeds, and the phase's E2E tests pass.
5. Migrations are committed, and the seed runs on a fresh DB.
6. A Phase summary is written in `PROGRESS.md` (built / decisions / deviations / follow-ups).
7. **Human review:** Rhold checks the diff and the reviewer-agent report, then merges and tags `phase-XX`.

## 8. Compliance & risk register

| # | Risk / requirement | Handling |
|---|---|---|
| R1 | **BIR receipts/invoices.** System-printed official receipts/invoices need BIR registration (CAS / POS Permit-to-Use) | Until approved, the system prints *acknowledgement slips* and records the **BIR-registered manual receipt/invoice number** on every receipt. BIR track in Phase 18 |
| R2 | **CDA mandatory reports.** CAPR with AFS, Social Audit, Performance Audit, list of officers & trainings, sworn statements, plus ATIR/ABR if tax-exempt. Due **within 120 days after Dec 31 (Apr 30)**, ₱100/day fine if late (micro coops excepted) | Phase 16 builds the data extracts against the **current** CDA templates (`docs/cda-templates/`) |
| R3 | **Chart of accounts & FS format.** CDA Revised Standard Chart of Accounts (MC 2016-06) and PFRF for Cooperatives (MC 2015-06) | Bookkeeper/auditor confirms the **current** COA, including water accounts, before Phase 03. The COA is data, not code |
| R4 | **RA 9520 net surplus rules** (reserve ≥10%, ETF ≤10%, CDF ≥3%, optional ≤7%, ISC/PR) | Configurable percentages with validation (Phase 15). Defaults come from the by-laws |
| R5 | **Data Privacy Act (RA 10173)** for members **and non-member water customers** | Consent capture, masking, audit log, privacy notice, export on request (Phases 02, 05, 18) |
| R6 | **Internet dependency.** Vercel needs internet at the office | Readers use the offline PWA. The office can fall back to local mode on an office PC with **one** source of truth at a time (Phase 18) |
| R7 | **Vercel plan.** Hobby is non-commercial/personal only, and functions are capped at 300s | Budget for **Vercel Pro** at go-live. Keep requests short and batch billing runs per zone |
| R8 | **Serverless timezone (UTC)** | Rule 4 above, with tests around midnight Manila time |
| R9 | **False "done" by the AI** | Mechanical gate, golden tests from this spec, human review per phase, independent reviewer agent |
| R10 | **Business rules not yet confirmed by PCMPC** | Defaults are marked `CONFIRM` in `docs/DOMAIN.md`. Claude logs questions instead of guessing |
| R11 | **NWRB.** A coop water system needs an NWRB Certificate of Public Convenience, and tariffs are NWRB-approved | The tariff in the MIS must equal the approved tariff (versioned, with the NWRB reference). Compliance doc in Phase 18 |
| R12 | **Member vs non-member income.** Coop tax treatment can differ for transactions with non-members | Water revenue is split by member/non-member on every bill and posted to separate accounts. Bookkeeper confirms the treatment |
| R13 | **Senior-citizen water discount (RA 9994)**: 5% if the meter is in the senior's name and consumption ≤ 30 m³ | Implemented as a configurable rule. Confirm applicability to PCMPC's water system |
| R14 | **Field connectivity** in hilly or remote puroks | Offline-first reading PWA plus printable reading sheets as a fallback |

## 9. Inputs needed from PCMPC (collect early)

| Needed by | Item |
|---|---|
| Phase 01 | CDA registration no., TIN, official address, fiscal year, list of staff and their roles (incl. billing clerks and meter readers) |
| Phase 02 | Membership form fields, member number format, PMES process |
| Phase 03 | Current chart of accounts (Excel), including water revenue, AR–Water and customer deposit accounts |
| **Phase 05** | **Existing water connections list, zones/puroks and routes, NWRB CPC and approved tariff, fees (connection, deposit, reconnection), meter types** |
| **Phase 06** | **Billing cycle and reading schedule, bill layout and paper size, due-date rule, estimation policy** |
| **Phase 07** | **Penalty and disconnection policy, notice period, overpayment policy, current water report formats** |
| Phase 08 | By-laws: par value, minimum subscription and paid-up, membership fee, CBU policy |
| Phase 09 | Savings and time-deposit products, rates, interest basis, crediting schedule |
| Phase 10–11 | Loan policy manual: products, rates, terms, deductions, penalties, approval limits, comaker rules |
| Phase 12–13 | Product list with prices, suppliers, member credit-limit policy |
| Phase 14 | Prior-year audited FS (format reference), fixed-asset list |
| Phase 15 | By-laws allocation percentages, ISC/PR policy (does water count as patronage?), GA resolution format |
| Phase 16 | Latest CDA CAPR and annex templates (Excel) |
| Phase 17 | Existing records (Excel / old system), last meter readings, unpaid water bills, and the cut-off trial balance |

## 10. References
- CDA mandatory reports reminder (FY 2025): https://cda.gov.ph/region-3/reminder-to-all-cooperatives-ending-2025-cda-mandatory-reports/
- CDA MC 2016-06, Revised Standard Chart of Accounts for Cooperatives: https://cda.gov.ph/memorandum-circulars/mc-2016-06-revised-standard-chart-of-accounts-for-cooperatives/
- CDA MC 2015-06, Philippine Financial Reporting Framework for Cooperatives: https://cda.gov.ph/memorandum-circulars/mc-2015-06-philippine-financial-reporting-framework-for-cooperatives
- CDA, Allocation & Distribution of Net Surplus: https://cda.gov.ph/wp-content/uploads/2021/01/Allocation_-_-Distribution_-of_-Net_-Surplus.pdf
- Tawang Multi-Purpose Cooperative v. La Trinidad Water District, G.R. No. 166471 (2011), on coop water systems and the NWRB CPC: https://batasnatin.com/laws/gr-166471
- RA 9994 senior-citizen water discount conditions (example utility guidance): https://www.baciwa.gov.ph/?p=875
- Neon, Vercel Postgres transition guide: https://neon.com/docs/guides/vercel-postgres-transition-guide
- Vercel Hobby plan (non-commercial, limits): https://vercel.com/docs/plans/hobby
