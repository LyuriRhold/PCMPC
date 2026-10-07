# Phase 04 — Cashiering Core (Teller) & Daily Cash Position

**Goal:** one counter for all money coming in and going out. Tellers open sessions and issue **one receipt covering many items**. Item types are pluggable: water (05–07), share capital (08), savings (09), loans (11) and store AR (13) each register their own. Tellers also release cash, process disbursement vouchers, count cash at closing, and give the manager a daily cash position that matches the GL.
**Depends on:** 02, 03.
**Inputs from PCMPC:** receipt layout, BIR-registered receipt/invoice series in use, cash short/over policy, DV approval limits, denominations used.

## Scope
- **In:** teller sessions, receipt + cash-out **registry**, built-in items (`OTHER_INCOME`, cash-outs `DV` and `BANK_DEPOSIT`), payor lookup (members + walk-in; later phases register more payor types), receipts, cancellation, DVs, bank deposits, cash count, verification, daily cash position.
- **Out:** module-specific items. Each later phase registers its own receipt items, cash-outs and "dues" provider.

## Registry (`src/modules/cashiering/registry.ts`)
```ts
registerReceiptItem({
  type: "WATER_BILL",                 // unique code
  label, permission,                  // who may collect it
  dues(tx, payor) => Due[],           // what the payor owes now (shown in the teller cart)
  validate(tx, input) => void,        // throws on invalid input
  apply(tx, input, ctx) => { creditLines: JournalLine[], effects }, // subledger effects in the same tx
  reverse(tx, itemId, ctx) => { debitLines: JournalLine[] }          // used on cancellation
})
registerCashOut({ type, label, permission, apply, reverse })
registerPayorType({ type: "MEMBER" | "WATER_CUSTOMER" | ..., search, display })
```
Built-ins in this phase: receipt item `OTHER_INCOME` (staff picks from an allowed list of income accounts, e.g., certification fee, hall rental), cash-outs `DV` and `BANK_DEPOSIT`, payor types `MEMBER` and `WALK_IN`.

## Data model
- `teller_sessions` (teller_id, business_date, opening_cash, status OPEN|CLOSED|VERIFIED, expected_cash, counted_cash, variance, verified_by)
- `receipts` (receipt_no `AR-…`, bir_receipt_no, session_id, payor_type, payor_id?, payor_name, receipt_date, total, mode CASH|CHECK|BANK_TRANSFER, check_no?, status VALID|CANCELLED, je_id, cancel_reason, cancelled_by)
- `receipt_items` (receipt_id, type, ref_id, amount, breakdown jsonb)
- `cash_outs` (session_id, type, ref_id, amount, je_id)
- `disbursement_vouchers` (dv_no, payee, particulars, amount, lines (account, debit), mode CASH|CHECK, check_no?, status DRAFT|APPROVED|RELEASED|CANCELLED, prepared_by, approved_by, released_by, je_id)
- `cash_counts` (session_id, denomination, qty). Denominations: 1000, 500, 200, 100, 50, 20 bills; 20, 10, 5, 1, 0.25, 0.05, 0.01 coins (CONFIRM).

## Business rules
- A teller needs an OPEN session for today's business date to receive or pay cash. One open session per teller.
- **One receipt → one CRJ entry.** Dr Cash (total) plus the credit lines returned by each item's `apply`, all in the **same transaction**. If any item fails, nothing posts and the receipt number is not consumed.
- The system receipt number is gapless. `bir_receipt_no` is required while `cash.require_bir_receipt_no` = true (default true; see PLAN R1).
- **Cancellation:** same business date only, by a supervisor (`cash.cancel`, ≠ the teller). It calls each item's `reverse` and posts a reversal JE. The number stays used, with status CANCELLED.
- **Close session:** requires a cash count. Expected = opening + cash receipts − cash outs. Variance = counted − expected. **Verify** (manager) posts any variance to Cash Short/Over per policy. A closed session takes no new transactions.
- **DV:** preparer ≠ approver. Release creates a CDJ entry and, for cash, a cash_out in the releasing teller's session.
- **Bank deposit:** Dr Cash in Bank / Cr Cash on Hand.
- **Daily cash position** = beginning cash + receipts by type − cash-outs by type = ending. It must equal the GL `cash_on_hand` balance for the date.

## Tasks
- **T4.1** Schema + migrations.
- **T4.2** Registry (receipt items, cash-outs, payor types) + built-ins (`OTHER_INCOME`, `DV`, `BANK_DEPOSIT`, `MEMBER`, `WALK_IN`).
- **T4.3** Session service (open, close with count, verify with variance posting).
- **T4.4** Receipt service orchestrating registered items in one transaction, plus cancellation via `reverse`.
- **T4.5** DV workflow + bank deposit.
- **T4.6** Teller UI: payor search (all registered payor types) → cart of dues from registered providers + manual items → acknowledgement slip print (with the BIR receipt no.). Cash count screen. Manager verification screen.
- **T4.7** Daily cash position report + Excel export.

## Acceptance tests (golden)
| ID | Given / When | Then |
|---|---|---|
| A4.1 | Teller without an open session issues a receipt | rejected "Open a teller session first" |
| A4.2 | One receipt with `OTHER_INCOME` items: certification fee ₱50.00 + hall rental ₱1,500.00 | receipt `AR-2026-000001`, total ₱1,550.00; exactly ONE CRJ entry: Dr Cash 1,550.00 / Cr Certification Fee Income 50.00 / Cr Rental Income 1,500.00 |
| A4.3 | Receipt containing a test-only item type whose `apply` throws (registered in the test file, not in `src/`) | whole receipt rejected; no JE; next valid receipt still gets `AR-2026-000001` |
| A4.4 | Supervisor cancels A4.2 the same day | reversal JE; A4.2 status CANCELLED; next receipt gets `AR-2026-000002` |
| A4.5 | Teller cancels own receipt / supervisor cancels a receipt from yesterday | Forbidden / rejected |
| A4.6 | Opening ₱5,000.00; receipts ₱4,416.80; DV cash release ₱1,000.00; counted ₱8,400.00 | expected ₱8,416.80; variance −₱16.80 (short); after verify → Dr Cash Short/Over 16.80 / Cr Cash 16.80 |
| A4.7 | Receipt after the session is CLOSED | rejected |
| A4.8 | DV prepared and approved by the same user | Forbidden; approved by the manager → released → CDJ entry |
| A4.9 | `cash.require_bir_receipt_no` = true and no BIR receipt no. | rejected |
| A4.10 | Daily cash position for the fixture day | ending cash = GL Cash on Hand balance as of that date |
| A4.11 | E2E: open session → multi-item receipt → close with count → manager verifies | pass |

## Exit checks
`npm run gate` · `npm run build` · `npm run e2e -- phase-04`.

## /goal
```
/goal Complete Phase 04 exactly as specified in docs/phases/PHASE-04-cashiering.md, following CLAUDE.md. Done = all Phase 04 tasks ticked in PROGRESS.md, Phase 04 summary written, status 🟡, and npm run gate passes.
```
