import { Badge } from "@/components/ui/badge";
import type { Permission } from "@/modules/auth/permissions";

/** Anyone working the water front office may view these pages; changes need the specific permission. */
export const WATER_STAFF: Permission[] = ["water.customers", "water.apply", "water.approve", "water.install", "water.rates"];

const TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  ACTIVE: "default",
  APPROVED: "default",
  INSTALLED: "secondary",
  PENDING: "outline",
  APPLIED: "outline",
  INSPECTED: "outline",
  IN_STOCK: "outline",
  DISCONNECTED: "destructive",
  REJECTED: "destructive",
  DEFECTIVE: "destructive",
  CLOSED: "secondary",
  RETIRED: "secondary",
};

export function WaterStatusBadge({ status }: { status: string }) {
  return <Badge variant={TONE[status] ?? "outline"}>{status}</Badge>;
}
