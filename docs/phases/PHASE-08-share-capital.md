# Phase 08 — Share Capital & CBU

**Goal:** member share subscriptions, payments, CBU, transfers and withdrawals, all posted to the GL, with a member share ledger and the ASM computation needed for ISC.
**Depends on:** 02, 03.
**Inputs from PCMPC:** by-laws: par value, minimum subscription, minimum paid-up, membership fee, CBU policy, share-holding cap.

## Scope
- **In:** membership fee collection, subscriptions, payments, CBU retention entry point (used by loans in Phase 11), transfers, withdrawal on termination, member share ledger, ASM function, `canTerminate` rule.
- **Teller integration:** register receipt items `MEMBERSHIP_FEE` and `SHARE_PAYMENT` (with dues = unpaid subscription and unpaid fee) and cash-out `SHARE_WITHDRAWAL` in the Phase 04 registry. All share money goes through the teller; there is no separate payment form.
- **Member water customers:** when a member is TERMINATED, the linked water customer switches to NON_MEMBER (Phase 05 rule).

## Data model
- `share_subscriptions` (member_id, sub_date, shares, par_value, amount, status ACTIVE|CANCELLED, je_id)
- `share_transactions` (member_id, txn_date, type `SUBSCRIBE|PAYMENT|CBU_RETENTION|TRANSFER_IN|TRANSFER_OUT|WITHDRAWAL|ISC_CAPITALIZED|PR_CAPITALIZED|ADJUSTMENT`, amount, ref_no, bir_receipt_no?, je_id, remarks)
- `member_fees` (member_id, fee_type MEMBERSHIP, amount, paid_at, je_id)
- View `v_member_share_balance` (subscribed, paid_up, unpaid_subscription)
- Function `averageShareMonth(memberId, year)`, computed from transactions per DOMAIN `share.asm_basis`

## Business rules
- Posting per DOMAIN §6 (subscription, payment, membership fee). Every txn has a `je_id`.
- A payment can't exceed the unpaid subscription when `share.auto_subscribe_excess` is false.
- **Holding cap:** after the payment, the member's paid-up ÷ total coop paid-up must be ≤ `share.max_holding_pct`. Otherwise the payment is rejected.
- A member is in **good standing** when paid-up ≥ `share.min_paid_up_regular` and the membership fee is paid. Expose `isGoodStanding(memberId)` for Phase 10.
- **Transfer:** both members ACTIVE, BOD resolution ref required, amount ≤ the transferor's paid-up. GL nets to zero while the member subledgers move.
- **Withdrawal:** only for members being TERMINATED. Pays out paid-up minus obligations. The Phase 11 loan offset is added later via a hook.
- Register `canTerminate` rule: "share capital must be fully withdrawn/settled".
- `CBU_RETENTION` is a service function `retainCbu(tx, memberId, amount, source)` that credits paid-up. The Phase 11 loan release calls it.

## Screens
Member profile tab **Share Capital** (subscriptions, ledger with running paid-up balance, ASM for a selected year) · Subscribe form · Transfer form (payments and fees are collected at the teller).

## Tasks
- **T8.1** Schema, migrations, view, mappings check.
- **T8.2** Share service: subscribe, pay, fee, transfer, withdraw, `retainCbu`, `isGoodStanding`, `averageShareMonth`.
- **T8.3** GL integration via `postJournal` in the same transaction.
- **T8.4** Actions + permissions + audit, the UI tab and forms, and the teller registrations (`MEMBERSHIP_FEE`, `SHARE_PAYMENT`, `SHARE_WITHDRAWAL`).
- **T8.5** Member share ledger report (per member, date range) + Excel export.

## Acceptance tests (golden; par ₱100, fee ₱500, cap 10%)
| ID | Given / When | Then |
|---|---|---|
| A8.1 | M-000001 subscribes 100 shares | subscribed ₱10,000.00, paid-up ₱0.00; GL Dr Subscription Receivable 10,000.00 / Cr Subscribed Share Capital 10,000.00 (member-tagged) |
| A8.2 | Pays ₱2,500.00 | paid-up ₱2,500.00, unpaid ₱7,500.00; GL Dr Cash 2,500.00 / Cr Subscription Receivable 2,500.00 |
| A8.3 | Pays ₱8,000.00 (unpaid is ₱7,500.00) | rejected "Payment exceeds unpaid subscription (₱7,500.00)" |
| A8.4 | Membership fee ₱500.00 | GL Dr Cash 500.00 / Cr Membership Fee Income 500.00; `isGoodStanding` = true (paid-up 2,500 ≥ 2,500) |
| A8.5 | ASM 2026: A has ₱12,000.00 paid-up all year; B has ₱6,000.00 Jan–Jun and ₱12,000.00 Jul–Dec | ASM A = ₱12,000.00; ASM B = ₱9,000.00 |
| A8.6 | Coop total paid-up ₱100,000.00, of which member C holds ₱9,000.00; C pays ₱2,000.00 | rejected: 11,000 / 102,000 = 10.78% > 10% |
| A8.7 | Transfer ₱1,000.00 paid-up A → B with BOD ref | A −1,000.00, B +1,000.00; TB control totals unchanged; subsidiary ledgers updated |
| A8.8 | Transfer without BOD ref, or to an APPLICANT | rejected |
| A8.9 | Member share ledger for A | running balance equals the GL subsidiary balance for A at every row |
| A8.10 | E2E: subscribe → pay at the teller → ledger shows paid-up | pass |

## Exit checks
`npm run gate` · `npm run build` · `npm run e2e -- phase-08` · TB balances after the fixture.

## /goal
```
/goal Complete Phase 08 exactly as specified in docs/phases/PHASE-08-share-capital.md, following CLAUDE.md. Done = all Phase 08 tasks ticked in PROGRESS.md, Phase 08 summary written, status 🟡, and npm run gate passes.
```
