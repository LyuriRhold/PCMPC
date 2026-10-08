/**
 * DEV ONLY: sample postings for the sample members (scripts/fixtures/dev-members.ts), so the
 * ledger screens and the trial balance have data. Amounts are pesos; member = index into the
 * approved sample members.
 */
export type DevLine = { key: string; debit?: number; credit?: number; member?: number };
export type DevEntry = { book: "CRJ" | "CDJ" | "GJ"; particulars: string; lines: DevLine[] };

export const DEV_ENTRIES: DevEntry[] = [
  {
    book: "CRJ",
    particulars: "Membership fees (sample)",
    lines: [
      { key: "cash_on_hand", debit: 2000 },
      { key: "membership_fee_income", credit: 2000 },
    ],
  },
  {
    book: "CRJ",
    particulars: "Share capital payments (sample)",
    lines: [
      { key: "cash_on_hand", debit: 12500 },
      { key: "subscribed_share_capital_common", credit: 5000, member: 0 },
      { key: "subscribed_share_capital_common", credit: 5000, member: 1 },
      { key: "subscribed_share_capital_common", credit: 2500, member: 2 },
    ],
  },
  {
    book: "CRJ",
    particulars: "Savings deposits (sample)",
    lines: [
      { key: "cash_on_hand", debit: 3500 },
      { key: "savings_deposits", credit: 2000, member: 0 },
      { key: "savings_deposits", credit: 1500, member: 3 },
    ],
  },
  {
    book: "CDJ",
    particulars: "Loan release (sample)",
    lines: [
      { key: "loans_receivable_REG", debit: 10000, member: 2 },
      { key: "cash_on_hand", credit: 10000 },
    ],
  },
  {
    book: "CRJ",
    particulars: "Loan interest collected (sample)",
    lines: [
      { key: "cash_on_hand", debit: 150 },
      { key: "interest_income_loans", credit: 150 },
    ],
  },
];
