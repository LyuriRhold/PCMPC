# Phase 15 — Net Surplus Allocation, Interest on Share Capital & Patronage Refund

**Goal:** the year-end cycle. Allocate net surplus to statutory funds per RA 9520 and the by-laws, compute ISC (by ASM) and PR (by patronage) per member, get GA approval, post, and distribute (savings, capitalization, cash, arrears offset).
**Depends on:** 14 (year-end net surplus), 08 (ASM), 11 (loan interest paid), 13 (store patronage).
**Inputs from PCMPC:** by-laws allocation %, ISC/PR split, PR basis, payout options, CETF recipient (federation/union), tax treatment, GA resolution format.

## Scope
- **In:** allocation config + validation, allocation run (draft → review → approve → post), per-member ISC & PR, distribution with member elections and arrears offset, CETF payable tracking and remittance via DV, reports (allocation summary, per-member ISC/PR list for GA).
- **Out:** CDA templates (Phase 16).

## Data model
- `surplus_allocations` (fiscal_year, net_surplus, reserve, etf_local, cetf, cdf, optional, remaining, isc_pool, pr_pool, isc_rate, pr_rate, status DRAFT|APPROVED|POSTED|DISTRIBUTED, ga_resolution_no, prepared_by, approved_by, je_id)
- `surplus_member_lines` (allocation_id, member_id, asm, isc, patronage_loan_interest, patronage_store, patronage_total, pr, gross, wtax, arrears_offset, net, payout_savings, payout_capitalize, payout_cash)

## Business rules
- Net surplus comes from the FY's Statement of Operations (Phase 14, after the year-end close).
- **Validation (blocks posting):** reserve ≥ 10%, ETF ≤ 10%, CDF ≥ 3%, optional ≤ 7%, PR share of remaining ≥ 30%, ISC + PR = 100% of remaining. All percentages come from settings.
- ETF splits 50% local ETF / 50% CETF payable to the federation/union.
- **ISC rate** = ISC pool ÷ Σ ASM of eligible members. Per member: round(ASM × rate). The pool is split with `money.allocate` so that Σ member ISC = pool exactly.
- **PR rate** = PR pool ÷ Σ patronage. Patronage = loan interest paid in the FY + net store purchases + water bills paid by members (per `surplus.pr_basis`; whether water counts is CONFIRM). Non-members never receive PR. Split exactly with `allocate`.
- Withholding per `surplus.isc_pr_wtax_rate` (default 0, CONFIRM).
- **Arrears offset** (if enabled): past-due loan amounts are deducted first via a loan payment.
- **Distribution** per member election (default from settings): credit to savings / capitalize to share capital / cash via DV.
- **SoD:** preparer (BOOKKEEPER) ≠ approver (MANAGER). A GA resolution no. is required before POSTED.
- One allocation per FY. Re-running a POSTED year is blocked.

## Tasks
- **T15.1** Schema + migrations.
- **T15.2** Allocation engine (pure) + validation.
- **T15.3** Per-member ISC/PR computation using `averageShareMonth`, loan interest paid, `storePatronage`.
- **T15.4** Workflow: draft → approve → post (GL) → distribute (savings/share/cash/offset).
- **T15.5** CETF payable report + remittance via DV.
- **T15.6** UI + reports (allocation summary, per-member list for GA, Excel export).

## Acceptance tests (golden)
| ID | Given / When | Then |
|---|---|---|
| A15.1 | Net surplus ₱1,000,000.00 with 10/10/3/7 | Reserve ₱100,000.00; ETF ₱100,000.00 (local ₱50,000.00, CETF ₱50,000.00); CDF ₱30,000.00; Optional ₱70,000.00; remaining ₱700,000.00 |
| A15.2 | Remaining ₱700,000.00, ISC 70% / PR 30% | ISC pool ₱490,000.00; PR pool ₱210,000.00 |
| A15.3 | Reserve 8% / ETF 12% / PR 20% | each blocked with a specific message |
| A15.4 | ISC pool ₱2,100.00; ASM A ₱12,000.00, B ₱9,000.00 | rate 10.00%; A ₱1,200.00; B ₱900.00 |
| A15.5 | PR pool ₱4,000.00; patronage A ₱10,000.00 (₱3,000 interest + ₱7,000 store), B ₱30,000.00 | rate 10.00%; A ₱1,000.00; B ₱3,000.00 |
| A15.6 | ISC pool ₱100.00, three members with equal ASM | ₱33.34, ₱33.33, ₱33.33 (sum ₱100.00) |
| A15.7 | Post the A15.1 allocation | balanced JE; Undivided Net Surplus balance = ₱0.00; fund accounts equal A15.1 |
| A15.8 | Member A (₱2,200.00 gross) elects 50% capitalize / 50% savings | paid-up +₱1,100.00; savings +₱1,100.00 |
| A15.9 | Member B has past-due arrears ₱500.00, offset ON | ₱500.00 applied as a loan payment first; net payout ₱3,400.00 (900 + 3,000 − 500) |
| A15.10 | Approve as the preparer / post without a GA resolution / re-run FY 2026 after POSTED | Forbidden / rejected / rejected |

## Exit checks
`npm run gate` · `npm run build` · `npm run e2e -- phase-15`.

## /goal
```
/goal Complete Phase 15 exactly as specified in docs/phases/PHASE-15-surplus-allocation.md, following CLAUDE.md. Done = all Phase 15 tasks ticked in PROGRESS.md, Phase 15 summary written, status 🟡, and npm run gate passes.
```
