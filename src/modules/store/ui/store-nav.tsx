import Link from "next/link";

const TABS = {
  inventory: [
    { href: "/store/inventory", label: "Products" },
    { href: "/store/inventory/categories", label: "Categories" },
    { href: "/store/inventory/counts", label: "Stock counts" },
    { href: "/store/inventory/valuation", label: "Valuation" },
    { href: "/store/inventory/reorder", label: "Reorder list" },
  ],
  purchasing: [
    { href: "/store/purchasing", label: "Purchase orders" },
    { href: "/store/purchasing/receiving", label: "Receiving" },
    { href: "/store/purchasing/suppliers", label: "Suppliers" },
    { href: "/store/purchasing/payables", label: "Payables" },
  ],
} as const;

/** The store pages' tabs (Products & inventory, Purchasing). */
export function StoreTabs({ section, current }: { section: keyof typeof TABS; current: string }) {
  return (
    <nav aria-label={section === "inventory" ? "Inventory pages" : "Purchasing pages"} className="flex flex-wrap gap-1 border-b">
      {TABS[section].map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === current ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${t.href === current ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** A 4-decimal peso unit cost ("1200.0000" → "₱1,200.0000"); string-only, no float. */
export function formatCost4(cost: string): string {
  const [int = "0", frac = ""] = cost.split(".");
  const neg = int.startsWith("-");
  const digits = neg ? int.slice(1) : int;
  return `${neg ? "-" : ""}₱${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac.padEnd(4, "0").slice(0, 4)}`;
}
