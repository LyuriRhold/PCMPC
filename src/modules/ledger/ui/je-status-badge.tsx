import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STYLE: Record<string, string> = {
  DRAFT: "border-amber-500/50 text-amber-700",
  POSTED: "border-green-600/40 text-green-700",
  REVERSED: "border-red-500/40 text-red-700",
};

export function JeStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn(STYLE[status])}>
      {status}
    </Badge>
  );
}
