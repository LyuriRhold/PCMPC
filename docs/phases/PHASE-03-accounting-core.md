# Phase 03 — Accounting Core (GL engine)

**Goal:** the double-entry engine that every module posts through: chart of accounts, fiscal periods, `postJournal` / `reverseJournal`, manual journal vouchers with approval, general ledger, trial balance and member subsidiary ledgers.
**Depends on:** 01. Can run before or after 02.
**Inputs from PCMPC:** current chart of accounts (Excel) from the bookkeeper/auditor → `docs/coa/pcmpc-coa.csv`.

## Scope
- **In:** COA, account mappings, fiscal years/periods, journal entries/lines, ledger service, immutability trigger, manual JV workflow, GL report, TB, journal books listing, subsidiary ledger by member, Excel export of TB/GL.
- **Out:** FS formats and period-close checklist (Phase 14), bank recon (Phase 14).

## Data model
- `accounts` (code unique, name, type `ASSET|LIABILITY|EQUITY|REVENUE|EXPENSE`, normal_balance `DR|CR`, parent_id, level, is_postable, is_active, sca_code, provisional bool)
- `account_mappings` (key unique, account_id). Keys are listed in DOMAIN §6.
- `fiscal_years`, `periods` (year, month, status OPEN|CLOSED, closed_by/at)
- `journal_entries` (je_no, book `GJ|CRJ|CDJ|SJ|PJ`, entry_date, reference, particulars, source_module, source_id, status, prepared_by, approved_by, posted_at, reversal_of_id, reversed_by_id)
- `journal_lines` (je_id, line_no, account_id, member_id nullable, debit bigint ≥0, credit bigint ≥0, memo). CHECK: exactly one of debit/credit > 0.
- DB trigger: no UPDATE/DELETE on lines of a POSTED/REVERSED entry. The only update allowed on a posted entry is setting status → REVERSED and `reversed_by_id`.

## Ledger service (`src/modules/ledger/service.ts`)
- `postJournal(tx, {date, book, particulars, reference?, source?, lines[]})` checks:
  - debits = credits, and both are > 0
  - every account exists, is postable and active
  - the period of `date` is OPEN
  - lines on member-subsidiary accounts (flagged in mappings) carry a member_id

  Then it assigns `je_no` from the book's series, sets status POSTED, and returns the entry.
- `reverseJournal(tx, jeId, date, reason)` creates a mirror entry (same book, `reversal_of_id`) and marks the original REVERSED. A REVERSED entry can't be reversed again.
- Manual JV: `createDraft` → `approve` (`gl.jv_approve`, approver ≠ preparer) → posts.
- Queries: `accountBalance(accountId, asOf)`, `trialBalance(asOf)`, `generalLedger(accountId, from, to)` (opening balance + running balance), `subsidiaryLedger(mappingKey, memberId, from, to)`.

## COA seed
- If `docs/coa/pcmpc-coa.csv` exists, import it.
- If not, seed a **provisional** COA following the CDA Revised SCA structure (1 Assets, 2 Liabilities, 3 Equity, 4 Revenues, 5 Expenses) with only the accounts needed by the DOMAIN §6 mapping keys, flagged `provisional=true`. Log a Question asking for the real COA.

## Tasks
- **T3.1** Schema, migrations, immutability trigger, CHECK constraints.
- **T3.2** COA import (CSV) + provisional seed + account mappings seed + fiscal year 2026 periods.
- **T3.3** Ledger service: postJournal, reverseJournal, balances.
- **T3.4** Manual JV workflow + UI (draft, lines grid with live debit/credit totals, approve, post, reverse).
- **T3.5** Reports: Trial Balance (as-of), General Ledger (account, date range), Journal books listing, Subsidiary ledger by member. Excel export via exceljs.
- **T3.6** COA management UI (add/edit/deactivate; can't deactivate an account with a balance).

## Acceptance tests (golden)
| ID | Given / When | Then |
|---|---|---|
| A3.1 | postJournal Dr Cash 1,000.00 / Cr Share Capital 999.99 | rejected "Entry is not balanced (₱1,000.00 vs ₱999.99)" |
| A3.2 | Post to a header (non-postable) account | rejected |
| A3.3 | Post dated 2026-09-15 when Sep 2026 is CLOSED | rejected "Period 2026-09 is closed" |
| A3.4 | First valid GJ entry in 2026 | je_no `GJ-2026-00001`, status POSTED |
| A3.5 | Post (a) Dr Cash 50,000 / Cr Share Capital 50,000; (b) Dr Loans Receivable 20,000 / Cr Cash 20,000; (c) Dr Cash 1,500 / Cr Interest Income 1,500 | TB: Cash 31,500 Dr · Loans Receivable 20,000 Dr · Share Capital 50,000 Cr · Interest Income 1,500 Cr · totals ₱51,500.00 = ₱51,500.00 |
| A3.6 | Reverse (c) | new entry with swapped lines; (c) status REVERSED; TB Cash 30,000 Dr; Interest Income 0; reversing (c) again → rejected |
| A3.7 | Raw SQL `UPDATE journal_lines SET debit=…` on (a) | DB error (trigger) |
| A3.8 | JV prepared by `book1` approved by `book1` | Forbidden (SoD); approved by `mgr1` → POSTED |
| A3.9 | GL for Cash after A3.5 | running balances 50,000.00 → 30,000.00 → 31,500.00 |
| A3.10 | Lines on `savings_deposits` for M-000001: Cr 2,000, Dr 500 | subsidiary ledger balance for M-000001 = ₱1,500.00 Cr; a line on that account without member_id → rejected |
| A3.11 | E2E: create JV → approve as another user → appears in TB | pass |

## Exit checks
`npm run gate` · `npm run build` · `npm run e2e -- phase-03`. TB on the seeded fixture balances.

## /goal
```
/goal Complete Phase 03 exactly as specified in docs/phases/PHASE-03-accounting-core.md, following CLAUDE.md. Done = all Phase 03 tasks ticked in PROGRESS.md, Phase 03 summary written, status 🟡, and npm run gate passes.
```
