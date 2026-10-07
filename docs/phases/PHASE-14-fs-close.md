# Phase 14 — Financial Statements, Period Close & Fixed Assets

**Goal:** produce PFRF-for-Cooperatives financial statements straight from the GL, close months and the year with a checklist, record depreciation, and reconcile bank accounts.
**Depends on:** 03–13 (all money modules).
**Inputs from PCMPC:** prior-year audited FS (format reference), fixed-asset list, bank accounts, FS line grouping confirmed by the bookkeeper/auditor.

## Scope
- **In:** FS line mapping, Statement of Financial Condition, Statement of Operations (by business segment: water service, credit, consumer store), Statement of Changes in Equity, Statement of Cash Flows (indirect), comparatives, month-end close checklist and lock, year-end closing entries, opening balances of the new FY, fixed-asset register + straight-line depreciation, bank reconciliation, Excel/PDF export.
- **Out:** net surplus allocation (Phase 15), CDA templates (Phase 16).

## Data model
- `fs_lines` (statement, code, caption, order, parent, sign), `fs_line_accounts` (fs_line_id, account_id)
- `segments` (WATER, CREDIT, CONSUMER, GENERAL) and `account_segments` (optional per-account segment for Statement of Operations)
- `fixed_assets` (tag, description, class, acquisition_date, cost, salvage, life_months, accumulated, status), `depreciation_runs` (period, je_id)
- `bank_accounts`, `bank_statements` + lines, `bank_recon` (period, book balance, bank balance, outstanding checks, deposits in transit, adjustments)
- `close_checklists` (period, item, status, by, at)

## Business rules
- Statements are computed from TB balances via `fs_line_accounts`. Every postable account must be mapped (a check fails if one isn't).
- **Month close checklist** (all must pass): all teller sessions VERIFIED; all POS shifts CLOSED; water billing runs posted for every zone billed this month; no DRAFT JVs; daily jobs ran for every business date; depreciation run posted; savings interest run done if the month is a quarter-end; bank recon saved.
- Closing locks the period. Reopening needs ADMIN, a reason, and an audit entry.
- **Year-end close:** closing entries zero all revenue and expense accounts into `undivided_net_surplus`. The new FY opening balances equal the closing balance sheet.
- **Depreciation:** straight-line monthly = (cost − salvage) ÷ life_months, HALF-UP. The last month absorbs the residue. Idempotent per period.

## Tasks
- **T14.1** Schema + migrations + FS line seed (PFRF-for-Coops layout; mark it CONFIRM).
- **T14.2** FS engine (all 4 statements + comparatives) + mapping completeness check.
- **T14.3** Fixed assets + depreciation run.
- **T14.4** Bank reconciliation.
- **T14.5** Month close checklist + lock/reopen; year-end close + new FY opening.
- **T14.6** UI + Excel (exceljs) and PDF exports.

## Acceptance tests (golden fixture: FY 2026, all via `postJournal`)
Fixture entries:
1. Share capital paid-up 100,000 (cash)
2. Savings deposits 50,000 (cash)
3. Loan released 120,000 (cash)
4. Loan interest collected 18,000
5. Service fees 2,400
6. Store purchases 60,000 (cash)
7. Store sales 70,000 (cash), COGS 52,000
8. Salaries 15,000
9. Utilities 3,000
10. Savings interest 1,000 (credited to savings)
11. Loan principal collected 40,000

| ID | Given / When | Then |
|---|---|---|
| A14.1 | Statement of Operations | revenues ₱90,400.00 (interest 18,000 + service fees 2,400 + sales 70,000); expenses ₱71,000.00 (COGS 52,000 + salaries 15,000 + utilities 3,000 + interest expense 1,000); **net surplus ₱19,400.00** |
| A14.2 | Statement of Financial Condition | Cash 82,400; Loans Receivable 80,000; Inventory 8,000; **Total Assets ₱170,400.00**; Savings Deposits 51,000; Share Capital 100,000; Net Surplus 19,400; **L + E ₱170,400.00** |
| A14.3 | Cash flow statement | ending cash ₱82,400.00 = GL cash |
| A14.4 | Close a month with an OPEN teller session | blocked; the checklist shows the failing item |
| A14.5 | Post into a closed month / reopen as BOOKKEEPER | rejected / Forbidden; reopen as ADMIN with a reason → allowed + audited |
| A14.6 | Year-end close of the fixture | revenue and expense accounts = 0; Undivided Net Surplus ₱19,400.00 Cr; FY 2027 opening TB = 2026 closing balance sheet |
| A14.7 | Equipment ₱36,000.00, 36 months, no salvage | monthly depreciation ₱1,000.00; running the same period twice → rejected |
| A14.8 | An unmapped postable account exists | FS generation fails with the list of unmapped accounts |
| A14.9 | Export FS to .xlsx and .pdf | files open; totals equal A14.1/A14.2 |

## Exit checks
`npm run gate` · `npm run build` · `npm run e2e -- phase-14`.

## /goal
```
/goal Complete Phase 14 exactly as specified in docs/phases/PHASE-14-fs-close.md, following CLAUDE.md. Done = all Phase 14 tasks ticked in PROGRESS.md, Phase 14 summary written, status 🟡, and npm run gate passes.
```
