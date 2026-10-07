# Phase 00 — Foundation & Loop Gate

**Goal:** a runnable, tested Next.js skeleton on local Postgres, the core money/date libraries, and the Stop-hook gate that makes every later phase a closed loop.
**Depends on:** nothing.
**Inputs from PCMPC:** none.
**Run mode:** **interactive** (normal prompt, not `/goal`), because the gate doesn't exist until T0.9. From Phase 01 on, use `/goal`.

## Scope
- **In:** repo setup, Next.js + TS strict + Tailwind + shadcn/ui, Docker Postgres (dev + test DBs), Drizzle, Vitest + Playwright, `money.ts`, `dates.ts`, placeholder scanner, gate, reviewer agent, health page, CI workflow.
- **Out:** auth, any business tables, deployment to Vercel (Phase 18).

## Tasks
- **T0.1** `git init` on `main`. Add `.gitignore` (node, .next, .env*, `.claude/gate-state.json`, playwright reports), `.editorconfig`, `.nvmrc` (current Node LTS), and a short `README.md`.
- **T0.2** Scaffold Next.js (App Router, TypeScript, Tailwind, ESLint, `src/`, alias `@/*`, npm). The folder already has docs, so if `create-next-app` refuses the non-empty folder, scaffold into `./_scaffold`, move the files up, and delete `_scaffold`. Turn on `"strict": true` and `"noUncheckedIndexedAccess": true`.
- **T0.3** shadcn/ui init. Build the base staff layout: sidebar (modules appear only once built), top bar showing the business date, peso formatting helper used by the UI.
- **T0.4** `docker-compose.yml` with Postgres (latest stable major), creating DBs `pcmpc` and `pcmpc_test`. Add `.env.example` with `DATABASE_URL`, `DATABASE_URL_TEST`, `AUTH_SECRET`, `CRON_SECRET`, `APP_TZ=Asia/Manila`. Scripts: `db:up`, `db:down`. README notes for Windows: Docker Desktop, or native PostgreSQL install as an alternative.
- **T0.5** Drizzle: `src/db/client.ts` (`pg` Pool; the URL comes from env), `drizzle.config.ts`, scripts `db:generate`, `db:migrate`, `db:seed`, `db:reset`. Add a helper `withTx(fn)` and the test-DB lifecycle (migrate once, truncate between tests).
- **T0.6** `src/lib/money.ts`: `Money` = bigint centavos; `parse("1,234.56")`, `format()` → `₱1,234.56`, `add/sub`, `mulRate(amount, rate, roundingMode)` with HALF-UP default, `allocate(total, weights)` using the largest-remainder method, `sum()`. Never uses JS floats internally.
- **T0.7** `src/lib/dates.ts`: `businessToday(now?)` in Asia/Manila, `addMonths` (clamped to month end), `daysBetween`, `monthEnd`, `quarterOf`, `formatDate()` → `Oct 07, 2026`. Accepts an injectable clock for tests.
- **T0.8** Test harness: Vitest projects (unit, integration, acceptance) with `tests/setup-db.ts`. Playwright config (base URL localhost:3000, starts the dev server). Write `scripts/scan-placeholders.mjs` per `LOOP.md §2.3`. Add the package scripts from `LOOP.md §2.4`.
- **T0.9** Loop files exactly as in `LOOP.md §2`: `.claude/settings.json`, `scripts/gate.mjs`, `.claude/agents/reviewer.md`.
- **T0.10** `/health` page: app version, DB connectivity (`SELECT 1`), business date, environment name.
- **T0.11** `.github/workflows/ci.yml`: Postgres service, then `npm ci`, migrate, `npm run gate`, `npm run build`, `npm run e2e`.
- **T0.12** Prove the gate (`LOOP.md §2.6`) and record the result in the Phase 00 summary.

## Acceptance tests (golden — use these exact values)
| ID | Given / When | Then |
|---|---|---|
| A0.1 | `money.parse("1,234.56")` | `123456n`; `money.format(123456n)` → `"₱1,234.56"`; `format(-5000n)` → `"-₱50.00"` |
| A0.2 | `mulRate(₱916.80, "0.02")` HALF-UP | `₱18.34` (1834n) |
| A0.3 | `mulRate(₱0.25, "0.5")` HALF-UP | `₱0.13` (12.5 centavos → 13) |
| A0.4 | `allocate(₱100.00, [1,1,1])` | `[₱33.34, ₱33.33, ₱33.33]`, sum = ₱100.00 |
| A0.5 | `businessToday()` when the clock = `2026-10-06T16:30:00Z` | `2026-10-07` (Manila is UTC+8) |
| A0.6 | `addMonths(2026-01-31, 1)` / `addMonths(2028-01-31, 1)` | `2026-02-28` / `2028-02-29` |
| A0.7 | `daysBetween(2026-01-01, 2026-04-01)` | `90` |
| A0.8 | Scanner on fixture files containing `// TODO` and `it.only(` | exits 1 and reports both lines; on a clean fixture it exits 0 |
| A0.9 | Integration: insert a row in `withTx`, then throw | the row does not exist afterward (rollback) |
| A0.10 | E2E: open `/health` | shows `DB: OK` and today's Manila date |

## Exit checks
- `npm run gate` green · `npm run build` green · `npm run e2e` green
- Gate proof done (T0.12): the Stop hook blocked at least once, then allowed the stop when green
- Fresh clone: `npm ci && npm run db:up && npm run db:migrate && npm run dev` works

## Prompt (interactive, not /goal)
```
Start Phase 00. Follow CLAUDE.md and docs/phases/PHASE-00-foundation.md. Do the tasks in order, then the acceptance tests and exit checks. Write the Phase 00 summary in PROGRESS.md and stop.
```
