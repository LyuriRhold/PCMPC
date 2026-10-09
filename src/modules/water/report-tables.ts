import { addDays, businessToday, formatDate, isBusinessDate, type BusinessDate } from "@/lib/dates";
import type { Money } from "@/lib/money";
import { disconnectionList } from "./collections";
import {
  agingReport,
  billingSummary,
  collectionEfficiency,
  consumptionByRoute,
  customerSoa,
  dailyCollections,
  nrw,
  reconnectionLog,
  seniorDiscounts,
  topConsumers,
  zeroAndEstimated,
} from "./reports";

/**
 * The water reports as tables (PHASE-07 T7.7): one definition per report, rendered by the reports
 * page (and printed) and exported to Excel by /api/water/reports/{key}.
 */

export type Kind = "text" | "int" | "money" | "pct" | "date";
export type Column = { key: string; label: string; kind: Kind };
export type Cell = string | number | Money | null;
export type Table = { title: string; subtitle: string; columns: Column[]; rows: Array<Record<string, Cell>>; footer?: Record<string, Cell> };
export type Param = "period" | "month" | "date" | "asOf" | "from" | "to" | "customer";

export type ReportDef = { key: string; title: string; params: Param[]; build: (p: Record<Param, string>) => Promise<Table> };

const m = (key: string, label: string): Column => ({ key, label, kind: "money" });
const t = (key: string, label: string): Column => ({ key, label, kind: "text" });
const n = (key: string, label: string): Column => ({ key, label, kind: "int" });

