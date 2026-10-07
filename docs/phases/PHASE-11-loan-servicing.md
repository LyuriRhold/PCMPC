# Phase 11 — Loan Release, Collections, Penalties & Aging

**Goal:** release approved loans with deductions (GL + CBU), accept payments with the correct allocation, compute penalties, age the portfolio, compute PAR, and handle restructure/write-off. Daily jobs are idempotent.
**Depends on:** 10.
**Inputs from PCMPC:** penalty policy, payment allocation policy, excess-payment policy, allowance rates, write-off/restructure policy.

## Scope
- **In:** release, loan ledger, schedule tracking, payments, penalties, daily job, aging snapshot, PAR, delinquency list, restructure, write-off, past-due eligibility hooks, `canTerminate` rule, loan offset on member termination.
- **Teller integration:** register receipt item `LOAN_PAYMENT` (dues = amortizations due + penalties) and cash-out `LOAN_PROCEEDS` in the Phase 04 registry.

## Data model
- `loans` (loan_no, application_id, member_id, product_id, principal, rate_pm, method, term, release_date, first_due_date, maturity_date, status, je_id)
- `loan_schedule` (loan_id, no, due_date, principal_due, interest_due, principal_paid, interest_paid, penalty_accrued, penalty_paid, status OPEN|PARTIAL|PAID)
- `loan_payments` (loan_id, pay_date, amount, penalty_part, interest_part, principal_part, ref_no, bir_receipt_no?, je_id, reversed_by)
- `loan_penalty_accruals` (loan_id, schedule_no, business_date, amount), unique (loan, schedule_no, business_date)
- `loan_aging_snapshots` (as_of, loan_id, days_past_due, bucket, outstanding_principal)

## Business rules
- **Release** (`loans.release`, ≠ approver): schedule from the engine. GL per DOMAIN §6. The CBU deduction calls `share.retainCbu`. Net proceeds are paid in cash, or credited to savings (CONFIRM option).
- **Interest recognition:** per `loan.interest_recognition` (default: on collection). The loan receivable carries principal only.
- **Payment allocation:** per `loan.payment_allocation`, oldest installment first. Excess per `loan.excess_payment`.
- **Penalty:** applies when days past due > `grace_days`. Penalty = unpaid installment amount × `penalty_rate_pm` × days past due ÷ 30, HALF-UP. Accrued by the daily job (memo; recognized as income when collected).
- **Days past due** = business date − due date of the oldest unpaid installment.
- **PAR** = outstanding principal of loans with days past due > `par_threshold_days` ÷ total outstanding principal.
- A loan becomes PAID when all installments are PAID. It is PAST_DUE while any installment is past due.
- Activate the Phase 10 hooks: borrower or comaker with a PAST_DUE loan → ineligible (when `loan.block_if_past_due`).
- Register `canTerminate` rule: no ACTIVE/PAST_DUE loans. On termination, offer **offset**: apply share capital/savings to the loan balance (GL entry) before withdrawal.
- **Write-off:** BOD resolution ref required → Dr Allowance / Cr Loans Receivable. Recoveries later → Dr Cash / Cr Recovery income (CONFIRM account).
- **Restructure:** closes the old loan's balance into a new loan (new schedule). Keep the link and flag it.
- The daily job (registered in the Phase 07 cron runner) runs penalties + aging snapshot + status updates. It is idempotent per business date.

## Tasks
- **T11.1** Schema + migrations.
- **T11.2** Release service (GL, CBU, schedule persistence, loan_no).
- **T11.3** Collection service (allocation, excess handling, GL, reversal of a payment).
- **T11.4** Penalty engine + daily job + job_runs idempotency.
- **T11.5** Aging/PAR service + snapshot + delinquency list (with comakers and contact numbers).
- **T11.6** Write-off, restructure, termination offset, eligibility hooks, `canTerminate`.
- **T11.7** UI: release screen (deductions preview), loan ledger card, delinquency report, aging report, PAR on dashboard tile.
- **T11.8** Teller registrations (`LOAN_PAYMENT`, `LOAN_PROCEEDS`) + the cross-module receipt test A11.14.

## Acceptance tests (golden; uses A10.1 loan released 2026-01-15, first due 2026-02-15)
| ID | Given / When | Then |
|---|---|---|
| A11.1 | Release ₱10,000.00 REG (2% fee, 2% CBU, ₱100 notarial) | GL Dr Loans Receivable 10,000.00 / Cr Cash 9,500.00 / Cr Service Fee Income 200.00 / Cr Subscription Receivable (CBU) 200.00 / Cr Notarial Fee Income 100.00; member paid-up +₱200.00; 12 schedule rows equal A10.1 |
| A11.2 | Pay ₱916.80 on 2026-02-15 | interest 150.00 → Interest Income; principal 766.80 → Loans Receivable; outstanding ₱9,233.20; inst 1 PAID |
| A11.3 | (fresh loan) Pay ₱500.00 on inst 1 | interest 150.00, principal 350.00; inst 1 PARTIAL |
| A11.4 | (fresh loan) Inst 1 unpaid, business date 2026-03-17 (30 days past due) | penalty ₱18.34; paying ₱935.14 → penalty 18.34, interest 150.00, principal 766.80; inst 1 PAID |
| A11.5 | (fresh loan) Pay ₱2,000.00 on 2026-02-15 | inst 1 PAID (916.80), inst 2 PAID (916.80), inst 3 interest 126.82 + principal 39.58; outstanding principal ₱8,415.32 |
| A11.6 | Oldest unpaid due 2026-05-15, as of 2026-06-30 | days past due 46; bucket "31–90" |
| A11.7 | Portfolio: ₱10,000 current, ₱5,000 at 46 dpd, ₱5,000 at 10 dpd | PAR(>30) = 25.00% |
| A11.8 | Daily job run twice for 2026-03-17 | penalties accrued once |
| A11.9 | Borrower has a PAST_DUE loan, applies for a new loan / is named as comaker | both rejected |
| A11.10 | Loan fully paid | status PAID; `canTerminate` passes the loan rule |
| A11.11 | Write-off without BOD ref | rejected; with ref → Dr Allowance / Cr Loans Receivable for the outstanding principal |
| A11.12 | Reverse payment A11.2 | reversal JE; inst 1 back to OPEN; outstanding ₱10,000.00 |
| A11.13 | E2E: release → pay at the teller → ledger card shows the balance | pass |
| A11.14 | ONE teller receipt for M-000001: membership fee 500.00 + share payment 1,000.00 + savings deposit 2,000.00 + loan payment 916.80 (inst 1) + water bill 400.00 | total ₱4,816.80; exactly ONE CRJ: Dr Cash 4,816.80 / Cr Membership Fee 500.00 / Cr Subscription Receivable 1,000.00 / Cr Savings Deposits 2,000.00 / Cr Interest Income 150.00 / Cr Loans Receivable 766.80 / Cr AR–Water 400.00; all five subledgers updated; cancelling it restores all of them |

## Exit checks
`npm run gate` · `npm run build` · `npm run e2e -- phase-11`. TB balances after the fixture.

## /goal
```
/goal Complete Phase 11 exactly as specified in docs/phases/PHASE-11-loan-servicing.md, following CLAUDE.md. Done = all Phase 11 tasks ticked in PROGRESS.md, Phase 11 summary written, status 🟡, and npm run gate passes.
```
