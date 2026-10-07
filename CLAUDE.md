# CLAUDE.md — PCMPC MIS

You are building the **Pipindan Community Multi-Purpose Cooperative MIS**, one phase at a time, as a closed loop.
A Stop-hook gate (`scripts/gate.mjs`) runs `npm run gate` every time you try to stop. While it is red, you cannot stop.

## Read order (every session)
1. `PROGRESS.md`: the **current phase** is the first phase whose status is not ✅.
2. `docs/phases/PHASE-XX-*.md` for that phase. This is your spec. Do only what it says.
3. `docs/DOMAIN.md` whenever you touch members, money, rates, GL accounts or reports.
4. `PLAN.md §5`: the architecture rules. They are non-negotiable.

## Phase protocol
1. **Branch:** `git checkout -b phase-XX-<slug>`, or continue it if it exists. Set the phase status to 🔨 in `PROGRESS.md`.
2. **Tests first:** turn every row of the spec's *Acceptance tests* table into a test in `tests/acceptance/phase-XX.test.ts`, using the **exact golden values**. Add E2E cases to `tests/e2e/phase-XX.spec.ts`. Run them and confirm they fail for the right reason. Commit: `test(phase-XX): acceptance tests`.
3. **Build:** implement the tasks in order. After each task, add unit/integration tests for it, tick it in `PROGRESS.md`, and commit `feat(phase-XX): TXX.n <title>`.
4. **Gate:** run `npm run gate` until it is green. Fix the cause. Never weaken a test.
5. **Exit checks:** run everything in the spec's *Exit checks* section (`npm run build`, `npm run e2e -- phase-XX`, a fresh `db:reset && db:migrate && db:seed`).
6. **Summary:** append `### Phase XX summary` to `PROGRESS.md` with Built, Decisions, Deviations from spec (with reason), Follow-ups. Set status to 🟡 *awaiting review*.
7. **Stop.** Never start the next phase on your own. A human reviews, merges and tags.

## Hard rules
- **Never** edit, skip or loosen tests in `tests/acceptance/` to get green. If you believe a golden value is wrong, show your computation under `PROGRESS.md › Questions` and leave the test failing.
- No `.skip`, `.only`, `.todo`, `@ts-ignore`, `@ts-expect-error`, `any`, or `eslint-disable` without a written reason. No `TODO`, `FIXME`, `Not implemented`, or fake/mock data in `src/`. `npm run scan` enforces this.
- **Money:** bigint centavos only, through `src/lib/money.ts`. Never use JS `number` for amounts. Round HALF-UP to the centavo only where `docs/DOMAIN.md §Rounding` says.
- **Ledger-first:** every money movement calls `postJournal()` inside the same `db.transaction()` as the business record.
- **Immutability:** never UPDATE or DELETE posted financial rows. Correct them with `reverseJournal()` plus a new entry.
- **Dates:** business dates come from `src/lib/dates.ts` (Asia/Manila). Don't call `new Date()` for a business date.
- **Server actions:** `requirePermission()` → zod parse → service → `audit()`. Never trust client totals; recompute on the server.
- **DB changes** go only through Drizzle migrations (`npm run db:generate`). Never edit an applied migration.
- **Config over code:** rates, percentages, limits and GL account mappings come from settings tables, seeded from `docs/DOMAIN.md`.
- **Scope:** if something is not in the current phase spec, add it to `PROGRESS.md › Backlog`. Don't build it.
- **Unknown business rule?** Use the `CONFIRM` default from `docs/DOMAIN.md` and log it under `Questions`. Never invent a coop policy silently.
- Don't push to remote, deploy, or touch prod or Neon credentials unless the phase spec says so.
- Don't modify `PLAN.md`, `docs/DOMAIN.md` or `docs/phases/*`. Propose changes under `Questions`.

## Commands (created in Phase 00)
| Command | Does |
|---|---|
| `npm run dev` | Next.js dev server at http://localhost:3000 |
| `npm run db:up` / `db:down` | Start/stop local Postgres (docker compose) |
| `npm run db:generate` / `db:migrate` | Create / apply Drizzle migrations |
| `npm run db:seed` / `db:reset` | Seed reference data / drop and recreate the dev DB |
| `npm run typecheck` / `lint` | `tsc --noEmit` / ESLint |
| `npm test` | Vitest: unit + integration + acceptance (uses `DATABASE_URL_TEST`) |
| `npm run e2e` | Playwright E2E |
| `npm run scan` | Placeholder/cheat scanner (`scripts/scan-placeholders.mjs`) |
| `npm run gate` | typecheck → lint → test → scan. **This is the loop gate** |

## Conventions
- UI language is English. Currency is displayed as `₱1,234.56`. Dates are displayed as `Oct 07, 2026`, and the business TZ is Asia/Manila.
- Module code lives in `src/modules/<module>/{schema,service,actions}.ts` + `ui/`. Business rules belong in `service.ts` only.
- Table names are snake_case plural. Every table has `id`, `created_at` and `created_by`. Financial tables also have `je_id`.
- Commits follow Conventional Commits: `feat(phase-08): T8.2 share payment`.
- Test names start with the acceptance ID: `it("A8.2 pay ₱2,500 → paid-up 2,500", ...)`.
