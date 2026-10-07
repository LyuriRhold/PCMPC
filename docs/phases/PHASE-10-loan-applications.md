# Phase 10 — Loan Products, Amortization Engine & Applications

**Goal:** configurable loan products, a tested amortization engine (3 methods), eligibility checks, an application workflow with an approval matrix and SoD, and a loan disclosure statement.
**Depends on:** 08 (good standing, paid-up), 09 (optional savings checks).
**Inputs from PCMPC:** loan policy manual: products, rates, terms, maximums, deductions, comaker rules, approval limits.

## Scope
- **In:** loan products, deduction templates, amortization engine, eligibility engine, applications, comakers, approvals, disclosure statement (Truth in Lending, RA 3765) printout.
- **Out:** release, payments, penalties (Phase 11).

## Data model
- `loan_products` (code, name, method `DIMINISHING_EQUAL_AMORT|DIMINISHING_EQUAL_PRINCIPAL|ADD_ON`, rate_pm, min/max_term, frequency MONTHLY (others CONFIRM), max_amount, max_multiple_of_paid_up, required_comakers, penalty_rate_pm, grace_days, is_active, gl mapping key)
- `loan_product_deductions` (product_id, code SERVICE_FEE|CBU|LPP|NOTARIAL|OTHER, basis PCT_OF_PRINCIPAL|FIXED, value, gl mapping key)
- `loan_applications` (app_no, member_id, product_id, amount, term, purpose, status, encoded_by, eligibility jsonb snapshot, schedule_preview jsonb)
- `loan_application_comakers` (application_id, member_id)
- `loan_approvals` (application_id, level MANAGER|CREDIT_COMMITTEE, decision, remarks, by, at)

## Amortization engine (`src/modules/loans/amortization.ts`, pure functions)
- `schedule({principal, ratePm, term, method, firstDueDate})` → rows `{no, dueDate, principal, interest, payment, balance}`.
- Diminishing, equal amortization: A = P·r ÷ (1 − (1+r)^−n), rounded to the centavo. Each row's interest = round(balance × r). The last row absorbs the residue.
- Diminishing, equal principal: principal = P ÷ n (residue to the last row). Interest is on the opening balance.
- Add-on: total interest = P × r × n. Payment = round((P + I) ÷ n). The last row absorbs the residue.
- Due dates: `addMonths(firstDueDate, k)` (DOMAIN §3).
- `netProceeds(principal, deductions)` → itemized deductions + net.

## Eligibility (each rule returns pass/fail + message; stored as a snapshot)
1. Member ACTIVE and `isGoodStanding`.
2. Amount ≤ product max and ≤ `max_multiple_of_paid_up` × paid-up share capital.
3. Term within product min/max.
4. No past-due loans (the rule is active once Phase 11 exists; register it now as a hook that returns pass).
5. Required comakers: count met, each ACTIVE, none is the borrower, and none has past-due loans (hook).

## Workflow & approvals
SUBMITTED (loan officer) → RECOMMENDED (manager review) → APPROVED.
- Amounts ≤ `loan.manager_approval_limit`: the manager's approval = APPROVED.
- Above the limit: Credit Committee approval is also required.
- The encoder can never approve their own application (SoD). Rejection needs remarks.

## Tasks
- **T10.1** Schema, migrations, product + deduction seed (DOMAIN sample products, flagged CONFIRM).
- **T10.2** Amortization engine + exhaustive unit tests (golden + property test: Σ principal = P; balance ends at 0).
- **T10.3** Net proceeds calculator.
- **T10.4** Eligibility engine with the hook registry.
- **T10.5** Application service + approval matrix + SoD.
- **T10.6** UI: product admin, loan calculator (public to staff), application form with live schedule preview, approval queue, disclosure statement print.

## Acceptance tests (golden)
| ID | Given / When | Then |
|---|---|---|
| A10.1 | DIMINISHING_EQUAL_AMORT ₱10,000.00, 1.5%/mo, 12 months | payment ₱916.80; row 1: interest 150.00, principal 766.80, balance 9,233.20; row 2: interest 138.50, principal 778.30, balance 8,454.90; row 3 interest 126.82; row 12: payment 916.81, interest 13.55, principal 903.26, balance 0.00; total interest ₱1,001.61 |
| A10.2 | ADD_ON ₱10,000.00, 1.5%/mo, 12 months | total interest ₱1,800.00; rows 1–11 payment ₱983.33; row 12 ₱983.37; total ₱11,800.00 |
| A10.3 | DIMINISHING_EQUAL_PRINCIPAL ₱12,000.00, 1%/mo, 12 months | row 1 payment ₱1,120.00; row 12 payment ₱1,010.00; total interest ₱780.00 |
| A10.4 | Net proceeds ₱10,000.00 with service fee 2%, CBU 2%, notarial ₱100 | deductions 200.00 + 200.00 + 100.00; net ₱9,500.00 |
| A10.5 | Paid-up ₱5,000.00, multiple 3×, apply ₱20,000.00 | rejected "Exceeds loanable amount ₱15,000.00" |
| A10.6 | APPLICANT or not-in-good-standing member applies | rejected with the specific rule message |
| A10.7 | ₱50,000.00 application; manager approves (limit ₱30,000.00) | status RECOMMENDED; after Credit Committee approves → APPROVED |
| A10.8 | Loan officer `lo1` encodes and tries to approve | Forbidden (SoD) |
| A10.9 | Borrower listed as their own comaker | rejected |
| A10.10 | First due date 2026-01-31, monthly | due dates 2026-01-31, 2026-02-28, 2026-03-31 … |
| A10.11 | E2E: calculator shows A10.1 row 1; submit application → approve as manager | pass |

## Exit checks
`npm run gate` · `npm run build` · `npm run e2e -- phase-10`.

## /goal
```
/goal Complete Phase 10 exactly as specified in docs/phases/PHASE-10-loan-applications.md, following CLAUDE.md. Done = all Phase 10 tasks ticked in PROGRESS.md, Phase 10 summary written, status 🟡, and npm run gate passes.
```
