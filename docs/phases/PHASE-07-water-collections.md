# Phase 07 — Water: Collections, Penalties, Disconnection & Water Reports

**Goal:** collect water bills at the teller with correct allocation, assess late-payment penalties automatically, run the disconnection and reconnection cycle, keep customer ledgers/SOA, refund deposits on closure, and report on water operations. This phase completes the water billing system.
**Depends on:** 06.
**Inputs from PCMPC:** penalty policy, disconnection policy (number of unpaid bills, notice period), reconnection fee, overpayment policy, NWRB/local rules on disconnection notices, report formats used today.

## Scope
- **In:**
  - teller receipt item `WATER_BILL`, payment allocation, advance credits
  - daily cron runner `/api/cron/daily` (used by all later phases)
  - penalty job; disconnection list, notices, disconnection/reconnection orders, reconnection fee
  - customer ledger/SOA; deposit refund on closure (net of unpaid bills)
  - water reports + dashboard tiles; optional production-meter readings for non-revenue water (NRW)
- **Out:** online payments (GCash/Maya → Backlog), SMS bill reminders (Backlog).

## Data model
- `water_payment_allocations` (receipt_item_id, bill_id, penalty_part, bill_part)
- `water_penalties` (bill_id, assessed_on, amount, je_id), unique (bill_id)
- `water_customer_advances` (customer_id, amount, source receipt, applied_bill_id?)
- `water_disconnections` (account_id, notice_no, notice_date, scheduled_date, disconnected_at, disconnect_reading, reconnected_at, reconnect_reading, status NOTICED|DISCONNECTED|RECONNECTED|CANCELLED, by)
- `water_production_readings` (source/meter, reading_date, reading), optional for NRW

