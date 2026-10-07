# Phase 12 — Store: Inventory & Purchasing

**Goal:** the consumer store's item master, suppliers, purchasing and receiving, a moving-average stock ledger, physical counts with approved adjustments, and supplier payables, all tied to the GL.
**Depends on:** 03, 04 (DV for supplier payment).
**Inputs from PCMPC:** product list (name, unit, price, barcode if any), categories, suppliers, opening stock count.

## Scope
- **In:** categories, products, price history, suppliers, POs, receiving reports (cash or on account), stock ledger, moving average, stock counts and adjustments, AP subledger and supplier payment via DV, reorder list, inventory valuation.
- **Out:** POS selling (Phase 13).

## Data model
- `product_categories`, `products` (sku, barcode?, name, unit, category_id, selling_price, reorder_level, is_active, vat_class CONFIRM)
- `product_price_history` (product_id, price, effective_at, by)
- `suppliers` (name, contact, tin?, terms_days)
- `purchase_orders` + `po_lines` (status DRAFT|APPROVED|PARTIAL|RECEIVED|CANCELLED)
- `receiving_reports` + `rr_lines` (qty, unit_cost), payment CASH|ON_ACCOUNT, je_id
- `stock_moves` (product_id, move_date, type RECEIVE|SALE|RETURN|ADJUST, qty (+/−), unit_cost, total_cost, ref_type, ref_id)
- `stock_balances` (product_id, qty, avg_cost numeric(14,4), value bigint)
- `stock_counts` + `stock_count_lines` (system_qty, counted_qty, variance, status DRAFT|SUBMITTED|APPROVED)
- AP subledger via `journal_lines.supplier_id` (add the column) or `ap_ledger` (decide and record in Decisions)

## Business rules
- **Moving average:** on receipt, new_avg = (old_value + received_cost) ÷ (old_qty + received_qty), stored at 4 decimals. Value is kept in centavos. On issue, COGS = round(qty × avg_cost), **except** when the issue empties the stock: then COGS = the remaining value.
- Negative stock is never allowed.
- A receiving report posts Dr Inventory / Cr Cash or Cr AP–Trade (supplier-tagged).
- A supplier payment via DV posts Dr AP–Trade / Cr Cash/Bank.
- **Stock count:** prepared by STORE_CLERK, approved by MANAGER (≠ preparer). Approval posts the adjustment (loss/gain account per DOMAIN §6).
- Price changes need `store.price` and are kept in history.
- Inventory valuation report total must equal the GL Merchandise Inventory balance.

## Tasks
- **T12.1** Schema + migrations.
- **T12.2** Stock engine (pure: moving average, issue costing) with property tests (value never negative, Σ moves = balance).
- **T12.3** Products, categories, suppliers, price history services + UI.
- **T12.4** PO → RR flow with GL; AP subledger; supplier payment via DV.
- **T12.5** Stock count + approval + adjustment posting.
- **T12.6** Reports: stock card per product, valuation, reorder list, AP aging per supplier.

## Acceptance tests (golden)
| ID | Given / When | Then |
|---|---|---|
| A12.1 | Receive 10 @ ₱50.00, then 10 @ ₱60.00 | qty 20, avg ₱55.0000, value ₱1,100.00 |
| A12.2 | Issue 5 | COGS ₱275.00; remaining 15 @ 55, value ₱825.00 |
| A12.3 | Receive 3 @ ₱10.00, then 4 @ ₱10.01, then issue all 7 | avg 10.0057; COGS on the final issue = ₱70.04 exactly; value 0 |
| A12.4 | Qty 15, issue 16 | rejected "Insufficient stock (15)" |
| A12.5 | RR ₱1,100.00 on account from supplier S1 | GL Dr Merchandise Inventory 1,100.00 / Cr AP–Trade 1,100.00 (S1); AP S1 = ₱1,100.00 |
| A12.6 | Count 13 vs system 15 at avg 55 | variance −2, ₱110.00; no GL until approved; approval by the preparer → Forbidden; approval by the manager → Dr Inventory Losses 110.00 / Cr Inventory 110.00 |
| A12.7 | Valuation report after the fixture | total = GL Merchandise Inventory balance |
| A12.8 | E2E: create product → PO → receive → stock card shows qty & avg | pass |

## Exit checks
`npm run gate` · `npm run build` · `npm run e2e -- phase-12`.

## /goal
```
/goal Complete Phase 12 exactly as specified in docs/phases/PHASE-12-store-inventory.md, following CLAUDE.md. Done = all Phase 12 tasks ticked in PROGRESS.md, Phase 12 summary written, status 🟡, and npm run gate passes.
```
