# Phase 16 — Reports: CDA, Management Dashboard & Member Statements

**Goal:** generate CDA annual-report data from the system, give management a live dashboard, and print member statements, using the numbers already in the ledger and subledgers.
**Depends on:** 15.
**Inputs from PCMPC:** the **current** CDA CAPR and annex templates (Excel) saved to `docs/cda-templates/`, officers/committees list, trainings attended.

## Scope
- **In:** governance records (officers, committees, terms, trainings), CDA extracts, management dashboard, operational reports, member SOA, report permissions, report performance.
- **Out:** e-filing to CDA systems (manual upload), BIR forms.

## CDA reports (build against the actual templates; never invent fields)
- CAPR data sheets: membership (by type, sex, new/terminated), capitalization, financial highlights (incl. revenue by business line: water, credit, store), officers & trainings.
- Attachments support: AFS figures (from Phase 14), Social Audit and Performance Audit data, list of officers & trainings, CETF/CDF utilization.
- ATIR/ABR data if PCMPC is tax-exempt (CONFIRM).
- Output: filled **editable .xlsx** copies of the CDA templates plus a cover summary. The CDA deadline is 120 days after FY end (PLAN R2).
- If a template field has no source data in the MIS, list it in an "Unmapped fields" sheet and log it under Questions.

## Data model
- `officers` (member_id, position, committee, term_start, term_end, elected_at_ga)
- `trainings` (title, provider, date, hours, attendees → officers/members)
- `report_runs` (report, params, generated_by, at, file_url?)

## Management & operational reports
- **Dashboard:** water (active connections, billed vs collected this month, collection efficiency, accounts for disconnection, NRW %), active members (by type), new members this month, total paid-up share capital, deposits, loan portfolio, PAR(>30), collection efficiency, store sales and gross margin (MTD/YTD), cash position, alerts (maturing TDs, loans due this week, low stock).
- Loan releases, collections, delinquency (with comakers and contacts), maturity schedule, savings interest, TD maturities, store sales by product/category, gross margin, slow movers, reorder list.
- **Member SOA:** share capital (subscribed/paid-up), savings, loans (balance, arrears), store AR. Printable and exportable.

## Business rules
- **Collection efficiency (month)** = amount collected on dues falling in the month ÷ total amount due in the month.
- All report totals must reconcile to GL control accounts. A reconciliation footer shows any difference.
- BOARD/AUDITOR roles can view reports, with sensitive member fields masked.
- TB/FS/dashboard queries must respond in under 5 s on the performance fixture (Vercel function limits).

## Tasks
- **T16.1** Officers/committees/trainings module.
- **T16.2** CDA template filler (exceljs) with field-mapping config per template + "Unmapped fields" sheet.
- **T16.3** Dashboard (server-rendered KPIs; charts kept simple).
- **T16.4** Operational reports + Excel export.
- **T16.5** Member SOA (print CSS + PDF).
- **T16.6** Performance fixture (50,000 journal lines, 1,000 members) + query tuning/indexes.

## Acceptance tests (golden)
| ID | Given / When | Then |
|---|---|---|
| A16.1 | Dues in the month ₱100,000.00, collected on those dues ₱92,500.00 | collection efficiency 92.50% |
| A16.2 | Members fixture: 3 regular male, 2 regular female, 1 associate female | summary: regular 5 (M3/F2), associate 1 (F1), total 6 |
| A16.3 | SOA for M-000001 | each balance equals the respective GL subsidiary balance |
| A16.4 | Dashboard KPIs on the Phase 14 fixture | loan portfolio ₱80,000.00; deposits ₱51,000.00; paid-up ₱100,000.00 |
| A16.5 | Generate the CAPR workbook | valid .xlsx; contains the CDA reg. no. and reporting year; "Unmapped fields" sheet present (may be empty) |
| A16.6 | BOARD user opens the delinquency report | allowed; mobile numbers masked |
| A16.7 | TB as-of on the performance fixture | < 5 s |
| A16.8 | Dashboard water tiles on the Phase 06/07 fixtures | billed ₱1,705.00; collection efficiency 76.54% (equal to the Phase 07 reports) |

## Exit checks
`npm run gate` · `npm run build` · `npm run e2e -- phase-16`.

## /goal
```
/goal Complete Phase 16 exactly as specified in docs/phases/PHASE-16-reports.md, following CLAUDE.md. Done = all Phase 16 tasks ticked in PROGRESS.md, Phase 16 summary written, status 🟡, and npm run gate passes.
```
