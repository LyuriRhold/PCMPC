import { connection } from "next/server";
import { businessToday, formatDate } from "@/lib/dates";

/** Today's Manila business date, computed per request (never baked into the static shell). */
export async function BusinessDateLabel() {
  await connection();
  return (
    <span className="text-sm tabular-nums text-muted-foreground" data-testid="topbar-business-date">
      Business date: <span className="font-medium text-foreground">{formatDate(businessToday())}</span>
    </span>
  );
}
