import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STYLE: Record<string, string> = {
  APPLICANT: "border-amber-500/50 text-amber-700",
  ACTIVE: "border-green-600/40 text-green-700",
  INACTIVE: "border-slate-400/60 text-slate-600",
  TERMINATED: "border-red-500/40 text-red-700",
  DECEASED: "border-slate-500/60 text-slate-700",
};

export function MemberStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn(STYLE[status])}>
      {status}
    </Badge>
  );
}
