import { registerDailyJob } from "@/lib/cron";
import { assessPenalties } from "./collections";

// Water's daily jobs (PHASE-07 T7.3), run by /api/cron/daily once per Manila business date.
registerDailyJob({ name: "water-penalties", run: (tx, date) => assessPenalties(tx, date) });
