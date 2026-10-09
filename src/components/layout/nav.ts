import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Banknote,
  BookOpen,
  Building2,
  Calculator,
  CalendarCheck,
  ChartColumn,
  ClipboardList,
  Coins,
  Database,
  Droplets,
  FileSpreadsheet,
  FileText,
  Gauge,
  HandCoins,
  HeartPulse,
  House,
  IdCard,
  Landmark,
  Layers,
  MapPin,
  Package,
  Percent,
  PiggyBank,
  Power,
  Receipt,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  Store,
  TrendingUp,
  Truck,
  UserPlus,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react";
import type { Permission } from "@/modules/auth/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * `live`: the screen exists and is permission-checked on the server.
   * `soon`: planned; the route shows an "under construction" page (no data, no actions).
   */
  status: "live" | "soon";
  /** Phase (docs/phases) that delivers this screen. */
  phase: string;
  /** One-line description shown on the dashboard and the coming-soon page. */
  summary: string;
  /** What the screen will let staff do (coming-soon page). */
  features?: string[];
  /** Live items are shown only to users holding this permission, or any one of a list (pages re-check on the server). */
  permission?: Permission | Permission[];
};

export type NavSection = {
  title: string;
  icon: LucideIcon;
  items: NavItem[];
};

/** Phase names (PLAN.md §6), for "planned for Phase XX: …" labels. */
export const PHASES: Record<string, string> = {
  "00": "Foundation & Loop Gate",
  "01": "Auth, Roles, Audit Trail & Coop Settings",
  "02": "Members Registry",
  "03": "Accounting Core (GL engine)",
  "04": "Cashiering Core",
  "05": "Water: Customers, Connections, Meters & Rates",
  "06": "Water: Meter Reading & Billing",
  "07": "Water: Collections, Penalties & Disconnection",
  "08": "Share Capital & CBU",
  "09": "Savings & Time Deposits",
  "10": "Loan Products & Applications",
  "11": "Loan Release, Collections & Aging",
  "12": "Store: Inventory & Purchasing",
  "13": "Store: POS & Charge-to-Member",
  "14": "Financial Statements & Close",
  "15": "Net Surplus, ISC & Patronage Refund",
  "16": "Reports: CDA, Management, Member",
  "17": "Data Migration & Opening Balances",
  "18": "Hardening, Deploy, UAT & Go-Live",
};

