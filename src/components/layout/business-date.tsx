import { businessToday, formatDate } from "@/lib/dates";

/** Today's Manila business date. Render it only inside request-time (dynamic) content. */
export function BusinessDateLabel() {
  return (
    <span className="hidden text-sm tabular-nums text-muted-foreground sm:inline" data-testid="topbar-business-date">
      Business date: <span className="font-medium text-foreground">{formatDate(businessToday())}</span>
    </span>
  );
}