export const REPORTS: ReportDef[] = [
  {
    key: "billing-summary",
    title: "Billing summary",
    params: ["period"],
    build: async ({ period }) => {
      const s = await billingSummary(period);
      return {
        title: "Billing summary",
        subtitle: `Period ${period}`,
        columns: [t("zone", "Zone"), t("classification", "Class"), t("customerType", "Customer"), n("bills", "Bills"), n("consumption", "m³"), m("basic", "Basic charge"), m("seniorDiscount", "Senior discount"), m("net", "Net billed")],
        rows: s.rows.map((r) => ({ ...r, customerType: r.customerType === "MEMBER" ? "Member" : "Non-member" })),
        footer: { zone: "Total", bills: s.totals.bills, consumption: s.totals.consumption, basic: s.totals.members + s.totals.nonMembers, seniorDiscount: s.totals.seniorDiscount, net: s.totals.net },
      };
    },
  },
  {
    key: "member-revenue",
    title: "Member vs non-member water revenue",
    params: ["period"],
    build: async ({ period }) => {
      const s = await billingSummary(period);
      return {
        title: "Member vs non-member water revenue",
        subtitle: `Period ${period}`,
        columns: [t("group", "Customers"), m("revenue", "Water revenue (basic)")],
        rows: [
          { group: "Members", revenue: s.totals.members },
          { group: "Non-members", revenue: s.totals.nonMembers },
        ],
        footer: { group: "Total", revenue: s.totals.members + s.totals.nonMembers },
      };
    },
  },
  {
    key: "daily-collections",
    title: "Daily collection report",
    params: ["date"],
    build: async ({ date }) => {
      const r = await dailyCollections(date);
      return {
        title: "Daily collection report (water)",
        subtitle: formatDate(date),
        columns: [t("teller", "Teller"), t("receiptNo", "Receipt"), t("payor", "Payor"), t("description", "Item"), m("amount", "Amount")],
        rows: r.rows,
        footer: { teller: "Total", amount: r.total },
      };
    },
  },
  {
    key: "aging",
    title: "AR–Water aging",
    params: ["asOf"],
    build: async ({ asOf }) => {
      const a = await agingReport(asOf);
      return {
        title: "AR–Water aging",
        subtitle: `As of ${formatDate(asOf)}`,
        columns: [t("accountNo", "Account"), t("customerName", "Customer"), m("current", "Current"), m("d1_30", "1–30"), m("d31_60", "31–60"), m("d61_90", "61–90"), m("over90", "> 90"), m("total", "Total")],
        rows: a.rows,
        footer: { accountNo: "Total", ...a.totals },
      };
    },
  },
  {
    key: "collection-efficiency",
    title: "Collection efficiency",
    params: ["month"],
    build: async ({ month }) => {
      const e = await collectionEfficiency(month);
      return {
        title: "Collection efficiency",
        subtitle: `Bills due in ${month}`,
        columns: [m("billed", "Billed (due this month)"), m("collected", "Collected on those bills"), { key: "percent", label: "Efficiency", kind: "pct" }],
        rows: [{ billed: e.billed, collected: e.collected, percent: e.percent }],
      };
    },
  },
  {
    key: "disconnection-list",
    title: "Disconnection list",
    params: [],
    build: async () => {
      const list = await disconnectionList();
      return {
        title: "Disconnection list",
        subtitle: `As of ${formatDate(businessToday())}`,
        columns: [t("accountNo", "Account"), t("customerName", "Customer"), t("serviceAddress", "Service address"), n("unpaidBills", "Unpaid bills"), m("outstanding", "Amount due"), t("notice", "Notice")],
        rows: list.map((l) => ({ ...l, notice: l.notice ? `${l.notice.noticeNo} (until ${formatDate(l.notice.scheduledDate)})` : "" })),
      };
    },
  },
  {
    key: "reconnection-log",
    title: "Disconnection & reconnection log",
    params: ["from", "to"],
    build: async ({ from, to }) => ({
      title: "Disconnection & reconnection log",
      subtitle: `${formatDate(from)} – ${formatDate(to)}`,
      columns: [t("noticeNo", "Notice"), t("accountNo", "Account"), t("customerName", "Customer"), { key: "noticeDate", label: "Notice date", kind: "date" }, { key: "disconnectedAt", label: "Disconnected", kind: "date" }, { key: "reconnectedAt", label: "Reconnected", kind: "date" }, t("status", "Status"), m("amount", "Amount on notice")],
      rows: (await reconnectionLog(from, to)).rows,
    }),
  },
  {
    key: "consumption",
    title: "Consumption by zone and route",
    params: ["period"],
    build: async ({ period }) => {
      const r = await consumptionByRoute(period);
      return {
        title: "Consumption by zone and route",
        subtitle: `Period ${period}`,
        columns: [t("zone", "Zone"), t("route", "Route"), n("accounts", "Bills"), n("consumption", "m³"), m("billed", "Billed")],
        rows: r.rows,
        footer: { zone: "Total", accounts: r.rows.reduce((s, x) => s + x.accounts, 0), consumption: r.rows.reduce((s, x) => s + x.consumption, 0), billed: r.rows.reduce((s, x) => s + x.billed, 0n) },
      };
    },
  },
  {
    key: "top-consumers",
    title: "Top consumers",
    params: ["period"],
    build: async ({ period }) => ({
      title: "Top consumers",
      subtitle: `Period ${period}`,
      columns: [t("accountNo", "Account"), t("customerName", "Customer"), t("classification", "Class"), n("consumption", "m³"), m("amount", "Amount")],
      rows: (await topConsumers(period)).rows,
    }),
  },
  {
    key: "zero-estimated",
    title: "Zero-consumption and estimated accounts",
    params: ["period"],
    build: async ({ period }) => ({
      title: "Zero-consumption and estimated accounts",
      subtitle: `Period ${period}`,
      columns: [t("accountNo", "Account"), t("customerName", "Customer"), t("type", "Reading"), n("consumption", "m³"), t("remarks", "Remarks")],
      rows: (await zeroAndEstimated(period)).rows,
    }),
  },
  {
    key: "senior-discount",
    title: "Senior-citizen discount report",
    params: ["period"],
    build: async ({ period }) => {
      const r = await seniorDiscounts(period);
      return {
        title: "Senior-citizen discount report",
        subtitle: `Period ${period}`,
        columns: [t("billNo", "Bill"), t("accountNo", "Account"), t("customerName", "Customer"), n("consumption", "m³"), m("basic", "Basic charge"), m("discount", "Discount")],
        rows: r.rows,
        footer: { billNo: "Total", discount: r.total },
      };
    },
  },
  {
    key: "nrw",
    title: "Non-revenue water",
    params: ["period"],
    build: async ({ period }) => {
      const r = await nrw(period);
      return {
        title: "Non-revenue water (NRW)",
        subtitle: `Period ${period}${r.produced === null ? " — no production readings for this month" : ""}`,
        columns: [n("produced", "Produced (m³)"), n("billed", "Billed (m³)"), n("nrwM3", "NRW (m³)"), { key: "nrwPercent", label: "NRW %", kind: "pct" }],
        rows: [r],
      };
    },
  },
  {
    key: "soa",
    title: "Customer statement of account",
    params: ["customer"],
    build: async ({ customer }) => {
      const s = await customerSoa(customer);
      return {
        title: "Statement of account",
        subtitle: `${s.customer.name} (${s.customer.customerNo})`,
        columns: [{ key: "date", label: "Date", kind: "date" }, t("reference", "Reference"), t("description", "Description"), m("debit", "Charges"), m("credit", "Payments / credits"), m("balance", "Balance")],
        rows: s.lines,
        footer: { date: "Ending balance", balance: s.endingBalance },
      };
    },
  },
];

export function reportDef(key: string): ReportDef | undefined {
  return REPORTS.find((r) => r.key === key);
}

/** Report parameters from a query string, with sensible defaults (this month, today). */
export function reportParams(get: (k: string) => string | null | undefined): Record<Param, string> {
  const today = businessToday();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/;
  const date = (v: string | null | undefined, d: BusinessDate) => (v && isBusinessDate(v) ? v : d);
  const per = get("period");
  const mon = get("month");
  return {
    period: per && month.test(per) ? per : today.slice(0, 7),
    month: mon && month.test(mon) ? mon : today.slice(0, 7),
    date: date(get("date"), today),
    asOf: date(get("asOf"), today),
    from: date(get("from"), addDays(today, -30)),
    to: date(get("to"), today),
    customer: get("customer") ?? "",
  };
}