/**
 * Every screen of the MIS, grouped as in the sidebar. Built screens are `live`; planned ones are
 * `soon` and render the shared under-construction page until their phase ships (then flip the
 * status and add the real route under src/app/(staff)).
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: "General",
    icon: House,
    items: [
      { href: "/", label: "Dashboard", icon: House, status: "live", phase: "01", summary: "Your starting page: modules and what is ready." },
    ],
  },
  {
    title: "Water Service",
    icon: Droplets,
    items: [
      {
        href: "/water/customers",
        label: "Customers",
        icon: UsersRound,
        status: "live",
        permission: ["water.customers", "water.apply", "water.approve", "water.install", "water.rates"],
        phase: "05",
        summary: "Member and non-member water customers.",
        features: ["Register member and non-member customers", "Link member customers to their member record", "Search by name, customer no. or account no."],
      },
      {
        href: "/water/applications",
        label: "Applications",
        icon: UserPlus,
        status: "live",
        permission: ["water.apply", "water.approve", "water.install"],
        phase: "05",
        summary: "New connection applications through approval, installation and activation.",
        features: ["Application → approval → installation → activation", "Connection fee and meter deposit at the teller", "Transfers of account ownership"],
      },
      {
        href: "/water/connections",
        label: "Connections & meters",
        icon: Gauge,
        status: "live",
        permission: ["water.customers", "water.apply", "water.approve", "water.install", "water.rates"],
        phase: "05",
        summary: "Service accounts, meter inventory, installation and replacement.",
        features: ["Service account per connection with its classification", "Meter inventory, installation and replacement", "Senior-citizen discount eligibility (RA 9994)"],
      },
      {
        href: "/water/routes",
        label: "Zones & routes",
        icon: MapPin,
        status: "live",
        permission: ["water.customers", "water.apply", "water.approve", "water.install", "water.rates"],
        phase: "05",
        summary: "Puroks/zones, reading routes and the reading sequence.",
        features: ["Zones and reading routes", "Reading order per route", "Assign meter readers to routes"],
      },
      {
        href: "/water/tariffs",
        label: "Tariffs & fees",
        icon: Percent,
        status: "live",
        permission: ["water.customers", "water.apply", "water.approve", "water.install", "water.rates"],
        phase: "05",
        summary: "Versioned NWRB-approved tariff and the fee schedule.",
        features: ["Versioned rate schedules with the NWRB reference", "Minimum charge and block rates per classification", "Connection, deposit and reconnection fees"],
      },
      {
        href: "/water/readings",
        label: "Meter readings",
        icon: ClipboardList,
        status: "live",
        permission: ["water.bill", "water.review_readings"],
        phase: "06",
        summary: "Billing periods, reading sheets and the flag review queue.",
        features: ["Billing periods per zone", "Office reading entry grid", "Review high, zero and estimated readings"],
      },
      {
        href: "/read",
        label: "Reading app (phone)",
        icon: Smartphone,
        status: "live",
        phase: "06",
        permission: "water.read_meter",
        summary: "Meter readers: your routes in order, with or without signal.",
      },
      {
        href: "/water/billing",
        label: "Billing runs",
        icon: Layers,
        status: "live",
        permission: "water.bill",
        phase: "06",
        summary: "Preview and post monthly bills per zone.",
        features: ["Preview → post billing run", "Bills posted to the GL in the same transaction", "Print bills and reading sheets per route"],
      },
      {
        href: "/water/bills",
        label: "Bills & adjustments",
        icon: FileText,
        status: "live",
        permission: ["water.bill", "water.adjust_prepare", "water.adjust_approve"],
        phase: "06",
        summary: "Bill inquiry, credit and debit memos.",
        features: ["Bill history per account", "Credit/debit memos with preparer ≠ approver", "Final bill on account closure"],
      },
      {
        href: "/water/collections",
        label: "Collections & penalties",
        icon: Coins,
        status: "live",
        permission: ["water.bill", "water.review_readings", "water.adjust_approve", "water.disconnect", "reports.read"],
        phase: "07",
        summary: "Payments, penalties, deposits and statements of account.",
        features: ["Bill payments at the teller counter", "Daily late-penalty job", "Customer ledger and statement of account"],
      },
      {
        href: "/water/disconnections",
        label: "Disconnections",
        icon: Power,
        status: "live",
        permission: ["water.disconnect", "water.reconnect"],
        phase: "07",
        summary: "Disconnection lists, notices and reconnection orders.",
        features: ["Disconnection list after unpaid bills", "Notices and disconnect/reconnect orders", "Reconnection fee"],
      },
      {
        href: "/water/reports",
        label: "Water reports",
        icon: ChartColumn,
        status: "live",
        permission: ["water.bill", "water.review_readings", "water.adjust_approve", "water.disconnect", "reports.read"],
        phase: "07",
        summary: "Billing, collection, aging and consumption reports.",
        features: ["Billing and collection summaries", "Receivable aging per zone", "Consumption and non-revenue water"],
      },
      {
        href: "/reader",
        label: "Meter reading app",
        icon: Smartphone,
        status: "soon",
        phase: "06",
        summary: "Offline phone app for meter readers (assigned routes only).",
        features: ["Works without signal; syncs later", "Shows only the reader's assigned routes", "Flags unusual readings on the spot"],
      },
    ],
  },
  {
    title: "Members",
    icon: IdCard,
    items: [
      {
        href: "/members",
        label: "Member registry",
        icon: IdCard,
        status: "live",
        permission: "members.read",
        phase: "02",
        summary: "Members, beneficiaries and membership status.",
        features: ["Search members", "Profile with beneficiaries", "Sensitive data masked unless permitted"],
      },
      {
        href: "/members/applications",
        label: "Membership applications",
        icon: UserPlus,
        status: "live",
        permission: "members.approve",
        phase: "02",
        summary: "Applicants through PMES and Board approval.",
        features: ["Application form with duplicate check", "PMES attendance", "Board approval queue"],
      },
      {
        href: "/share",
        label: "Share capital & CBU",
        icon: Landmark,
        status: "soon",
        phase: "08",
        summary: "Subscriptions, payments, transfers and the member share ledger.",
        features: ["Subscriptions and paid-up capital", "Share transfers and withdrawals", "Member share ledger"],
      },
    ],
  },
  {
    title: "Savings & Loans",
    icon: PiggyBank,
    items: [
      {
        href: "/savings",
        label: "Savings accounts",
        icon: PiggyBank,
        status: "soon",
        phase: "09",
        summary: "Deposit accounts, deposits and withdrawals.",
        features: ["Open and close accounts", "Deposits and withdrawals at the teller", "Dormancy tracking"],
      },
      {
        href: "/savings/time-deposits",
        label: "Time deposits",
        icon: CalendarCheck,
        status: "soon",
        phase: "09",
        summary: "Placements, maturities and pre-terminations.",
      },
      {
        href: "/savings/interest",
        label: "Interest runs",
        icon: Percent,
        status: "soon",
        phase: "09",
        summary: "Quarterly savings interest: preview, then post.",
      },
      {
        href: "/loans/applications",
        label: "Loan applications",
        icon: HandCoins,
        status: "soon",
        phase: "10",
        summary: "Eligibility, approval matrix and disclosure statements.",
        features: ["Eligibility check", "Manager / Credit Committee approval", "Disclosure statement"],
      },
      {
        href: "/loans/calculator",
        label: "Loan calculator",
        icon: Calculator,
        status: "soon",
        phase: "10",
        summary: "Amortization schedules and net proceeds.",
      },
      {
        href: "/loans/products",
        label: "Loan products",
        icon: Package,
        status: "soon",
        phase: "10",
        summary: "Rates, terms and deductions per product.",
      },
      {
        href: "/loans/servicing",
        label: "Releases & collections",
        icon: Banknote,
        status: "soon",
        phase: "11",
        summary: "Loan release with deductions, payments and penalties.",
      },
      {
        href: "/loans/aging",
        label: "Aging & PAR",
        icon: TrendingUp,
        status: "soon",
        phase: "11",
        summary: "Portfolio at risk, aging buckets and delinquency list.",
      },
    ],
  },
  {
    title: "Cashiering",
    icon: Wallet,
    items: [
      {
        href: "/cashiering/teller",
        label: "Teller counter",
        icon: Receipt,
        status: "live",
        permission: "cash.session",
        phase: "04",
        summary: "One receipt for water bills, shares, savings and loans.",
        features: ["Teller session with opening cash", "Many items on one receipt", "Cash count and manager verification"],
      },
      {
        href: "/cashiering/sessions",
        label: "Teller sessions",
        icon: CalendarCheck,
        status: "live",
        permission: ["cash.verify", "cash.cancel"],
        phase: "04",
        summary: "Verify closed sessions and post cash short/over.",
      },
      {
        href: "/cashiering/vouchers",
        label: "Disbursement vouchers",
        icon: FileText,
        status: "live",
        permission: ["cash.dv_prepare", "cash.dv_approve", "cash.session"],
        phase: "04",
        summary: "Prepare and approve cash-out vouchers.",
      },
      {
        href: "/cashiering/cash-position",
        label: "Daily cash position",
        icon: Wallet,
        status: "live",
        permission: ["cash.verify", "gl.read"],
        phase: "04",
        summary: "Cash in, cash out and balances per day.",
      },
    ],
  },
  {
    title: "Store",
    icon: Store,
    items: [
      { href: "/store/pos", label: "Point of sale", icon: ShoppingCart, status: "soon", phase: "13", summary: "Cash and charge-to-member sales, returns and Z-reading." },
      { href: "/store/inventory", label: "Products & inventory", icon: Package, status: "soon", phase: "12", summary: "Products, prices, moving-average cost and stock counts." },
      { href: "/store/purchasing", label: "Purchasing", icon: Truck, status: "soon", phase: "12", summary: "Purchase orders, receiving and supplier payables." },
      { href: "/store/charges", label: "Member charges", icon: Coins, status: "soon", phase: "13", summary: "Member charge accounts and statements." },
    ],
  },
  {
    title: "Accounting",
    icon: BookOpen,
    items: [
      { href: "/accounting/journals", label: "Journal vouchers", icon: BookOpen, status: "live", phase: "03", permission: "gl.read", summary: "Draft, approve, post and reverse journal vouchers." },
      { href: "/accounting/ledger", label: "Ledger & trial balance", icon: Scale, status: "live", phase: "03", permission: "gl.read", summary: "General ledger, trial balance and books of account." },
      { href: "/accounting/coa", label: "Chart of accounts", icon: ClipboardList, status: "live", phase: "03", permission: "gl.read", summary: "CDA standard chart of accounts." },
      { href: "/accounting/statements", label: "Financial statements", icon: FileSpreadsheet, status: "soon", phase: "14", summary: "PFRF-for-Cooperatives statements by business line." },
      { href: "/accounting/close", label: "Period close", icon: CalendarCheck, status: "soon", phase: "14", summary: "Month-end and year-end close checklist." },
      { href: "/accounting/fixed-assets", label: "Fixed assets", icon: Building2, status: "soon", phase: "14", summary: "Asset register and depreciation runs." },
      { href: "/year-end/surplus", label: "Net surplus allocation", icon: Percent, status: "soon", phase: "15", summary: "Statutory funds, interest on share capital and patronage refund." },
    ],
  },
  {
    title: "Reports",
    icon: ChartColumn,
    items: [
      { href: "/reports/cda", label: "CDA reports", icon: FileSpreadsheet, status: "soon", phase: "16", summary: "CAPR and annex extracts in the CDA templates." },
      { href: "/reports/management", label: "Management dashboard", icon: ChartColumn, status: "soon", phase: "16", summary: "KPIs across water, credit, store and cash." },
      { href: "/reports/statements", label: "Member statements", icon: FileText, status: "soon", phase: "16", summary: "Statement of account per member." },
    ],
  },
  {
    title: "Administration",
    icon: Settings,
    items: [
      { href: "/admin/users", label: "Users", icon: Users, status: "live", phase: "01", permission: "admin.users", summary: "Staff accounts, roles and passwords." },
      { href: "/admin/roles", label: "Roles & permissions", icon: ShieldCheck, status: "live", phase: "01", permission: "admin.users", summary: "Which role can do what." },
      { href: "/admin/settings", label: "Coop settings", icon: Settings, status: "live", phase: "01", permission: "admin.settings", summary: "Coop profile, rates, limits and policies." },
      { href: "/admin/audit", label: "Audit log", icon: ScrollText, status: "live", phase: "01", permission: "audit.read", summary: "Every change, sign-in and denied action." },
      { href: "/admin/migration", label: "Data migration", icon: Database, status: "soon", phase: "17", summary: "Import existing records and opening balances." },
      { href: "/admin/backups", label: "Backups", icon: Archive, status: "soon", phase: "18", summary: "Backup status and restore drills." },
    ],
  },
  {
    title: "System",
    icon: HeartPulse,
    items: [{ href: "/health", label: "System health", icon: HeartPulse, status: "live", phase: "00", summary: "App version, database and business date." }],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

/** The planned (not yet built) item for a path, if any. */
export function comingSoonItem(path: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((i) => i.status === "soon" && i.href === path);
}

/**
 * The hrefs a user may see. Live items need their permission; coming-soon items are visible to
 * every signed-in user (they show no data and allow no actions).
 */
export function visibleHrefs(permissions: ReadonlySet<string>): string[] {
  const allowed = (p: NavItem["permission"]) => !p || (Array.isArray(p) ? p.some((x) => permissions.has(x)) : permissions.has(p));
  return ALL_NAV_ITEMS.filter((i) => i.status === "soon" || allowed(i.permission)).map((i) => i.href);
}
