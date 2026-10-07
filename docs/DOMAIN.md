# DOMAIN.md — Cooperative rules, glossary & configurable defaults

> This is the source of truth for business rules. Every value marked **CONFIRM** is a working default. Seed it into settings and log it in `PROGRESS.md › Questions` until PCMPC confirms it. Only humans edit this file.

## 1. Glossary
| Term | Meaning |
|---|---|
| **PMES** | Pre-Membership Education Seminar. It is required before membership approval |
| **Regular member** | Full member with voting rights. Must meet the minimum subscribed and paid-up share capital |
| **Associate member** | Non-voting member (per by-laws) |
| **Share capital, subscribed** | Shares the member committed to buy (shares × par value) |
| **Share capital, paid-up** | The part of the subscription actually paid |
| **CBU** | Capital Build-Up. Regular additions to share capital, including retentions deducted on loan release |
| **ASM** | Average Share Month. Average monthly paid-up balance for the year, used to compute ISC |
| **ISC** | Interest on Share Capital. Year-end return on paid-up capital, based on ASM |
| **PR** | Patronage Refund. Year-end refund based on member patronage (loan interest paid + store purchases, etc.) |
| **Net surplus** | Excess of revenues over expenses for the year (the coop's "net income") |
| **Statutory funds** | Reserve Fund, Education & Training Fund (ETF), Community Development Fund (CDF), Optional Fund |
| **CETF** | Cooperative Education and Training Fund. The 50% of ETF remitted to the federation/union |
| **PAR** | Portfolio at Risk. Outstanding balance of loans with arrears > N days ÷ total loan portfolio |
| **Water customer** | Holder of one or more water service connections. Either a MEMBER (linked to the member record) or a NON_MEMBER |
| **Service account / connection** | One metered water connection at one service address, with a classification (residential, commercial, …) and a place in a reading route |
| **Zone / route / sequence** | Service area (purok/sitio) → reader's route → order in which meters are read |
| **Billing period** | Monthly cycle per zone: reading dates, bill date, due date |
| **Minimum charge** | Fixed charge covering the first N m³ (e.g., 10 m³) |
| **Block rate** | Price per m³ for consumption within a block (11–20, 21–30, …) |
| **Rollover** | Meter passing its maximum (e.g., 9999 → 0000) |
| **Estimated reading** | Consumption billed from the recent average when the meter can't be read; reconciled at the next actual reading |
| **NRW** | Non-revenue water: water produced but not billed (leaks, illegal connections, meter errors) |
| **NWRB / CPC** | National Water Resources Board / Certificate of Public Convenience. A coop water system needs a CPC, and its tariff is NWRB-approved |
| **Comaker** | Co-signer member who guarantees a loan |
| **LPP** | Loan Protection Plan (insurance) deducted on release |
| **CAPR** | Cooperative Annual Progress Report, submitted to CDA with its attachments |
| **SCA / PFRF** | CDA Standard Chart of Accounts / Philippine Financial Reporting Framework for Cooperatives |
| **CRJ / CDJ / GJ / SJ / PJ** | Cash Receipts, Cash Disbursements, General, Sales, Purchases journals |
| **JV / DV / OR** | Journal Voucher / Disbursement Voucher / Official Receipt (or BIR-registered invoice) |

## 2. Configurable defaults (seed → `settings` tables)
| Key | Default | Status | Notes |
|---|---|---|---|
| `coop.name` | Pipindan Community Multi-Purpose Cooperative | fixed | short: PCMPC |
| `coop.address` | Pipindan, Binangonan, Rizal | CONFIRM | full address |
| `coop.cda_reg_no`, `coop.tin` | (blank) | CONFIRM | |
| `fiscal.year_start_month` | 1 (January) | CONFIRM | |
| `tz.business` | Asia/Manila | fixed | |
| `member.no_format` | `M-{000000}` | CONFIRM | assigned on approval |
| `member.fee` | ₱500.00 | CONFIRM | membership fee, non-refundable income |
| `share.par_value` | ₱100.00 | CONFIRM | |
| `share.min_subscription_shares` | 100 (₱10,000) | CONFIRM | |
| `share.min_paid_up_regular` | ₱2,500.00 | CONFIRM | to be a regular member in good standing |
| `share.max_holding_pct` | 10% of total paid-up | CONFIRM | RA 9520 limit on a member's share holding |
| `share.auto_subscribe_excess` | false | CONFIRM | payment above unpaid subscription is rejected |
| `share.asm_basis` | month-end balance | CONFIRM | Σ 12 month-end paid-up ÷ 12 |
| `savings.regular.rate_pa` | 2.00% | CONFIRM | |
| `savings.interest_basis` | average daily balance, actual/365 | CONFIRM | |
| `savings.crediting` | quarterly (Mar/Jun/Sep/Dec end) | CONFIRM | |
| `savings.min_balance_earn` | ₱500.00 ADB | CONFIRM | below this → no interest |
| `savings.maintaining_balance` | ₱100.00 | CONFIRM | can't withdraw below |
| `savings.dormant_after_months` | 24 | CONFIRM | |
| `savings.wtax_rate` | 0% | CONFIRM | withholding tax on deposit interest (ask bookkeeper/BIR) |
| `td.pretermination_rate` | regular savings rate for days held | CONFIRM | |
| `loan.interest_recognition` | on collection | CONFIRM | alternative: monthly accrual |
| `loan.payment_allocation` | penalty → interest → principal, oldest installment first | CONFIRM | |
| `loan.excess_payment` | advance to next installments (interest then principal), schedule unchanged | CONFIRM | |
| `loan.penalty_rate_pm` | 2% per month on overdue amortization, simple, prorated by days/30 | CONFIRM | |
| `loan.grace_days` | 3 | CONFIRM | |
| `loan.par_threshold_days` | 30 | CONFIRM | |
| `loan.manager_approval_limit` | ₱30,000.00 | CONFIRM | above → Credit Committee |
| `loan.block_if_past_due` | true | CONFIRM | borrower and comaker |
| `loan.aging_buckets` | Current, 1–30, 31–90, 91–180, 181–365, >365 | CONFIRM | |
| `loan.allowance_rates` | per bucket, set by bookkeeper | CONFIRM | per CDA/auditor guidance |
| `water.customer_no_format` / `water.account_no_format` | `WC-{000000}` / `WA-{000000}` | CONFIRM | |
| `water.billing_cycle` | monthly, per zone | CONFIRM | |
| `water.due_days` | bill date + 15 days | CONFIRM | |
| `water.tariff.RESIDENTIAL` | min ₱200.00 for 10 m³; 11–20 ₱25.00; 21–30 ₱30.00; 31+ ₱35.00 per m³ | CONFIRM | must equal the NWRB-approved tariff |
| `water.tariff.COMMERCIAL` | min ₱400.00 for 10 m³; 11+ ₱40.00 per m³ | CONFIRM | |
| `water.member_rate_difference` | none (same tariff for members and non-members) | CONFIRM | |
| `water.fee.connection` | ₱3,500.00 | CONFIRM | installation/connection fee |
| `water.fee.meter_deposit` | ₱1,000.00 | CONFIRM | refundable, net of unpaid bills |
| `water.fee.reconnection` | ₱300.00 | CONFIRM | |
| `water.penalty_pct` | 10% of the unpaid current bill, once per bill, day after due | CONFIRM | |
| `water.disconnect_after_bills` | 2 unpaid bills | CONFIRM | |
| `water.notice_days` | 7 days | CONFIRM | check NWRB/local rules |
| `water.high_factor` | 2.0 × 3-month average (and > 10 m³) | CONFIRM | flags reading for review |
| `water.estimate_basis` | average of last 3 actual months | CONFIRM | |
| `water.senior_discount` | 5% of basic charge if eligible and ≤ 30 m³ (RA 9994) | CONFIRM | confirm it applies to the coop's water system |
| `water.overpayment` | advance credit, applied on next bill | CONFIRM | |
| `water.bill_disconnected_accounts` | false | CONFIRM | |
| `store.cost_method` | moving average | fixed | |
| `store.allow_negative_stock` | false | fixed | |
| `store.member_credit_limit` | ₱1,000.00 | CONFIRM | or % of paid-up share capital |
| `surplus.reserve_pct` | 10% | CONFIRM | must be ≥ 10% |
| `surplus.etf_pct` | 10% | CONFIRM | must be ≤ 10%; 50% local ETF, 50% CETF to federation/union |
| `surplus.cdf_pct` | 3% | CONFIRM | must be ≥ 3% |
| `surplus.optional_pct` | 7% | CONFIRM | must be ≤ 7% |
| `surplus.isc_share_of_remaining` | 70% | CONFIRM | GA-approved |
| `surplus.pr_share_of_remaining` | 30% | CONFIRM | must be ≥ 30% (CDA guidance) |
| `surplus.pr_basis` | loan interest paid + net store purchases (+ water bills paid by members?) | CONFIRM | non-members never get PR |
| `surplus.offset_arrears_first` | true | CONFIRM | |
| `surplus.isc_pr_wtax_rate` | 0% | CONFIRM | ask bookkeeper/BIR |
| `cash.short_over_policy` | post to Cash Short/Over after manager verification | CONFIRM | |

### Sample loan products (all CONFIRM, replace with the PCMPC loan policy)
| Code | Name | Method | Rate | Term | Max | Deductions |
|---|---|---|---|---|---|---|
| REG | Regular Loan | Diminishing, equal amortization | 1.5%/mo | 6–24 mo | 3× paid-up share capital | Service fee 2%, CBU 2%, notarial ₱100 |
| EMR | Emergency Loan | Add-on (flat) | 1.5%/mo | 1–6 mo | ₱10,000 | Service fee 1% |
| PRD | Productive/Livelihood | Diminishing, equal principal | 1%/mo | 6–12 mo | ₱50,000 | Service fee 2%, CBU 2% |

## 3. Rounding & day count
- Amounts are bigint centavos. Rates are decimal strings (decimal.js).
- Water charges are whole-m³ × centavo rates, so no rounding is needed except for discounts and penalties (HALF-UP per bill).
- Round **HALF-UP to the centavo** at exactly these points: each schedule row's interest; each schedule amortization; each penalty computation; each savings interest credit per account; each per-member ISC/PR amount; each COGS line.
- **Last installment absorbs the residue** so that the schedule's principal sums exactly to the loan principal.
- **Pool splits** (ISC, PR, or any allocation) use `money.allocate()`: largest-remainder method, so that the parts always sum to the pool exactly.
- Moving-average unit cost is stored with 4 decimals. When stock reaches 0, COGS = the remaining inventory value (no leftover centavos).
- Day count is actual/365. A loan month = 1 calendar month. `addMonths` clamps to month end (Jan 31 + 1 mo = Feb 28/29).

## 4. Lifecycles
- **Member:** APPLICANT → ACTIVE → (INACTIVE ↔ ACTIVE) → TERMINATED / DECEASED. Termination requires no active loans and settlement of share capital and savings.
- **Loan application:** DRAFT → SUBMITTED → RECOMMENDED → APPROVED → RELEASED. REJECTED and CANCELLED are terminal.
- **Loan:** ACTIVE → PAID, or ACTIVE → PAST_DUE → (ACTIVE | RESTRUCTURED | WRITTEN_OFF).
- **Journal entry:** DRAFT → POSTED → REVERSED. Module postings go straight to POSTED. Manual JVs need approval (SoD).
- **Period:** OPEN → CLOSED. Reopening needs ADMIN, a reason, and creates an audit entry.
- **Teller session:** OPEN → CLOSED (cash counted) → VERIFIED (manager).
- **Water application:** APPLIED → INSPECTED → APPROVED → INSTALLED (REJECTED is terminal).
- **Water account:** PENDING → ACTIVE ↔ DISCONNECTED → CLOSED.
- **Water billing period:** OPEN → READING → REVIEW → BILLED → CLOSED.
- **Water bill:** UNPAID → PARTIAL → PAID (CANCELLED only via approved memo).

## 5. Document numbering (gapless per series, reset yearly, CONFIRM formats)
| Series | Format | Example |
|---|---|---|
| Member | `M-{000000}` | M-000001 (never resets) |
| Receipt (system) | `AR-{YYYY}-{000000}` | AR-2026-000001 (acknowledgement; the BIR receipt no. is stored alongside) |
| JV / CRJ / CDJ / SJ / PJ | `{BOOK}-{YYYY}-{00000}` | GJ-2026-00001 |
| DV | `DV-{YYYY}-{00000}` | |
| Loan application / Loan | `LA-{YYYY}-{00000}` / `LN-{YYYY}-{00000}` | |
| Water customer / account | `WC-{000000}` / `WA-{000000}` | WC-000001 (never resets) |
| Water application | `WAPP-{YYYY}-{00000}` | |
| Water bill | `WB-{YYYYMM}-{000000}` | WB-202610-000001 |
| Disconnection notice | `DN-{YYYY}-{00000}` | |
| Deposit account | `SA-{000000}` / `TD-{000000}` | |
| PO / RR / Sale | `PO-…`, `RR-…`, `S-{YYYY}-{000000}` | |

## 6. GL posting matrix (mapping keys → `account_mappings`; actual account codes come from the PCMPC COA)
| Event | Debit | Credit |
|---|---|---|
| Water connection fee | `cash_on_hand` | `water_connection_fee_income` |
| Meter deposit | `cash_on_hand` | `customers_deposits` (customer-tagged) |
| Water billing run | `ar_water` (customer-tagged), `senior_citizen_discounts` | `water_revenue_members`, `water_revenue_nonmembers` |
| Water advance applied | `customers_advances` | `ar_water` |
| Water bill payment | `cash_on_hand` | `ar_water` (overpayment → `customers_advances`) |
| Water late penalty | `ar_water` | `penalty_income_water` |
| Water credit memo | `water_revenue_adjustments` | `ar_water` |
| Deposit refund on closure | `customers_deposits` | `ar_water` (offset), `cash_on_hand` (via DV) |
| Membership fee | `cash_on_hand` | `membership_fee_income` |
| Share subscription | `subscription_receivable_common` | `subscribed_share_capital_common` |
| Share payment | `cash_on_hand` | `subscription_receivable_common` |
| Share transfer A→B | `subscribed_share_capital_common` (A) | `subscribed_share_capital_common` (B) (member subledger moves) |
| Savings deposit / withdrawal | `cash_on_hand` / `savings_deposits` | `savings_deposits` / `cash_on_hand` |
| Savings interest | `interest_expense_deposits` | `savings_deposits` (+ `withholding_tax_payable` if any) |
| TD placement | `cash_on_hand` | `time_deposits` |
| Loan release | `loans_receivable_{product}` (principal) | `cash_on_hand` (net), `service_fee_income`, `subscription_receivable_common` (CBU), `lpp_insurance_payable`, `notarial_fee_income` |
| Loan payment | `cash_on_hand` | `fines_penalties_income`, `interest_income_loans`, `loans_receivable_{product}` |
| Loan write-off | `allowance_probable_losses` | `loans_receivable_{product}` |
| Purchase on account | `merchandise_inventory` | `accounts_payable_trade` |
| Supplier payment | `accounts_payable_trade` | `cash_on_hand` / `cash_in_bank` |
| Cash sale | `cash_on_hand`; `cost_of_sales` | `sales`; `merchandise_inventory` |
| Charge sale | `accounts_receivable_members`; `cost_of_sales` | `sales`; `merchandise_inventory` |
| Sales return (cash) | `sales_returns`; `merchandise_inventory` | `cash_on_hand`; `cost_of_sales` |
| Inventory shortage | `inventory_losses` | `merchandise_inventory` |
| Cash short / over | `cash_short_over` | `cash_on_hand` (short) |
| Depreciation | `depreciation_expense` | `accumulated_depreciation_{class}` |
| Year-end close | revenues | expenses, `undivided_net_surplus` |
| Surplus allocation | `undivided_net_surplus` | `reserve_fund`, `cetf_payable`, `education_training_fund`, `community_development_fund`, `optional_fund`, `isc_payable`, `patronage_refund_payable` |
| ISC/PR distribution | `isc_payable`, `patronage_refund_payable` | `savings_deposits` / `subscription_receivable_common` / `cash_on_hand` / `loans_receivable_*` (offset) |

> Share capital presentation (subscribed less subscription receivable = paid-up) is **CONFIRM** with the bookkeeper/auditor against the current SCA.
