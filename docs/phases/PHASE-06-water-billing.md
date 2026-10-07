# Phase 06 — Water: Meter Reading & Billing

**Goal:** run each monthly billing cycle end to end:
1. Open the period per zone.
2. Print or load reading sheets per route.
3. Capture readings in the office or on a phone in the field (works offline).
4. Validate and approve flagged readings.
5. Compute consumption, including rollover, meter change and estimates.
6. Bill with tiered rates and discounts.
7. Print bills and post billing to the GL.

Each billing run is idempotent.
**Depends on:** 05.
**Inputs from PCMPC:** billing cycle and reading schedule per zone, bill layout and paper size, due-date rule, high/low consumption thresholds, estimation policy, senior-discount applicability.

## Scope
- **In:** `job_runs` + `runOnce` helper (used by all later jobs), billing periods, reading capture (office grid, printable sheets, mobile PWA with offline queue), validation flags and approval, consumption engine, estimated readings + reconciliation, billing engine, billing run + GL, bill printing, credit/debit memos, final bill on closure, applying customer advance credits.
- **Out:** payments, penalties, disconnection, water reports (Phase 07).

## Data model
- `job_runs` (job, key, run_at, by, result jsonb), unique (job, key). Helper `runOnce(job, key, fn)`.
- `water_billing_periods` (period `YYYY-MM`, zone_id, reading_from, reading_to, bill_date, due_date, status OPEN|READING|REVIEW|BILLED|CLOSED)
- `water_readings` (period_id, account_id, meter_id, previous_reading, present_reading, consumption, type ACTUAL|ESTIMATED|METER_CHANGE|FINAL, rollover bool, flags[] LOWER|HIGH|LOW|ZERO, status ENTERED|APPROVED|REJECTED, reader_id, read_at, client_uuid unique, photo_url?, remarks, approved_by)
- `water_bills` (bill_no, account_id, period_id, customer_type snapshot MEMBER|NON_MEMBER, classification, consumption, basic_charge, senior_discount, other_charges, advance_applied, current_amount, previous_balance (memo), total_amount_due, due_date, status UNPAID|PARTIAL|PAID|CANCELLED, je_id)
- `water_bill_lines` (bill_id, kind MIN_CHARGE|BLOCK|SENIOR_DISCOUNT|OTHER_FEE|ADVANCE_APPLIED|ADJUSTMENT, description, qty, rate, amount)
- `water_bill_adjustments` (bill_id, kind CREDIT|DEBIT, amount, reason, prepared_by, approved_by, je_id)

## Business rules
- **Consumption:**
  - Normal reading: present − previous.
  - Present < previous: if the reader marks a **rollover**, consumption = 10^digits − previous + present. Otherwise the reading is rejected for re-check.
  - **Meter change** within the period: (old final − previous) + (new present − new initial).
- **Flags:**
  - HIGH: consumption > `water.high_factor` (2.0) × the average of the last 3 actual months, and > 10 m³.
  - ZERO / LOW: per settings.
  - Flagged readings need approval (`water.review_readings`) before billing.
- **Estimated reading** (meter inaccessible): consumption = round(average of the last 3 actual months), type ESTIMATED. At the next actual reading: consumption = present − last actual reading − estimated m³ already billed since then.
- **Billing:**
  - Basic charge comes from the Phase 05 rate engine, using the schedule effective on `reading_to`.
  - **Senior discount** = 5% of the basic charge when eligible on the bill date and consumption ≤ 30 m³ (CONFIRM).
  - Customer advance credits are applied automatically.
  - Unpaid balances appear as **previous balance** (memo only, never re-posted).
- A billing run is per (period, zone) via `runOnce("water-billing", "{period}:{zone}")`. It is blocked until every ACTIVE account in the zone has an APPROVED reading (or an approved exclusion with a reason). DISCONNECTED and CLOSED accounts are not billed.
- **GL, one JE per billing run:**
  - Dr AR–Water (customer-tagged, net of discount)
  - Dr Senior Citizen Discounts
  - Cr Water Revenue–Members / Cr Water Revenue–Non-members, split by the bill's `customer_type` snapshot. Non-member revenue is kept separate for tax and CDA reporting (CONFIRM with the bookkeeper).
  - Advance applied: Dr Customers' Advances / Cr AR–Water.
