import { registerDailyJob } from "@/lib/cron";
import { markDormant } from "./service";

/** Daily jobs of the savings module (PHASE-09 T9.5), run by /api/cron/daily once per business date. */
registerDailyJob({ name: "savings-dormancy", run: (tx, date) => markDormant(tx, date) });
