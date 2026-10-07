# Phase 05 — Water: Customers, Service Connections, Meters & Rates

**Goal:** register water customers, both **members and non-members**. Take each new connection from application to an active service account with an installed meter. Manage zones/routes, meters, NWRB-approved rate schedules and fees, and collect connection fees and meter deposits at the teller.
**Depends on:** 02, 03, 04.
**Inputs from PCMPC:**
- existing connections (customer, address, meter no., classification, zone/purok)
- service zones and reading routes
- the **NWRB-approved tariff** (classes, minimum charge, blocks)
- fees: connection/installation, meter deposit, reconnection, transfer
- connection requirements
- meter types (number of digits)

## Scope
- **In:**
  - water customers (MEMBER linked to `members`, or NON_MEMBER)
  - connection applications, service accounts, zones/routes with reading sequence
  - meter inventory, installation/replacement history
  - versioned rate schedules + **pure rate engine**, fee schedule
  - teller items `WATER_CONNECTION_FEE`, `METER_DEPOSIT` and `WATER_OTHER_FEE`; payor type `WATER_CUSTOMER`
  - senior-citizen discount eligibility records, account transfers, privacy masking
- **Out:** readings and billing (Phase 06), bill collection/penalties/disconnection (Phase 07).

## Data model
- `water_customers` (customer_no, type MEMBER|NON_MEMBER, member_id?, last/first/middle name or business name, address, mobile, email?, valid_id_type/no, privacy_consent_at, remarks)
- `water_zones` (code, name: purok/sitio/barangay), `water_routes` (zone_id, code, assigned_reader_id?)
- `water_accounts` (account_no, customer_id, classification RESIDENTIAL|COMMERCIAL|INSTITUTIONAL|BULK, route_id, sequence_no, service_address, status PENDING|ACTIVE|DISCONNECTED|CLOSED, connected_at, closed_at, deposit_amount)
- `water_applications` (app_no, customer_id, classification, service_address, route_id, status APPLIED|INSPECTED|APPROVED|INSTALLED|REJECTED, inspection_notes, encoded_by, approved_by)
- `water_meters` (serial_no, brand, size, digits, status IN_STOCK|INSTALLED|DEFECTIVE|RETIRED)
- `water_meter_installations` (account_id, meter_id, installed_at, initial_reading, removed_at?, final_reading?, reason)
- `water_rate_schedules` (classification, effective_from, min_charge, min_cubic, blocks jsonb `[{from,to,rate}]`, nwrb_ref, approved_at). Versioned: never edited once used by a posted bill.
- `water_fees` (code, name, amount, gl mapping key)
- `water_senior_eligibility` (account_id, senior_name, osca_id_no, valid_from, valid_until)
- `water_account_history` (account_id, event, from, to, ref, at, by)
- `journal_lines.customer_id` (nullable) for the AR–Water and Customers' Deposits subsidiary ledgers. Record the decision in PROGRESS.