- Bills are never edited after posting. Corrections use approved **credit/debit memos** (preparer ≠ approver).
- **Bill numbers:** `WB-{YYYYMM}-{000000}`.
- **Mobile reading (PWA):**
  - Route list in sequence order, showing the previous reading and 3-month average, with a large numeric keypad and instant flag warnings.
  - Readings are saved to IndexedDB while offline and synced when the signal returns.
  - The server dedupes by `client_uuid` and by (period, account).
  - METER_READER users see only their assigned routes.
- **Printing:** reading sheets per route (for paper-based reading), and bills batch-printed per route in sequence order (PDF). Each bill shows previous/present reading, consumption, charges breakdown, previous balance, total due, due date and a 6-month consumption history.

## Tasks
- **T6.1** `job_runs` + `runOnce`; schema + migrations for periods, readings, bills, lines, adjustments.
- **T6.2** Consumption engine (pure): normal, rollover, meter change, estimate + reconciliation, flags. Exhaustive tests.
- **T6.3** Period management + office reading-entry grid by route (keyboard-fast) + flag review/approval queue.
- **T6.4** Mobile reading PWA: assigned routes, offline queue (IndexedDB), sync endpoint (idempotent).
- **T6.5** Billing engine + billing run (preview → post) + GL posting + bill numbering + advance application.
- **T6.6** PDF printing: reading sheets and bills (batch per route).
- **T6.7** Credit/debit memos with SoD.
- **T6.8** Final reading + final bill on account closure (deposit refund handled in Phase 07).

## Acceptance tests (golden; RESIDENTIAL sample tariff from Phase 05)
| ID | Given / When | Then |
|---|---|---|
| A6.1 | Previous 1,250, present 1,268 | consumption 18 m³; basic charge ₱400.00 |
| A6.2 | 4-digit meter, previous 9,990, present 12, rollover marked | consumption 22 m³; charge ₱510.00 |
| A6.3 | Previous 1,250, present 1,240, no rollover | rejected "Reading is lower than previous (1,250)" |
| A6.4 | Meter change: previous 1,250, old final 1,262, new initial 0, new present 9 | consumption 21 m³; charge ₱480.00 |
| A6.5 | Last 3 actual months 12, 15, 18 (avg 15); this month 40 m³ | flagged HIGH; the billing run is blocked until approved |
| A6.6 | Inaccessible meter, last 3 actual months 12, 15, 18; next month actual present 1,290 after last actual 1,250 | estimated month: 15 m³ → ₱325.00; next month: 1,290 − 1,250 − 15 = 25 m³ → ₱600.00 |
| A6.7 | Eligible senior residential: 18 m³ / 35 m³ | basic ₱400.00, discount ₱20.00, current ₱380.00 / ₱925.00 with no discount |
| A6.8 | Billing run zone Z1, period 2026-10: member 18 m³; non-member 35 m³; eligible senior member 18 m³ | ONE JE: Dr AR–Water 1,705.00, Dr Senior Citizen Discounts 20.00 / Cr Water Revenue–Members 800.00, Cr Water Revenue–Non-members 925.00 |
| A6.9 | Run Z1 2026-10 again / run with one ACTIVE account unread | rejected "already billed" / blocked, listing the unread account |
| A6.10 | Account with an unpaid 2026-09 bill of ₱400.00 gets its 2026-10 bill of ₱400.00 | total amount due ₱800.00; GL AR increases by ₱400.00 only |
| A6.11 | Offline sync sends the same reading twice (same client_uuid) | stored once |
| A6.12 | Credit memo ₱50.00 approved by its preparer / by the manager | Forbidden / AR–Water −₱50.00 with a matching revenue adjustment |
| A6.13 | E2E: open period → print route sheet → encode readings → approve flags → billing run → bill PDF for 18 m³ shows ₱400.00 | pass |

## Exit checks
`npm run gate` · `npm run build` · `npm run e2e -- phase-06` · test the PWA offline on a real phone (airplane mode → read → reconnect → synced) and note the result in the summary.

## /goal
```
/goal Complete Phase 06 exactly as specified in docs/phases/PHASE-06-water-billing.md, following CLAUDE.md. Done = all Phase 06 tasks ticked in PROGRESS.md, Phase 06 summary written, status 🟡, and npm run gate passes.
```
