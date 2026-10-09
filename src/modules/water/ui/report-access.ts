import type { Permission } from "@/modules/auth/permissions";

/** Who may open the water reports (and export them). */
export const WATER_REPORT_VIEWERS: Permission[] = ["water.bill", "water.review_readings", "water.adjust_approve", "water.disconnect", "reports.read"];
