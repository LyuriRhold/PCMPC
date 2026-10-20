# PCMPC MIS — Cut-over runbook

How PCMPC moves from its old records (Excel / old system) to the MIS: what is frozen, who does what, in which order, how the figures are proven, and who signs off. The tool is **Admin › Data migration** (Phase 17). Only balances and schedules are migrated, as of a **cut-off date**; transaction history stays in the old records and the archive.

> **Rule of the cut-over:** the MIS opens with **one opening entry** dated the cut-off, built from the **audited (or Board-approved) trial balance**. Every control account must equal its subsidiary records **to the centavo** before posting is allowed. After posting, the months up to the cut-off are closed, and corrections go through the regular screens.

## 1. Owners

| Role | Person | Owns |
|---|---|---|
| Project lead | Rhold (IT) | The plan, the timeline, rehearsals, backups, users and access |
| General Manager | GM | Approves the cut-off date and the freeze; **posts the opening balances** (`migration.post`); signs off |
| Bookkeeper | Bookkeeper / accountant | The cut-off trial balance; the share capital, savings, time deposit, store and supplier files; staging and reconciliation (`migration.import`) |
| Water billing clerk | Billing staff | Water customers and accounts, last readings, consumption, unpaid bills, deposits |
| Loan officer | Credit staff | Active loans: terms, installments paid, outstanding principal, unpaid penalties |
| Store clerk | Store staff | The stock count at the cut-off (quantities and unit costs) |
| Teller | Cashier | The cash count at the cut-off |
| Audit Committee | Chair (or external auditor) | Observes the counts; attests the trial balance and the reconciliation; signs off |

## 2. Choosing the cut-off

- **A month end**, already over (the MIS refuses anything else), e.g. cut-off **Sep 30**. Go-live is the day the opening balances are posted. Aim for 1–2 working days after the cut-off; a weekend helps.
- **Prefer a quarter end** (Mar 31, Jun 30, Sep 30, Dec 31). The old system credits savings interest for the quarter, and the MIS starts the next quarter cleanly. With another month end, the first quarter's interest in the MIS counts only the days from the cut-off.
- **At a fiscal year end** (Dec 31), the trial balance must be the **post-closing** one (revenues and expenses closed into Undivided Net Surplus); the MIS blocks a pre-closing one. The fiscal year is then closed in the MIS.
- **Water:** the old system bills the cut-off month as usual. Those bills are migrated as unpaid. The first MIS billing period is the month after the cut-off.

## 3. Timeline

