# Phase 13 — Store: POS, Charge-to-Member & Store Patronage

**Goal:** a fast, keyboard/barcode-first POS for cash and member-charge sales, with returns, voids and shift Z-readings, plus tracking of member purchases for patronage refund.
**Depends on:** 12.
**Inputs from PCMPC:** member pricing/discount policy (if any), member credit limit policy, receipt/slip layout, BIR POS status (PLAN R1).

## Scope
- **In:** POS shifts, sales (cash/charge), member lookup, change computation, returns, voids, Z-reading, member charge accounts and statement, store AR collection through the teller (receipt item `STORE_AR_PAYMENT`), store patronage per member.
- **Out:** offline POS (not possible on Vercel; local-mode fallback is described in PLAN R6), loyalty points, e-wallet payments.

## Data model
- `pos_shifts` (cashier_id, business_date, opening_fund, status OPEN|CLOSED, z_reading jsonb, counted_cash, variance)
- `sales` (sale_no, shift_id, sale_date, member_id?, customer_type MEMBER|NON_MEMBER, payment CASH|CHARGE, subtotal, discount, total, tendered, change, status COMPLETED|VOIDED, je_id, bir_invoice_no?)
- `sale_lines` (sale_id, product_id, qty, unit_price, discount, line_total, unit_cost, cogs)
- `sale_returns` + `sale_return_lines` (original sale ref, qty, refund mode, je_id)
- `member_charge_limits` (member_id, limit) or the setting default

## Business rules
- A sale needs an OPEN shift. One sale → one SJ entry: Dr Cash or Dr AR–Members (member-tagged) / Cr Sales; Dr COGS / Cr Inventory, using the Phase 12 stock engine.
- **Charge:** member only, ACTIVE, and (current AR balance + sale) ≤ credit limit.
- **Void** before completion only: needs a supervisor credential, creates no GL entry, and is audited. Completed sales are corrected with a return.
- **Return:** restock at the original sale's unit_cost. Refund cash or reduce AR. Sales Returns account per DOMAIN §6.
- **Z-reading** at shift close: gross sales, returns, net, cash vs charge, count, variance. Expected cash = opening + cash sales − cash refunds.
- **Store patronage** for member M in year Y = Σ net purchases (cash + charge − returns) where member_id = M. Expose `storePatronage(memberId, year)` for Phase 15.
- The UI works on a tablet: barcode field auto-focused, quantity shortcuts, large buttons.

## Tasks
- **T13.1** Schema + migrations.
- **T13.2** Sale service (cash/charge) with stock + GL in one transaction.
- **T13.3** Returns and voids.
- **T13.4** Shifts + Z-reading + cash count.
- **T13.5** Member charge accounts, statement of account, `STORE_AR_PAYMENT` receipt item in cashiering.
- **T13.6** POS UI (keyboard/barcode-first) and the slip print.
- **T13.7** Store reports: sales by day/product/category, gross margin, top items, slow movers.

## Acceptance tests (golden; product P1 sells at ₱70.00 with avg cost ₱55.00 and stock 15)
| ID | Given / When | Then |
|---|---|---|
| A13.1 | Cash sale 5 × P1, tendered ₱500.00 | total ₱350.00, change ₱150.00; GL Dr Cash 350.00 / Cr Sales 350.00; Dr COGS 275.00 / Cr Inventory 275.00; stock 10 |
| A13.2 | Charge sale ₱350.00 for M-000001 with limit ₱1,000.00 | AR–Members M-000001 = ₱350.00 |
| A13.3 | M-000001 has AR ₱900.00, tries to charge ₱350.00 | rejected "Exceeds credit limit (available ₱100.00)" |
| A13.4 | Non-member charge | rejected |
| A13.5 | Return 1 × P1 from A13.1 (cash refund) | Dr Sales Returns 70.00 / Cr Cash 70.00; Dr Inventory 55.00 / Cr COGS 55.00; stock +1 |
| A13.6 | Z-reading for a shift: opening ₱1,000.00, A13.1, A13.5 | net cash sales ₱280.00; expected cash ₱1,280.00 |
| A13.7 | Member store patronage 2026 after A13.2 + another cash sale ₱140.00 to the same member − a return of ₱70.00 | ₱420.00 |
| A13.8 | Void without supervisor credential | rejected; with it → status VOIDED, no JE |
| A13.9 | Teller receipt `STORE_AR_PAYMENT` ₱350.00 for M-000001 | AR–Members M-000001 = ₱0.00 |
| A13.10 | E2E: scan barcode → qty 5 → pay ₱500 → change ₱150.00 shown | pass |

## Exit checks
`npm run gate` · `npm run build` · `npm run e2e -- phase-13`.

## /goal
```
/goal Complete Phase 13 exactly as specified in docs/phases/PHASE-13-store-pos.md, following CLAUDE.md. Done = all Phase 13 tasks ticked in PROGRESS.md, Phase 13 summary written, status 🟡, and npm run gate passes.
```
