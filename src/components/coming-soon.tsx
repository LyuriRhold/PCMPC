import { Construction } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PHASES, type NavItem } from "@/components/layout/nav";

/** Shown for a planned screen whose phase hasn't shipped yet. It shows no data and allows no actions. */
export function ComingSoon({ item, section }: { item: NavItem; section: string }) {
  const Icon = item.icon;
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start gap-6 py-6">
      <div className="flex items-center gap-3">
        <span className="flex size-12 items-center justify-center rounded-xl bg-muted">
          <Icon className="size-6 text-muted-foreground" aria-hidden />
        </span>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{section}</p>
          <h1 className="text-2xl font-semibold">{item.label}</h1>
        </div>
      </div>

      <div className="flex w-full flex-col gap-3 rounded-xl border border-dashed p-6">
        <div className="flex items-center gap-2">
          <Construction className="size-5 text-amber-600" aria-hidden />
          <span className="font-medium">Coming soon: under construction</span>
          <Badge variant="secondary">Phase {item.phase}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          This screen is planned for <span className="font-medium text-foreground">Phase {item.phase}</span>
          {PHASES[item.phase] ? <>: {PHASES[item.phase]}</> : null}. It isn&apos;t running yet, so nothing here can be
          viewed or changed.
        </p>
        <p className="text-sm">{item.summary}</p>
        {item.features?.length ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">What it will do</p>
            <ul className="list-disc pl-5 text-sm text-muted-foreground">
              {item.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <Link href="/" className="text-sm underline underline-offset-4">
        ← Back to the dashboard
      </Link>
    </div>
  );
}