| When | Step | Owner |
|---|---|---|
| T−30 days | Agree on the cut-off date and the freeze; announce the go-live to members and staff | GM |
| T−30 | Set up in the MIS: users and roles, coop settings, chart of accounts (if PCMPC's own), **water zones and routes** (Water › Zones & routes; e.g. Pipindan Munti 1, Pipindan Munti 2, Mariwasa, Sampaguita, Everlasting, Pag-asa, Purok Siete), loan and savings products, tariffs | Project lead, Bookkeeper |
| T−30 | Download the 11 templates (Admin › Data migration); read each "Read me" sheet | Everyone filling a file |
| T−21 | **Rehearsal 1** on a copy (staging or a local database): fill the files from the latest month end, upload, fix every problem, stage, reconcile. Don't post on the live database | Bookkeeper, Project lead |
| T−7 | **Rehearsal 2** from the previous month end, posting on the copy; spot-check the result (section 7) | Bookkeeper, GM |
| T−1 | Remind members: last payments in the old system on the cut-off day | GM |
| **T0 (cut-off day)** | Close the day in the old system; cash count; meter readings / last bills; stock count; print the cut-off reports (section 5) | Teller, Billing clerk, Store clerk, Bookkeeper |
| T+1 to T+2 | Fill and upload the files from the cut-off reports; stage; reconcile; Audit Committee reviews. The counter takes payments on **pre-numbered manual receipts** (no withdrawals or loan releases) | Bookkeeper, Billing clerk, Loan officer, Store clerk, Teller |
| T+2 (go-live) | **Backup**, then the GM **posts the opening balances**; spot checks; sign-off. From then on every transaction is in the MIS; the manual receipts are encoded the same day, with their numbers in the remarks | Project lead, GM, Audit Committee, Teller |
| T+5 | Old system read-only; archive its files and the migration files with the sign-off | Project lead |

> The members, accounts and loans exist in the MIS only once the opening balances are posted, so member transactions wait for the posting (hence the manual receipts in between). Nothing may be posted on or before the cut-off date in the MIS: the opening entry must be the first.

## 4. The freeze

From the close of the cut-off day until the opening balances are posted (go-live):

- **No back-dated transactions** in the old system (nothing dated on or before the cut-off after its reports are printed).
- **No changes** to members, accounts, products or tariffs in the old system.
- Cash counted, deposited or locked; the count sheet signed by the teller and the Audit Committee observer.
- Store: no sales during the count; the count sheet signed by the store clerk and the observer.
- Water: the cut-off month's bills printed; the last actual reading per meter recorded.

## 5. Cut-off reports (from the old system / books)

| Report | Feeds |
|---|---|
| Trial balance as of the cut-off (audited or Board-approved) | Trial balance file |
| Member masterlist (active and inactive, approved) | Members file |
| Share capital per member (subscribed, paid-up) | Share capital file |
| Savings balances per account (with the quarter's interest credited) | Savings file |
| Time deposits outstanding (principal, rate, term, placement) | Time deposits file |
| Loan ledger per loan (original terms, installments paid, outstanding principal, unpaid penalties) | Loans file |
| Water customer list, accounts, meters, last actual reading, last 3 months' consumption, deposits held, advances | Water accounts file |
| Unpaid water bills per account (period, bill/due dates, unpaid amount, whether the penalty was charged) | Unpaid water bills file |
| Stock count at cost | Store stock file |
| Accounts payable per supplier | Supplier balances file |
| Members' unpaid store charges | Store charges file |

Each subsidiary report's total must equal its control account in the trial balance. Settle any difference in the old books **before** filling the files.

## 6. Importing (Admin › Data migration)

1. **Upload the files in this order**:
   1. Members (the other files refer to the members);
   2. Share capital, Savings, Time deposits (after Savings), Loans;
   3. Water accounts, then Unpaid water bills;
   4. Store stock, Supplier balances, Store charges;
   5. **the Trial balance last**.
2. **Each upload is a dry run.** Every row is checked: required fields, dates (YYYY-MM-DD), amounts, members and products that exist, duplicates, numbers already in use, the loan schedule's balance, the trial balance totals. Nothing is written to the live tables. The problems are listed by **row, column and message**, and can be downloaded as an Excel list. Fix the file and upload it again; the earlier unstaged upload is replaced.
3. **Stage** each clean file. Staging checks the file again, against the files staged before it.
4. **Reconciliation:** for every control account (savings, time deposits, share capital, subscription receivable, loans per product, members' store charges, water receivables, customers' deposits and advances, accounts payable, merchandise inventory), the trial balance and the total of the staged records, and their difference. Posting is blocked until:
   - the trial balance is staged and balances;
   - no file is left unstaged;
   - **every difference is ₱0.00**;
   - the ledger has no entry dated on or before the cut-off.
5. **Roll back** any unposted file to start it over. Files others refer to are rolled back after them (the members last). The same file can't be uploaded twice while its earlier upload is still open.
6. **Backup**, then the **General Manager posts** the opening balances. In one transaction, the MIS:
   - posts the opening entry (journal GJ, dated the cut-off, source "migration"), with the control accounts split by member, water customer and supplier;
   - creates the members (with their old numbers), share capital, savings passbooks (an *Opening balance* line), time deposits, loans (the schedule rebuilt, installments paid marked, arrears with their due dates), water customers, accounts, meters (the last reading becomes the previous reading of the first period), unpaid bills, store items and stock, suppliers, and charge limits;
   - continues the number series after the migrated numbers;
   - closes the months up to the cut-off;
   - marks the files **Posted**.
   This can't be undone.

## 7. After posting: proof and spot checks

| Check | Where | Expected |
|---|---|---|
| Trial balance as of the cut-off | Accounting › Trial balance | Equals the cut-off trial balance, line by line |
| Control accounts vs subsidiaries | Reports › Management dashboard (reconciliation) | All differences ₱0.00 |
| Member statements | Reports › Member statements: 10% of members, and every member with a loan in arrears | Share capital, savings, time deposits, loans and store charges as in the old records; reconciliation ₱0.00 |
| Loans | Loans: every loan in arrears | Days past due and the next installment as in the old ledger |
| Water | Water: 10 accounts per zone | Last reading, deposit, unpaid bills, total due |
| Store | Store › Inventory valuation | Equals Merchandise Inventory; quantities as counted |
| Suppliers | Store › Accounts payable | Each supplier's balance |
| Numbers | Add a test member/account in a copy | New numbers continue after the migrated ones |

Any difference found after posting is corrected through the regular screens, with a reason and an approval:
- a journal voucher for the GL;
- a memo for water bills;
- the module's own correction for everything else.

## 8. Fallback

- **Before posting:** roll back the files; nothing in the live tables has changed.
- **After posting:** the opening entry and records are final (audited). If the posting was wrong as a whole, restore the backup taken just before posting and redo the import. Any transaction entered after that backup must then be re-entered: take the backup, post, and verify on the same day.

## 9. Sign-off

| Item | Done (date) | Signed |
|---|---|---|
| Cut-off date and freeze approved | | General Manager |
| Cash count at the cut-off | | Teller · Audit Committee observer |
| Stock count at the cut-off | | Store clerk · Audit Committee observer |
| Cut-off trial balance (audited / Board-approved) | | Bookkeeper · Audit Committee |
| Reconciliation: every control account ₱0.00 difference | | Bookkeeper |
| Backup taken before posting | | Project lead |
| Opening balances posted (opening entry no. ________) | | General Manager |
| Spot checks (section 7) passed | | Bookkeeper · Audit Committee |
| Go-live accepted | | General Manager · Board Chair |

Keep the signed sheet, the uploaded files and the cut-off reports together in the archive.

## 10. Demo and rehearsal data

`npm run db:seed:demo` (local databases only) does the following on a fresh database (`npm run db:reset && npm run db:migrate && npm run db:seed && npm run db:seed:demo`):
- adds Pipindan's puroks as water zones (one reading route each);
- writes 11 filled sample files to `demo/migration/`;
- runs them through the import, posting a made-up but consistent set of records as of the last month end: 40 members, loans in arrears, 43 water connections with unpaid bills, store stock and a trial balance that ties out.

`npm run db:seed:demo -- --files-only` writes the files only, to upload them by hand on Admin › Data migration (a hands-on rehearsal). Add `-- --cutoff=YYYY-MM-DD` to pick another month end.

## Appendix A. Templates (columns in order)

Each template's data sheet has these headers in this order (row 1); its "Read me" sheet repeats them with examples. Dates are YYYY-MM-DD; amounts are plain numbers in pesos with up to 2 decimals.

### A.1 Members (`migration-members.xlsx`, sheet "Members")

The member masterlist: one row per approved member. Members keep their old member numbers.

| # | Column | Required | What to enter |
|---|---|---|---|
| 1 | Member No. | Yes | The member's number in the old records; kept as is. Unique. |
| 2 | Type | Yes | Regular or associate member. One of: REGULAR, ASSOCIATE. |
| 3 | Status | Yes | Members who left (terminated, deceased) are not migrated. One of: ACTIVE, INACTIVE. |
| 4 | Last Name | Yes | — |
| 5 | First Name | Yes | — |
| 6 | Middle Name | No | — |
| 7 | Suffix | No | Jr., Sr., III |
| 8 | Birthdate | Yes | YYYY-MM-DD |
| 9 | Sex | Yes | One of: MALE, FEMALE. |
| 10 | Civil Status | Yes | One of: SINGLE, MARRIED, WIDOWED, SEPARATED, ANNULLED. |
| 11 | House No. / Street | No | — |
| 12 | Purok / Sitio | No | The purok, e.g. Pipindan Munti 1, Mariwasa, Sampaguita. |
| 13 | Barangay | Yes | — |
| 14 | Municipality | Yes | — |
| 15 | Province | Yes | — |
| 16 | Mobile | No | 11 digits, e.g. 09171234567 |
| 17 | Email | No | — |
| 18 | Occupation | No | — |
| 19 | TIN | No | — |
| 20 | Membership Date | Yes | When the Board approved the membership (YYYY-MM-DD), on or before the cut-off. |
| 21 | PMES Date | No | YYYY-MM-DD |
| 22 | BOD Resolution No. | No | — |
| 23 | Membership Fee Paid | No | The membership fee paid, in pesos. Blank or 0 = not paid yet. |

### A.2 Share capital (`migration-share-capital.xlsx`, sheet "Share capital")

Each member's subscribed and paid-up share capital as of the cut-off. The unpaid part is the subscription receivable.

| # | Column | Required | What to enter |
|---|---|---|---|
| 1 | Member No. | Yes | The member's number in the old records. It must be in the Members file (or already in the MIS). |
| 2 | Subscribed | Yes | Total subscribed, in pesos: a whole number of shares at the par value. |
| 3 | Paid-up | Yes | Total paid-up, in pesos: not more than the subscribed amount. |

### A.3 Savings (`migration-savings.xlsx`, sheet "Savings")

Savings accounts and their balances as of the cut-off (interest up to the cut-off included).

| # | Column | Required | What to enter |
|---|---|---|---|
| 1 | Member No. | Yes | The member's number in the old records. It must be in the Members file (or already in the MIS). |
| 2 | Account No. | No | The passbook no. in the old records. Blank = the MIS gives a new number. |
| 3 | Product Code | Yes | The savings product in the MIS (Savings › Products), e.g. SAV. |
| 4 | Opened On | Yes | YYYY-MM-DD |
| 5 | Balance | Yes | Balance at the cut-off, in pesos. |
| 6 | Last Transaction Date | No | The member's last deposit or withdrawal (for dormancy). Blank = the cut-off. |

### A.4 Time deposits (`migration-time-deposits.xlsx`, sheet "Time deposits")

Time deposits still running at the cut-off. Interest is paid at maturity for the whole term.

| # | Column | Required | What to enter |
|---|---|---|---|
| 1 | Member No. | Yes | The member's number in the old records. It must be in the Members file (or already in the MIS). |
| 2 | Certificate No. | No | Blank = the MIS gives a new number. |
| 3 | Principal | Yes | In pesos. |
| 4 | Rate p.a. (%) | Yes | Interest rate per year, in percent. |
| 5 | Term (days) | Yes | — |
| 6 | Placement Date | Yes | YYYY-MM-DD |
| 7 | Maturity Date | No | Blank = placement date + term. If entered, it must equal placement date + term. |
| 8 | Savings Account No. | No | The member's savings account that receives the proceeds. Blank = their savings account. |

### A.5 Loans (`migration-loans.xlsx`, sheet "Loans")

Loans still unpaid at the cut-off. The schedule is rebuilt from the original terms; the first installments are marked paid; installments due and unpaid at the cut-off stay as arrears with their due dates.

| # | Column | Required | What to enter |
|---|---|---|---|
| 1 | Member No. | Yes | The member's number in the old records. It must be in the Members file (or already in the MIS). |
| 2 | Loan No. | No | Blank = the MIS gives a new number. |
| 3 | Product Code | Yes | The loan product in the MIS (REG, EMR, PRD). |
| 4 | Principal | Yes | The amount originally released, in pesos. |
| 5 | Term (months) | Yes | — |
| 6 | Rate per Month (%) | No | Blank = the product's rate. |
| 7 | Release Date | Yes | YYYY-MM-DD |
| 8 | First Due Date | Yes | Due date of installment 1 (YYYY-MM-DD). |
| 9 | Installments Paid | Yes | How many installments are fully paid. |
| 10 | Outstanding Principal | Yes | Principal still unpaid at the cut-off. It must equal the schedule's balance after the installments paid, less any part of the next installment's principal already paid. |
| 11 | Unpaid Penalty | No | Penalties charged and unpaid at the cut-off. Penalties after the cut-off are charged by the MIS. |

### A.6 Water accounts (`migration-water-accounts.xlsx`, sheet "Water accounts")

Water customers, their service connections and meters. The last actual reading becomes the previous reading of the first billing period in the MIS.

| # | Column | Required | What to enter |
|---|---|---|---|
| 1 | Account No. | Yes | The service account no. in the old records. Unique. |
| 2 | Customer No. | No | Rows with the same customer no. are one customer with several connections. Blank = the MIS gives a new number. |
| 3 | Member No. | No | For a member customer: the member no. (name fields can stay blank). |
| 4 | Last Name | No | For a non-member: last and first name, or the business name. |
| 5 | First Name | No | — |
| 6 | Middle Name | No | — |
| 7 | Business Name | No | — |
| 8 | Customer Address | Yes | — |
| 9 | Mobile | No | — |
| 10 | Classification | Yes | One of: RESIDENTIAL, COMMERCIAL, INSTITUTIONAL, BULK. |
| 11 | Zone Code | Yes | The zone (purok) in the MIS (Water › Zones & routes). |
| 12 | Route Code | Yes | The reading route in that zone. |
| 13 | Sequence | No | The meter's place in the reading route. Blank = after the others. |
| 14 | Service Address | Yes | — |
| 15 | Status | Yes | One of: ACTIVE, DISCONNECTED. |
| 16 | Connected On | Yes | YYYY-MM-DD |
| 17 | Meter Serial No. | Yes | Unique. |
| 18 | Meter Digits | No | Digits on the meter dial (3–9). Blank = 4, or more if the last reading needs it. |
| 19 | Last Reading | Yes | The last actual reading in the old system (m³). |
| 20 | Consumption 1 Month Ago | No | m³ billed for the month of the cut-off (for the high-consumption check). |
| 21 | Consumption 2 Months Ago | No | m³ billed the month before. |
| 22 | Consumption 3 Months Ago | No | m³ billed the month before that. |
| 23 | Meter Deposit | No | The refundable meter deposit held, in pesos. |
| 24 | Advance Payment | No | Payments received ahead of billing, in pesos (applied to the next bills). |

### A.7 Unpaid water bills (`migration-water-bills.xlsx`, sheet "Unpaid water bills")

Every water bill still unpaid (or partly paid) at the cut-off, so aging, penalties and disconnection work on day one.

| # | Column | Required | What to enter |
|---|---|---|---|
| 1 | Account No. | Yes | The service account (in the Water accounts file or already in the MIS). |
| 2 | Bill No. | No | Blank = the MIS gives a new number. |
| 3 | Period | Yes | The billing month (YYYY-MM), on or before the cut-off month. |
| 4 | Bill Date | Yes | YYYY-MM-DD |
| 5 | Due Date | Yes | YYYY-MM-DD |
| 6 | Consumption | No | m³ billed (for the statement). |
| 7 | Amount Unpaid | Yes | What is still unpaid on the bill, including any penalty already charged, in pesos. |
| 8 | Penalty Assessed | Yes | YES if the old system already charged the late-payment penalty on this bill (the MIS won't charge it again). One of: YES, NO. |

### A.8 Store stock (`migration-store-stock.xlsx`, sheet "Store stock")

The store's stock count at the cut-off, at cost. Items not yet in the MIS are created.

| # | Column | Required | What to enter |
|---|---|---|---|
| 1 | SKU | Yes | The item code. Unique. |
| 2 | Barcode | No | — |
| 3 | Name | Yes | — |
| 4 | Unit | Yes | — |
| 5 | Category | No | — |
| 6 | Selling Price | Yes | In pesos. |
| 7 | Unit Cost | Yes | Average cost per unit, in pesos (up to 4 decimals). |
| 8 | Quantity | Yes | Counted on hand. |
| 9 | Reorder Level | No | — |

### A.9 Supplier balances (`migration-suppliers.xlsx`, sheet "Supplier balances")

Store suppliers and what the coop owes each one (accounts payable – trade) at the cut-off.

| # | Column | Required | What to enter |
|---|---|---|---|
| 1 | Supplier Name | Yes | Unique. |
| 2 | Contact | No | — |
| 3 | TIN | No | — |
| 4 | Terms (days) | No | Credit terms. Blank = 0 (cash). |
| 5 | Balance | Yes | Amount owed at the cut-off, in pesos (0 for a supplier with nothing owed). |

### A.10 Store charges (`migration-store-ar.xlsx`, sheet "Store charges")

What members owe the store for goods charged to their account, at the cut-off.

| # | Column | Required | What to enter |
|---|---|---|---|
| 1 | Member No. | Yes | The member's number in the old records. It must be in the Members file (or already in the MIS). |
| 2 | Balance | Yes | Unpaid charges, in pesos. |
| 3 | Charge Limit | No | The member's charge limit. Blank = the default limit. |

### A.11 Trial balance (`migration-trial-balance.xlsx`, sheet "Trial balance")

The audited (or Board-approved) trial balance as of the cut-off. It becomes the opening entry; every control account must equal its subsidiary records to the centavo.

| # | Column | Required | What to enter |
|---|---|---|---|
| 1 | Account Code | Yes | The account code in the MIS chart of accounts (Accounting › Chart of accounts). One row per account. |
| 2 | Account Name | No | For reading only. |
| 3 | Debit | No | In pesos. Enter either a debit or a credit. |
| 4 | Credit | No | In pesos. |

