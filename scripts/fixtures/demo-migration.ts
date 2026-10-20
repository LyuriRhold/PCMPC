import { addDays, addMonths, monthEnd, type BusinessDate } from "../../src/lib/dates";
import { schedule, type AmortizationMethod } from "../../src/modules/loans/amortization";
import type { MigrationEntity } from "../../src/modules/migration/schema";
import { costOf } from "../../src/modules/store/stock";

/**
 * DEMO ONLY: a made-up but consistent set of PCMPC records for the data-migration demo (PHASE-17),
 * one file per template, as of a month-end cut-off. Names are invented; the puroks are Barangay
 * Pipindan's. The trial balance is built from the same records, so every control account agrees.
 */

export type Cells = Record<string, string | number | null>;

/** Barangay Pipindan's puroks: each is a water zone with one reading route. */
export const DEMO_PUROKS = [
  { code: "MUNTI-1", name: "Pipindan Munti 1" },
  { code: "MUNTI-2", name: "Pipindan Munti 2" },
  { code: "MARIWASA", name: "Mariwasa" },
  { code: "SAMPAGUITA", name: "Sampaguita" },
  { code: "EVERLASTING", name: "Everlasting" },
  { code: "PAG-ASA", name: "Pag-asa" },
  { code: "PUROK-7", name: "Purok Siete" },
] as const;

const LAST = [
  "Dela Cruz", "Santos", "Reyes", "Cruz", "Bautista", "Ocampo", "Garcia", "Mendoza", "Torres", "Tomas",
  "Andrada", "Castillo", "Flores", "Villanueva", "Ramos", "Castro", "Rivera", "Aquino", "Navarro", "Salazar",
  "Mercado", "Aguilar", "Gonzales", "Lopez", "Pascual", "Valdez", "De Leon", "Manalo", "Domingo", "Soriano",
  "Fernandez", "Javier", "Lim", "Sison", "Robles", "Marquez", "Padilla", "Del Rosario", "Gutierrez", "Panganiban",
];
const MALE = ["Juan", "Jose", "Pedro", "Antonio", "Ramon", "Roberto", "Eduardo", "Ricardo", "Manuel", "Fernando", "Rodrigo", "Arnel", "Rogelio", "Danilo", "Ernesto", "Romeo", "Mark", "John Paul", "Christian", "Jerome"];
const FEMALE = ["Maria", "Ana", "Rosa", "Teresita", "Lourdes", "Josefina", "Carmelita", "Elena", "Corazon", "Marites", "Rowena", "Cristina", "Jennifer", "Liza", "Grace", "Joy", "Kristine", "Angelica", "Nenita", "Evelyn"];
const MIDDLE = ["Santos", "Reyes", "Cruz", "Garcia", "Mendoza", "Ramos", "Lopez", "Flores"];
const JOBS = ["Farmer", "Fisherman", "Tricycle driver", "Sari-sari store owner", "Teacher", "Carpenter", "Vendor", "Office worker", "Housewife", "Mason", "Seamstress", "Retired"];
const CIVIL = ["MARRIED", "MARRIED", "SINGLE", "WIDOWED", "MARRIED", "SEPARATED"];

const pad = (n: number, w: number) => String(n).padStart(w, "0");
const memberNo = (i: number) => `M-${pad(i, 6)}`;
const pesos = (centavos: bigint) => Number(centavos) / 100;
const ASSOCIATES = new Set([7, 14, 21, 28, 35, 38]);
const INACTIVE = new Set([19, 33]);
const FEE_UNPAID = new Set([12, 26, 39]);
const MEMBER_COUNT = 40;

/** The DOMAIN §2 sample tariffs (what the old system billed). */
function tariff(classification: "RESIDENTIAL" | "COMMERCIAL", m3: number): bigint {
  if (classification === "COMMERCIAL") return 40000n + BigInt(Math.max(0, m3 - 10)) * 4000n;
  const block = (from: number, to: number, rate: number) => BigInt(Math.max(0, Math.min(m3, to) - from + 1)) * BigInt(rate);
  return 20000n + block(11, 20, 2500) + block(21, 30, 3000) + block(31, 100000, 3500);
}

type DemoMember = { i: number; no: string; purok: (typeof DEMO_PUROKS)[number]; last: string; first: string; middle: string; sex: "MALE" | "FEMALE"; street: string; since: BusinessDate };

