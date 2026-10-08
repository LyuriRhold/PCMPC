import type { LucideIcon } from "lucide-react";
import { HeartPulse, House, ScrollText, Settings, ShieldCheck, Users } from "lucide-react";
import type { Permission } from "@/modules/auth/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown only to users holding this permission (pages re-check it on the server). */
  permission?: Permission;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

/**
 * Sidebar entries. A module is listed here only once its phase has shipped,
 * so staff never see links to screens that do not exist yet.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: "General",
    items: [{ href: "/", label: "Dashboard", icon: House }],
  },
  {
    title: "Administration",
    items: [
      { href: "/admin/users", label: "Users", icon: Users, permission: "admin.users" },
      { href: "/admin/roles", label: "Roles & permissions", icon: ShieldCheck, permission: "admin.users" },
      { href: "/admin/settings", label: "Coop settings", icon: Settings, permission: "admin.settings" },
      { href: "/admin/audit", label: "Audit log", icon: ScrollText, permission: "audit.read" },
    ],
  },
  {
    title: "System",
    items: [{ href: "/health", label: "System health", icon: HeartPulse }],
  },
];

/** The hrefs a user may see, given their permission codes. */
export function visibleHrefs(permissions: ReadonlySet<string>): string[] {
  return NAV_SECTIONS.flatMap((s) => s.items)
    .filter((i) => !i.permission || permissions.has(i.permission))
    .map((i) => i.href);
}