## Business rules
- **`WATER_BILL` receipt item:**
  - Dues = all unpaid bills + penalties for the account.
  - Allocation: oldest bill first; within a bill, penalty first, then the bill amount.
  - Overpayment becomes an **advance credit** (Cr Customers' Advances), auto-applied on the next billing run (Phase 06 hook).
  - GL: Dr Cash / Cr AR–Water (customer-tagged).
- **Penalty:** if a bill is not fully paid by its due date, penalty = `water.penalty_pct` (10%, CONFIRM) × the unpaid current amount of that bill. It is assessed **once per bill** by the daily job on the day after the due date: Dr AR–Water / Cr Penalty Income–Water. Idempotent.
- **Daily cron:** `/api/cron/daily` checks `CRON_SECRET`, computes the Manila business date, and runs each registered job via `runOnce(job, businessDate)`. Phase 09 and 11 register their jobs here too.
- **Disconnection:**
  - Accounts with ≥ `water.disconnect_after_bills` (2, CONFIRM) unpaid bills go on the disconnection list.
  - A printed notice gives `water.notice_days` (7, CONFIRM) days.
  - After that, a field order records the disconnection with a reading → DISCONNECTED. DISCONNECTED accounts are not billed.
- **Reconnection:** requires all arrears + penalties + the reconnection fee (₱300.00, CONFIRM; receipt item `WATER_OTHER_FEE`) to be paid. Then a reconnection order with a reading → ACTIVE.
- **Closure:** final bill (Phase 06) → settle → refund the meter deposit net of unpaid amounts (Dr Customers' Deposits / Cr AR–Water for the offset / Cr Cash via DV for the rest).
- **Customer SOA** (bills, payments, penalties, memos, running balance) must equal the GL AR–Water subsidiary for that customer.
- **AR aging buckets:** current, 1–30, 31–60, 61–90, >90 days past due.
- **Collection efficiency (month)** = collected on bills due in the month ÷ billed amount due in the month.

## Reports (Excel + print)
Billing summary (period × zone × class × member/non-member) · Daily collection report per teller · AR–Water aging · Disconnection list & notices · Reconnection log · Consumption by zone/route · Top consumers · Zero-consumption and estimated accounts · Member vs non-member water revenue · Senior discount report · NRW % (production − billed) when production readings exist · Customer SOA.
Dashboard tiles: billed this month, collected, collection efficiency, accounts for disconnection, NRW %.

## Tasks
- **T7.1** Schema + migrations.
- **T7.2** `WATER_BILL` receipt item (dues, allocation, advances, reverse on cancellation).
- **T7.3** Daily cron runner + penalty job.
- **T7.4** Disconnection list, notices, disconnect/reconnect orders, reconnection fee rule.
- **T7.5** Account closure settlement + deposit refund.
- **T7.6** Customer ledger/SOA.
- **T7.7** Water reports + dashboard tiles + optional production readings/NRW.

## Acceptance tests (golden; bills from the Phase 06 fixtures, due date 15th of the next month)
| ID | Given / When | Then |
|---|---|---|
| A7.1 | Pay the 2026-10 bill ₱400.00 on 2026-11-10 at the teller | bill PAID; customer AR–Water ₱0.00; CRJ Dr Cash 400.00 / Cr AR–Water 400.00 |
| A7.2 | Bill ₱400.00 due 2026-11-15 unpaid; daily job for 2026-11-16, run twice | one penalty ₱40.00 (Dr AR–Water / Cr Penalty Income–Water) |
| A7.3 | Pay ₱300.00 on that bill (₱40.00 penalty + ₱400.00) | penalty 40.00, bill 260.00; bill PARTIAL with ₱180.00 left |
| A7.4 | Customer owes Sept ₱400.00 + penalty ₱40.00 and Oct ₱400.00; pays ₱500.00 | Sept penalty 40.00, Sept bill 400.00, Oct 60.00; Oct PARTIAL with ₱340.00 left |
| A7.5 | Pay ₱500.00 on a single ₱400.00 bill, then the next billing run | advance credit ₱100.00; the next bill shows advance applied ₱100.00 (Dr Customers' Advances / Cr AR–Water) |
| A7.6 | Account with 2 unpaid bills / with 1 unpaid bill | on the disconnection list / not on it |
| A7.7 | Reconnect before paying arrears / after paying arrears + penalty + ₱300.00 fee | rejected / reconnection order allowed → ACTIVE |
| A7.8 | Next billing run with a DISCONNECTED account | no bill for that account |
| A7.9 | Aging as of 2026-12-31: unpaid bills due 2026-12-15, 2026-11-15, 2026-09-15 (₱400.00 each) | 1–30: ₱400.00 (16 days); 31–60: ₱400.00 (46 days); >90: ₱400.00 (107 days) |
| A7.10 | Customer SOA ending balance | equals the GL AR–Water subsidiary balance for the customer |
| A7.11 | Billing summary 2026-10 on the A6.8 fixture | members ₱800.00; non-members ₱925.00; senior discount ₱20.00; net billed ₱1,705.00 |
| A7.12 | Billed due in Nov ₱1,705.00; collected on those bills ₱1,305.00 | collection efficiency 76.54% |
| A7.13 | Close an account with a ₱1,000.00 deposit and ₱400.00 unpaid | ₱400.00 offset against AR; ₱600.00 refunded via DV |
| A7.14 | E2E: teller → search water customer → pay bill → slip printed → account balance ₱0.00 | pass |

## Exit checks
`npm run gate` · `npm run build` · `npm run e2e -- phase-07` · one full simulated cycle on seed data (connect → read → bill → pay/penalty → disconnect → reconnect) noted in the summary.
> **Milestone:** after this phase the water billing system is complete and can be piloted early. See PLAN §6 for the pilot path.

## /goal
```
/goal Complete Phase 07 exactly as specified in docs/phases/PHASE-07-water-collections.md, following CLAUDE.md. Done = all Phase 07 tasks ticked in PROGRESS.md, Phase 07 summary written, status 🟡, and npm run gate passes.
```
