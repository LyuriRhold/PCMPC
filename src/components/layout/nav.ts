import type { LucideIcon } from "lucide-react";
import { HeartPulse, House } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
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
    items: [{ href: "/", label: "Home", icon: House }],
  },
  {
    title: "System",
    items: [{ href: "/health", label: "System health", icon: HeartPulse }],
  },
];