function demoMembers(): DemoMember[] {
  return Array.from({ length: MEMBER_COUNT }, (_x, k) => {
    const i = k + 1;
    const sex = i % 2 === 1 ? ("MALE" as const) : ("FEMALE" as const);
    const year = 2008 + (i % 17);
    return {
      i,
      no: memberNo(i),
      purok: DEMO_PUROKS[i % DEMO_PUROKS.length]!,
      last: LAST[k]!,
      first: (sex === "MALE" ? MALE : FEMALE)[(i * 7) % 20]!,
      middle: MIDDLE[i % MIDDLE.length]!,
      sex,
      street: `Blk ${(i % 9) + 1} Lot ${(i % 23) + 1}`,
      since: `${year}-${pad(((i * 5) % 12) + 1, 2)}-${pad(((i * 3) % 27) + 1, 2)}`,
    };
  });
}

/** Every template's rows for a migration as of `cutoff` (a month end), plus the cut-off trial balance. */
export function demoMigration(cutoff: BusinessDate): Record<MigrationEntity, Cells[]> {
  const people = demoMembers();
  const cutoffMonth = cutoff.slice(0, 7);

  const members: Cells[] = people.map((m) => ({
    "Member No.": m.no,
    Type: ASSOCIATES.has(m.i) ? "ASSOCIATE" : "REGULAR",
    Status: INACTIVE.has(m.i) ? "INACTIVE" : "ACTIVE",
    "Last Name": m.last,
    "First Name": m.first,
    "Middle Name": m.middle,
    Birthdate: `${1955 + ((m.i * 7) % 43)}-${pad((m.i % 12) + 1, 2)}-${pad(((m.i * 3) % 27) + 1, 2)}`,
    Sex: m.sex,
    "Civil Status": CIVIL[m.i % CIVIL.length]!,
    "House No. / Street": m.street,
    "Purok / Sitio": m.purok.name,
    Barangay: "Pipindan",
    Municipality: "Binangonan",
    Province: "Rizal",
    Mobile: `0917${pad((1000000 + m.i * 7919) % 10000000, 7)}`,
    Occupation: JOBS[m.i % JOBS.length]!,
    "Membership Date": m.since,
    "PMES Date": addDays(m.since, -10),
    "BOD Resolution No.": `${m.since.slice(0, 4)}-${pad(m.i, 3)}`,
    "Membership Fee Paid": FEE_UNPAID.has(m.i) ? null : 500,
  }));

  // Share capital: regular members subscribe 100–299 shares of ₱100; associates ₱2,000–₱5,000.
  const share = people.map((m) => {
    const subscribed = ASSOCIATES.has(m.i) ? 200000n + BigInt(m.i % 4) * 100000n : BigInt(100 + ((m.i * 37) % 200)) * 10000n;
    const paidUp = m.i % 4 === 0 ? subscribed : ((subscribed * BigInt(30 + (m.i % 7) * 10)) / 100n / 10000n) * 10000n;
    return { no: m.no, subscribed, paidUp: paidUp < 250000n && !ASSOCIATES.has(m.i) ? 250000n : paidUp };
  });

  const noSavings = new Set([5, 17, 31, 40]);
  const savings = people
    .filter((m) => !noSavings.has(m.i))
    .map((m) => ({
      m,
      accountNo: `SA-${pad(m.i, 6)}`,
      balance: BigInt(50000 + ((m.i * 733_117) % 6_000_000)) + BigInt((m.i * 37) % 100),
      last: addDays(cutoff, -((m.i * 3) % 40)),
    }));

  const tds = [2, 9, 16, 23, 30].map((i, k) => ({
    no: memberNo(i),
    principal: BigInt(20000 * (1 + (i % 4))) * 100n,
    rate: 3 + (k % 3) * 0.5,
    term: k % 2 === 0 ? 180 : 360,
    placed: addDays(cutoff, -(30 + i * 4)),
  }));

  // Loans: released `monthsAgo` months before the cut-off, due on the 7th; `arrears` installments unpaid at the cut-off.
  const loanDefs = [
    { i: 1, product: "REG", method: "DIMINISHING_EQUAL_AMORT", ratePm: "0.015", amount: 10000, term: 12, monthsAgo: 4, arrears: 0, partial: 0, penalty: 0 },
    { i: 3, product: "REG", method: "DIMINISHING_EQUAL_AMORT", ratePm: "0.015", amount: 25000, term: 24, monthsAgo: 9, arrears: 0, partial: 0, penalty: 0 },
    { i: 4, product: "PRD", method: "DIMINISHING_EQUAL_PRINCIPAL", ratePm: "0.01", amount: 15000, term: 12, monthsAgo: 6, arrears: 1, partial: 0, penalty: 85.5 },
    { i: 6, product: "EMR", method: "ADD_ON", ratePm: "0.015", amount: 5000, term: 6, monthsAgo: 2, arrears: 0, partial: 0, penalty: 0 },
    { i: 8, product: "REG", method: "DIMINISHING_EQUAL_AMORT", ratePm: "0.015", amount: 30000, term: 24, monthsAgo: 12, arrears: 2, partial: 0, penalty: 412.75 },
    { i: 10, product: "REG", method: "DIMINISHING_EQUAL_AMORT", ratePm: "0.015", amount: 12000, term: 12, monthsAgo: 3, arrears: 0, partial: 0.5, penalty: 0 },
    { i: 11, product: "EMR", method: "ADD_ON", ratePm: "0.015", amount: 3000, term: 6, monthsAgo: 4, arrears: 1, partial: 0, penalty: 30 },
    { i: 13, product: "PRD", method: "DIMINISHING_EQUAL_PRINCIPAL", ratePm: "0.01", amount: 20000, term: 12, monthsAgo: 5, arrears: 0, partial: 0, penalty: 0 },
    { i: 15, product: "REG", method: "DIMINISHING_EQUAL_AMORT", ratePm: "0.015", amount: 50000, term: 24, monthsAgo: 7, arrears: 0, partial: 0, penalty: 0 },
    { i: 18, product: "REG", method: "DIMINISHING_EQUAL_AMORT", ratePm: "0.015", amount: 15000, term: 12, monthsAgo: 10, arrears: 3, partial: 0, penalty: 690 },
    { i: 20, product: "EMR", method: "ADD_ON", ratePm: "0.015", amount: 4000, term: 6, monthsAgo: 1, arrears: 0, partial: 0, penalty: 0 },
    { i: 22, product: "PRD", method: "DIMINISHING_EQUAL_PRINCIPAL", ratePm: "0.01", amount: 18000, term: 12, monthsAgo: 8, arrears: 0, partial: 0, penalty: 0 },
  ] as const;
  const loans = loanDefs.map((d, k) => {
    const release = addMonths(`${cutoffMonth}-07`, -d.monthsAgo);
    const firstDue = addMonths(release, 1);
    const principal = BigInt(d.amount) * 100n;
    const rows = schedule({ principal, ratePm: d.ratePm, term: d.term, method: d.method as AmortizationMethod, firstDueDate: firstDue });
    const due = rows.filter((r) => r.dueDate <= cutoff).length;
    const paid = due - d.arrears;
    const after = rows.slice(paid).reduce((t, r) => t + r.principal, 0n);
    const partial = d.partial > 0 ? (rows[paid]!.principal * BigInt(Math.round(d.partial * 100))) / 100n : 0n;
    return { d, no: `LN-${release.slice(0, 4)}-${pad(k + 1, 5)}`, release, firstDue, paid, outstanding: after - partial };
  });

  // Water: households of members 1–30 (but the inactive no. 19) and 14 non-member connections (3 businesses).
  type Conn = { n: number; memberNo: string | null; last: string | null; first: string | null; business: string | null; purok: (typeof DEMO_PUROKS)[number]; street: string; classification: "RESIDENTIAL" | "COMMERCIAL" };
  const conns: Conn[] = people
    .filter((m) => m.i <= 30 && !INACTIVE.has(m.i))
    .map((m) => ({ n: 0, memberNo: m.no, last: null, first: null, business: null, purok: m.purok, street: m.street, classification: "RESIDENTIAL" as const }));
  const outsiders: Array<[string | null, string | null, string | null]> = [
    ["Mallari", "Josefina", null],
    ["Dizon", "Ramil", null],
    ["Ilagan", "Corazon", null],
    ["Bernardo", "Felix", null],
    ["Esguerra", "Lilia", null],
    ["Quiambao", "Noel", null],
    ["Tolentino", "Wilma", null],
    ["Yap", "Dennis", null],
    ["Agbayani", "Rhea", null],
    ["Macaraeg", "Oscar", null],
    ["Samonte", "Imelda", null],
    [null, null, "Aling Nena's Sari-sari Store"],
    [null, null, "Pipindan Bakery"],
    [null, null, "JM Carwash"],
  ];
  outsiders.forEach(([last, first, business], k) =>
    conns.push({ n: 0, memberNo: null, last, first, business, purok: DEMO_PUROKS[(k * 3) % DEMO_PUROKS.length]!, street: `${(k + 1) * 11} Rizal St.`, classification: business ? "COMMERCIAL" : "RESIDENTIAL" }),
  );
  conns.forEach((c, k) => (c.n = k + 1));
  const disconnected = new Set([9, 27]);
  const withArrears = new Set([3, 9, 14, 21, 27, 33, 38]);
  const advances = new Map([
    [5, 15000n],
    [12, 30000n],
  ]);
  const usage = (c: Conn, ago: number) => (c.classification === "COMMERCIAL" ? 30 : 8) + ((c.n * 7 + ago * 5) % (c.classification === "COMMERCIAL" ? 31 : 25));
  const sequence = new Map<string, number>();
  const waterAccounts: Cells[] = conns.map((c) => {
    const seq = (sequence.get(c.purok.code) ?? 0) + 1;
    sequence.set(c.purok.code, seq);
    const address = `${c.street}, ${c.purok.name}, Pipindan, Binangonan, Rizal`;
    return {
      "Account No.": `WA-${pad(c.n, 6)}`,
      "Customer No.": `WC-${pad(c.n, 6)}`,
      "Member No.": c.memberNo,
      "Last Name": c.last,
      "First Name": c.first,
      "Business Name": c.business,
      "Customer Address": address,
      Classification: c.classification,
      "Zone Code": c.purok.code,
      "Route Code": `${c.purok.code}-R1`,
      Sequence: seq,
      "Service Address": address,
      Status: disconnected.has(c.n) ? "DISCONNECTED" : "ACTIVE",
      "Connected On": `${2010 + (c.n % 15)}-${pad(((c.n * 5) % 12) + 1, 2)}-15`,
      "Meter Serial No.": `MTR-${pad(24000 + c.n, 6)}`,
      "Meter Digits": 4,
      "Last Reading": 100 + ((c.n * 397) % 3200),
      "Consumption 1 Month Ago": disconnected.has(c.n) ? 0 : usage(c, 1),
      "Consumption 2 Months Ago": usage(c, 2),
      "Consumption 3 Months Ago": usage(c, 3),
      "Meter Deposit": c.classification === "COMMERCIAL" ? 2000 : 1000,
      "Advance Payment": advances.has(c.n) ? pesos(advances.get(c.n)!) : null,
    };
  });

  // Unpaid bills: the cut-off month's bill (billed on the cut-off, due 15 days later) for every active connection;
  // older bills for those in arrears (the old system added its 10% penalty to most of them).
  const billRows: Array<{ accountNo: string; period: string; billDate: BusinessDate; dueDate: BusinessDate; m3: number; amount: bigint; penalty: boolean }> = [];
  for (const c of conns) {
    const accountNo = `WA-${pad(c.n, 6)}`;
    if (!disconnected.has(c.n)) {
      const m3 = usage(c, 1);
      billRows.push({ accountNo, period: cutoffMonth, billDate: cutoff, dueDate: addDays(cutoff, 15), m3, amount: tariff(c.classification, m3), penalty: false });
    }
    if (withArrears.has(c.n)) {
      for (let ago = 1; ago <= (disconnected.has(c.n) ? 3 : 1); ago++) {
        const billDate = monthEnd(addMonths(`${cutoffMonth}-01`, -ago));
        const m3 = usage(c, ago + 1);
        const charged = c.n !== 14;
        const base = tariff(c.classification, m3);
        billRows.push({ accountNo, period: billDate.slice(0, 7), billDate, dueDate: addDays(billDate, 15), m3, amount: charged ? base + base / 10n : base, penalty: charged });
      }
    }
  }
  const waterBills: Cells[] = billRows.map((b, k) => ({
    "Account No.": b.accountNo,
    "Bill No.": `OLD-${b.period}-${pad(k + 1, 4)}`,
    Period: b.period,
    "Bill Date": b.billDate,
    "Due Date": b.dueDate,
    Consumption: b.m3,
    "Amount Unpaid": pesos(b.amount),
    "Penalty Assessed": b.penalty ? "YES" : "NO",
  }));

  const stockDefs: Array<[string, string, string, string, number, string, number, number]> = [
    ["RICE-25", "Rice 25 kg", "sack", "Grocery", 1350, "1180.50", 40, 10],
    ["RICE-1K", "Rice 1 kg", "kg", "Grocery", 56, "48.25", 120, 30],
    ["SUGAR-1K", "Sugar 1 kg", "pack", "Grocery", 88, "76.40", 60, 20],
    ["OIL-1L", "Cooking oil 1 L", "bottle", "Grocery", 115, "98.75", 48, 12],
    ["SARDINES", "Sardines 155 g", "can", "Canned goods", 26, "21.30", 200, 48],
    ["CORNED-BEEF", "Corned beef 150 g", "can", "Canned goods", 45, "38.10", 96, 24],
    ["NOODLES", "Instant noodles", "pack", "Noodles", 15, "11.85", 300, 60],
    ["COFFEE-3IN1", "Coffee 3-in-1 (10s)", "pack", "Beverages", 75, "63.20", 80, 20],
    ["MILK-300", "Powdered milk 300 g", "pack", "Beverages", 145, "124.60", 36, 12],
    ["SOAP-BAR", "Laundry soap", "bar", "Household", 25, "20.00", 150, 40],
    ["DETERGENT-1K", "Detergent powder 1 kg", "pack", "Household", 98, "84.35", 45, 12],
    ["SHAMPOO-12", "Shampoo sachets (12s)", "strip", "Personal care", 72, "60.80", 60, 15],
    ["TOOTHPASTE", "Toothpaste 150 g", "tube", "Personal care", 89, "74.90", 40, 10],
    ["EGGS-30", "Eggs (tray of 30)", "tray", "Fresh", 255, "228.00", 12, 5],
    ["CANDLES-6", "Candles (pack of 6)", "pack", "Household", 42, "33.50", 0, 10],
  ];
  const storeStock: Cells[] = stockDefs.map(([sku, name, unit, category, price, cost, qty, reorder]) => ({
    SKU: sku,
    Name: name,
    Unit: unit,
    Category: category,
    "Selling Price": price,
    "Unit Cost": cost,
    Quantity: qty,
    "Reorder Level": reorder,
  }));
  const inventory = stockDefs.reduce((t, [, , , , , cost, qty]) => t + (qty > 0 ? costOf(qty, cost) : 0n), 0n);

  const supplierDefs: Array<[string, string, string, number, bigint]> = [
    ["Binangonan Rice Dealer", "0917 555 0101", "123-456-789-000", 30, 4722000n],
    ["Rizal Grocery Wholesale", "0918 555 0202", "234-567-891-000", 30, 1845075n],
    ["Antipolo Trading", "0919 555 0303", "", 15, 632000n],
    ["JC Distributors", "0920 555 0404", "", 0, 0n],
  ];
  const suppliers: Cells[] = supplierDefs.map(([name, contact, tin, terms, balance]) => ({ "Supplier Name": name, Contact: contact, TIN: tin || null, "Terms (days)": terms, Balance: pesos(balance) }));

  const arDefs: Array<[number, bigint, bigint | null]> = [
    [2, 85000n, null],
    [5, 25000n, null],
    [9, 124050n, 300000n],
    [16, 47500n, null],
    [24, 240000n, 300000n],
    [29, 63025n, null],
    [31, 31000n, null],
    [36, 98000n, null],
  ];
  const storeAr: Cells[] = arDefs.map(([i, balance, limit]) => ({ "Member No.": memberNo(i), Balance: pesos(balance), "Charge Limit": limit === null ? null : pesos(limit) }));

  // The trial balance: control accounts from the records above, the rest as the old books had them.
  const sum = (xs: bigint[]) => xs.reduce((t, x) => t + x, 0n);
  const loansBy = (p: string) => sum(loans.filter((l) => l.d.product === p).map((l) => l.outstanding));
  const debits: Array<[string, string, bigint]> = [
    ["11110", "Cash on Hand", 8500000n],
    ["11130", "Cash in Bank", 124850000n],
    ["11210", "Loans Receivable - Regular", loansBy("REG")],
    ["11220", "Loans Receivable - Emergency", loansBy("EMR")],
    ["11230", "Loans Receivable - Productive", loansBy("PRD")],
    ["11250", "Accounts Receivable - Members", sum(arDefs.map((a) => a[1]))],
    ["11260", "Accounts Receivable - Water", sum(billRows.map((b) => b.amount))],
    ["11270", "Subscription Receivable - Common", sum(share.map((s) => s.subscribed - s.paidUp))],
    ["11310", "Merchandise Inventory", inventory],
    ["12110", "Building", 180000000n],
    ["12120", "Water System (Pipes, Pumps, Tanks)", 325000000n],
    ["12130", "Office Equipment", 18500000n],
    ["51110", "Cost of Sales - Store", 22147000n],
    ["52110", "Interest Expense on Deposits", 2388000n],
    ["53110", "Depreciation Expense", 9825000n],
    ["53210", "Salaries and Wages", 18600000n],
    ["53220", "Utilities", 4763000n],
  ];
  const credits: Array<[string, string, bigint]> = [
    ["11290", "Allowance for Probable Losses", 1850000n],
    ["12115", "Accumulated Depreciation - Building", 54000000n],
    ["12125", "Accumulated Depreciation - Water System", 97500000n],
    ["12135", "Accumulated Depreciation - Office Equipment", 9800000n],
    ["21110", "Savings Deposits", sum(savings.map((s) => s.balance))],
    ["21120", "Time Deposits", sum(tds.map((t) => t.principal))],
    ["21210", "Accounts Payable - Trade", sum(supplierDefs.map((s) => s[4]))],
    ["21220", "Customers' Deposits - Water", sum(conns.map((c) => (c.classification === "COMMERCIAL" ? 200000n : 100000n)))],
    ["21230", "Customers' Advances - Water", sum([...advances.values()])],
    ["21250", "Withholding Tax Payable", 185000n],
    ["21260", "CETF Payable", 1420000n],
    ["31110", "Subscribed Share Capital - Common", sum(share.map((s) => s.subscribed))],
    ["32200", "Reserve Fund", 42000000n],
    ["32300", "Education and Training Fund (Local)", 4800000n],
    ["32400", "Community Development Fund", 3150000n],
    ["32500", "Optional Fund", 3500000n],
    ["41110", "Interest Income - Loans", 9635000n],
    ["41120", "Service Fee Income", 1428000n],
    ["41130", "Fines and Penalties Income", 342000n],
    ["42110", "Water Revenue - Members", 31864000n],
    ["42120", "Water Revenue - Non-members", 14621000n],
    ["42140", "Penalty Income - Water", 911500n],
    ["43110", "Sales", 26894000n],
    ["44110", "Membership Fee Income", 650000n],
  ];
  // Undivided Net Surplus balances the books (prior years' surplus not yet allocated).
  const uns = sum(debits.map((d) => d[2])) - sum(credits.map((c) => c[2]));
  const trialBalance: Cells[] = [
    ...debits.filter((d) => d[2] !== 0n).map(([code, name, amount]) => ({ "Account Code": code, "Account Name": name, Debit: pesos(amount) })),
    ...credits.filter((c) => c[2] !== 0n).map(([code, name, amount]) => ({ "Account Code": code, "Account Name": name, Credit: pesos(amount) })),
    uns >= 0n ? { "Account Code": "32100", "Account Name": "Undivided Net Surplus", Credit: pesos(uns) } : { "Account Code": "32100", "Account Name": "Undivided Net Surplus", Debit: pesos(-uns) },
  ];

  return {
    members,
    share_capital: share.map((s) => ({ "Member No.": s.no, Subscribed: pesos(s.subscribed), "Paid-up": pesos(s.paidUp) })),
    savings: savings.map((s) => ({
      "Member No.": s.m.no,
      "Account No.": s.accountNo,
      "Product Code": "SAV",
      "Opened On": s.m.since,
      Balance: pesos(s.balance),
      "Last Transaction Date": s.last,
    })),
    time_deposits: tds.map((t, k) => ({
      "Member No.": t.no,
      "Certificate No.": `TDC-${pad(k + 1, 4)}`,
      Principal: pesos(t.principal),
      "Rate p.a. (%)": t.rate,
      "Term (days)": t.term,
      "Placement Date": t.placed,
    })),
    loans: loans.map((l) => ({
      "Member No.": memberNo(l.d.i),
      "Loan No.": l.no,
      "Product Code": l.d.product,
      Principal: l.d.amount,
      "Term (months)": l.d.term,
      "Release Date": l.release,
      "First Due Date": l.firstDue,
      "Installments Paid": l.paid,
      "Outstanding Principal": pesos(l.outstanding),
      "Unpaid Penalty": l.d.penalty || null,
    })),
    water_accounts: waterAccounts,
    water_bills: waterBills,
    store_stock: storeStock,
    suppliers,
    store_ar: storeAr,
    trial_balance: trialBalance,
  };
}
