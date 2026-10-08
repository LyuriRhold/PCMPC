import { businessToday, formatDate } from "@/lib/dates";

/** Today's Manila business date. Render it only inside request-time (dynamic) content. */
export function BusinessDateLabel() {
  return (
    <span className="text-sm tabular-nums text-muted-foreground" data-testid="topbar-business-date">
      Business date: <span className="font-medium text-foreground">{formatDate(businessToday())}</span>
    </span>
  );
}