## Business rules
- **Numbering:** customer `WC-{000000}`, account `WA-{000000}`, application `WAPP-{YYYY}-{00000}` (CONFIRM).
- **Member customers** link to `members.id`; name and address default from the member. Each member has at most one customer record, but a customer may have many accounts (connections). When a member is TERMINATED, the customer type changes to NON_MEMBER (history kept, CONFIRM).
- **Workflow:** APPLIED → INSPECTED → APPROVED (`water.approve`, ≠ encoder) → fees paid at the teller → INSTALLED (meter + initial reading) → account ACTIVE. An account can't be ACTIVE without an installed meter that has an initial reading.
- A meter can be installed at only one account at a time. **Replacement** records the old meter's final reading and the new meter's initial reading (Phase 06 uses both for consumption).
- **Rate engine** `computeWaterCharge(classification, m3, periodEnd)`. It picks the schedule version effective on `periodEnd`. The minimum charge covers the first `min_cubic` m³; each block above is charged per m³ at its rate. It returns itemized lines + total (centavos).
- **GL:** connection fee → Dr Cash / Cr Water Connection Fee Income. Meter deposit → Dr Cash / Cr Customers' Deposits (liability, customer-tagged, refundable on closure net of unpaid bills).
- **Senior discount eligibility** (RA 9994: 5% if the meter is in the senior's name, the senior resides there, and consumption ≤ 30 m³/month; renewed yearly) is RESIDENTIAL only and has a validity date. Phase 06 applies it. Whether RA 9994 covers a coop water system is CONFIRM.
- Sensitive fields are masked as in Phase 02.

## Tasks
- **T5.1** Schema + migrations (incl. `journal_lines.customer_id`) + seeds: zones, sample rate schedules, fees (all CONFIRM).
- **T5.2** Customer service (member link / non-member, duplicates, masking) + payor type `WATER_CUSTOMER` for the teller.
- **T5.3** Application → approval → installation → activation workflow + account status history + ownership transfer.
- **T5.4** Meter inventory, installation and replacement service.
- **T5.5** Versioned rate schedules + pure rate engine (exhaustive unit tests) + fee schedule.
- **T5.6** Teller receipt items `WATER_CONNECTION_FEE`, `METER_DEPOSIT`, `WATER_OTHER_FEE` registered in the Phase 04 registry.
- **T5.7** Senior-citizen eligibility records.
- **T5.8** UI: customers list/search, application queue, account profile (meter, history, deposit), zones/routes with drag-to-reorder reading sequence, rate schedule admin, meter inventory.

## Acceptance tests (golden; sample tariff, all CONFIRM)
RESIDENTIAL: minimum ₱200.00 for the first 10 m³; 11–20 m³ ₱25.00/m³; 21–30 m³ ₱30.00/m³; 31+ m³ ₱35.00/m³.
COMMERCIAL: minimum ₱400.00 for the first 10 m³; 11+ m³ ₱40.00/m³.

| ID | Given / When | Then |
|---|---|---|
| A5.1 | Create NON_MEMBER customer "Maria Santos" | customer_no `WC-000001`, type NON_MEMBER, member_id null |
| A5.2 | Create a MEMBER customer from M-000001, then again for M-000001 | first OK (name/address copied); second rejected "Customer already exists for M-000001" |
| A5.3 | Application encoded by `clerk1`, approved by `clerk1` | Forbidden (SoD); approved by `mgr1` → APPROVED |
| A5.4 | Activate the account without a meter / install meter SN-1001 with initial reading 0 | rejected / account ACTIVE |
| A5.5 | Install SN-1001 on a second account while still installed | rejected |
| A5.6 | RESIDENTIAL charge for 0, 7, 10, 18, 35 m³ | ₱200.00, ₱200.00, ₱200.00, ₱400.00, ₱925.00 |
| A5.7 | COMMERCIAL 15 m³ | ₱600.00 |
| A5.8 | New RESIDENTIAL version effective 2027-01-01 with 11–20 m³ at ₱28.00; 18 m³ for period end 2026-12-31 vs 2027-01-31 | ₱400.00 vs ₱424.00 |
| A5.9 | One teller receipt: connection fee ₱3,500.00 + meter deposit ₱1,000.00 for WC-000001 | one CRJ: Dr Cash 4,500.00 / Cr Water Connection Fee Income 3,500.00 / Cr Customers' Deposits 1,000.00 (tagged WC-000001) |
| A5.10 | Replace the meter: old final reading 1,250, new meter SN-2002 initial 0 | both installations recorded; account stays ACTIVE; SN-1001 status DEFECTIVE or RETIRED (as chosen) |
| A5.11 | Senior eligibility on a COMMERCIAL account / on a residential account with valid_until in the past | rejected / not eligible on the billing date |
| A5.12 | E2E: non-member applies → approve → pay fees at the teller → install meter → account ACTIVE in the route list | pass |

## Exit checks
`npm run gate` · `npm run build` · `npm run e2e -- phase-05`.

## /goal
```
/goal Complete Phase 05 exactly as specified in docs/phases/PHASE-05-water-connections.md, following CLAUDE.md. Done = all Phase 05 tasks ticked in PROGRESS.md, Phase 05 summary written, status 🟡, and npm run gate passes.
```
