# Phase 09 — Savings & Time Deposits

**Goal:** deposit products and accounts, deposits and withdrawals, idempotent interest runs, time deposits with maturity/pre-termination, and dormancy, all posted to the GL.
**Depends on:** 02, 03.
**Inputs from PCMPC:** savings and time-deposit products, rates, interest basis, crediting schedule, maintaining balance, dormancy rule, withholding tax treatment.

## Scope
- **In:** products, accounts, transactions, passbook-style ledger, ADB interest engine, quarterly interest run, time deposits, dormancy job, account closure, `canTerminate` rule.
- **Teller integration:** register receipt item `SAVINGS_DEPOSIT` and cash-out `SAVINGS_WITHDRAWAL` in the Phase 04 registry.
- **Out:** passbook printer layout (Backlog unless simple print CSS).

## Data model
- `deposit_products` (code, name, kind SAVINGS|TIME, rate_pa, interest_basis, crediting, min_balance_earn, maintaining_balance, dormant_after_months, wtax_rate, gl mapping keys)
- `deposit_accounts` (account_no, member_id, product_id, status OPEN|DORMANT|CLOSED, opened_at, closed_at, last_customer_txn_at)
- `deposit_transactions` (account_id, txn_date, type `DEPOSIT|WITHDRAWAL|INTEREST|WTAX|ADJUSTMENT|TRANSFER_IN|TRANSFER_OUT`, amount, balance_after, ref_no, bir_receipt_no?, je_id)
- `time_deposits` (account_id, certificate_no, principal, rate_pa, term_days, placement_date, maturity_date, status ACTIVE|MATURED|PRETERMINATED|ROLLED_OVER, interest_paid, je_id)
- Uses `job_runs` / `runOnce` from Phase 06 and the daily cron runner from Phase 07.

## Business rules
- Only ACTIVE members can open accounts. One regular savings account per member (CONFIRM).
- A withdrawal can't take the balance below `maintaining_balance`. DORMANT accounts need a reactivation step first, and any DEPOSIT reactivates the account.
- **Interest:** ADB = Σ(daily closing balance) ÷ days in period. Interest = ADB × rate × days ÷ 365, rounded HALF-UP per account. If ADB < `min_balance_earn`, interest = 0.
- **Interest run** `savings.runInterest(productId, periodEnd)` is idempotent via `job_runs` key `savings-interest:{product}:{periodEnd}`. It creates **one** GL entry (Dr Interest Expense total / Cr Savings Deposits per member line) plus WTAX if the rate > 0.
- **Time deposit:** maturity interest = principal × rate × term_days ÷ 365. On pre-termination, interest uses `td.pretermination_rate` for days held.
- **Dormancy job:** marks OPEN accounts with no customer-initiated txn for `dormant_after_months` as DORMANT. Idempotent per business date.
- Register `canTerminate` rule: "all deposit accounts closed (zero balance)".

## Screens
Products admin · Member profile tab **Savings** (accounts, ledger) · Open account · Deposit / Withdraw forms · Interest run screen (preview → post) · Time deposit placement / maturity / pre-terminate · Dormant accounts list.

## Tasks
- **T9.1** Schema + migrations.
- **T9.2** Deposit service: open, deposit, withdraw, close, reactivate, ledger with balance_after.
- **T9.3** ADB + interest engine (pure functions + tests), interest run with preview and post.
- **T9.4** Time deposits: place, mature, pre-terminate, rollover.
- **T9.5** Dormancy job registered in the Phase 07 daily cron runner + teller registrations (`SAVINGS_DEPOSIT`, `SAVINGS_WITHDRAWAL`).
- **T9.6** UI + actions + permissions + audit.

## Acceptance tests (golden; 2% p.a., actual/365, min ₱500 ADB, maintaining ₱100)
| ID | Given / When | Then |
|---|---|---|
| A9.1 | APPLICANT opens savings | rejected "Member must be ACTIVE" |
| A9.2 | Deposit ₱10,000.00, withdraw ₱3,000.00 | balance ₱7,000.00; GL Savings Deposits subsidiary for member = ₱7,000.00 Cr |
| A9.3 | Withdraw ₱6,950.00 from ₱7,000.00 | rejected (would breach maintaining balance ₱100.00) |
| A9.4 | Constant ₱10,000.00 for a 90-day quarter | interest ₱49.32 |
| A9.5 | ₱10,000.00 for 45 days then ₱20,000.00 for 45 days (90-day quarter) | ADB ₱15,000.00; interest ₱73.97 |
| A9.6 | ADB ₱400.00 | interest ₱0.00 |
| A9.7 | Run the interest for the same product and quarter twice | second run rejected "already run"; GL has exactly one interest entry |
| A9.8 | TD ₱50,000.00, 3% p.a., 180 days, to maturity | interest ₱739.73 |
| A9.9 | Same TD pre-terminated on day 90 (savings rate 2%) | interest ₱246.58 |
| A9.10 | No customer txn for 24 months → dormancy job; then deposit | status DORMANT, then OPEN after deposit; running the job twice on the same date changes nothing |
| A9.11 | E2E: open account → deposit and withdraw at the teller → ledger shows balances | pass |

## Exit checks
`npm run gate` · `npm run build` · `npm run e2e -- phase-09`.

## /goal
```
/goal Complete Phase 09 exactly as specified in docs/phases/PHASE-09-savings.md, following CLAUDE.md. Done = all Phase 09 tasks ticked in PROGRESS.md, Phase 09 summary written, status 🟡, and npm run gate passes.
```
