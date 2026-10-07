# Phase 17 — Data Migration & Opening Balances

**Goal:** bring PCMPC's existing records (Excel / old system) into the MIS at a cut-off date, with validation, dry-runs and reconciliation, so that subledgers equal the GL control accounts on day one.
**Depends on:** 16 (all modules exist).
**Inputs from PCMPC:** water customers and service accounts (member/non-member, classification, zone/route, sequence), meters with the **last actual reading** and the last 3 months' consumption, unpaid water bills/arrears per account, meter deposits held, member masterlist, share capital per member, savings per account, active loans (with remaining schedule/arrears), TDs, store stock count, supplier balances, member AR, and the **audited/approved trial balance as of the cut-off date**.

## Scope
- **In:** downloadable Excel templates per entity, upload, validation (dry-run report), staging tables, batch import, reconciliation, opening-balance JE, rollback of unposted batches, migrated-loan continuation.
- **Out:** migrating transaction history line by line (only balances and schedules are migrated, CONFIRM). Old documents stay in the archive.

## Data model
- `import_batches` (entity, file_name, uploaded_by, status UPLOADED|VALIDATED|STAGED|POSTED|ROLLED_BACK, error_count, cutoff_date)
- `import_errors` (batch_id, row, column, message)
- `stg_*` staging tables per entity

## Business rules
- Templates have fixed headers plus a "Read me" sheet. Dates use `YYYY-MM-DD`; amounts are plain numbers.
- **Dry-run** validates everything (required fields, member exists, duplicates, valid product codes, sums) and writes nothing to live tables.
- Import goes to staging → reconciliation screen: Σ subledger per control account vs cut-off TB.
- **Posting is blocked** unless every control account matches to the centavo. One opening JE (GJ, dated the cut-off) is then posted from the TB, and the subledger records are created with `source = MIGRATION`.
- Migrated water accounts: the last actual reading becomes the `previous_reading` for the first billing period; the last 3 months' consumption seeds the HIGH-flag average; each unpaid bill is migrated with its period, due date and a `penalty_assessed` flag (any penalty the old system already charged is part of the migrated balance), so aging and disconnection work on day one and the penalty job never charges twice.
- Migrated loans: create the remaining schedule from the installment number given (or regenerate from the original terms and mark installments ≤ N as PAID). Arrears carry their due dates so aging works on day one.
- Batches are idempotent (same file hash → rejected). An unposted batch can be rolled back completely.
- The cut-off period is OPEN for the opening JE only. It is locked after posting.

## Tasks
- **T17.1** Schema + migrations.
- **T17.2** Template generator (exceljs) for each entity.
- **T17.3** Upload + parser + validators + dry-run report (downloadable error list).
- **T17.4** Staging + reconciliation screen.
- **T17.5** Post: opening JE + subledger creation per module + migrated water accounts/bills, loans and TDs.
- **T17.6** Rollback + audit.
- **T17.7** Cut-over runbook in `docs/CUTOVER.md` (steps, owners, timing, freeze, sign-off).

## Acceptance tests (golden)
| ID | Given / When | Then |
|---|---|---|
| A17.1 | Download the member template | has the required headers in the documented order |
| A17.2 | Dry-run a file with a missing member no., the bad date `2026-13-01`, and a duplicate row | error report lists row + column + message for all 3; no live rows written |
| A17.3 | Import fixture: 3 members; share capital total ₱25,000.00; savings ₱12,000.00; 1 REG loan migrated after 2 payments of the A10.1 schedule | loan outstanding ₱8,454.90; subledger totals = TB controls; posting allowed; TB after posting = cut-off TB |
| A17.4 | Same fixture, TB savings control off by ₱0.01 | posting blocked; reconciliation shows a ₱0.01 difference on Savings Deposits |
| A17.5 | Migrated loan, next payment | installment 3 due amounts equal A10.1 row 3 (interest ₱126.82) |
| A17.6 | Upload the same file twice | second rejected (duplicate file hash) |
| A17.7 | Roll back an unposted batch | all staged rows removed; batch status ROLLED_BACK |
| A17.8 | Water fixture: account with last reading 1,250, one unpaid bill ₱400.00 due 2026-09-15 (penalty_assessed = true), deposit ₱1,000.00; first period present reading 1,268 | first bill 18 m³ = ₱400.00; total due ₱800.00; AR–Water and Customers' Deposits subledgers equal the TB controls |

## Exit checks
`npm run gate` · `npm run build` · `npm run e2e -- phase-17` · `docs/CUTOVER.md` written.

## /goal
```
/goal Complete Phase 17 exactly as specified in docs/phases/PHASE-17-migration.md, following CLAUDE.md. Done = all Phase 17 tasks ticked in PROGRESS.md, Phase 17 summary written, status 🟡, and npm run gate passes.
```
