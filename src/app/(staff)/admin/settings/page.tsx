import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/dates";
import { guardPage } from "@/lib/page-guard";
import { GROUP_HELP, PRESENTATION } from "@/modules/settings/presentation";
import { incomeAccountOptions, listSettings } from "@/modules/settings/service";
import { SettingEditor } from "@/modules/settings/ui/setting-editor";
import { describe } from "@/modules/settings/ui/value-format";

export const metadata: Metadata = { title: "Coop settings · PCMPC MIS" };

async function SettingsContent() {
  const access = await guardPage("admin.settings");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const [rows, accounts] = await Promise.all([listSettings(), incomeAccountOptions()]);
  const groups = [...new Set(rows.map((r) => r.group))];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Coop settings</h1>
        <p className="text-sm text-muted-foreground">
          The cooperative&apos;s rates, fees, limits and rules. Click <span className="font-medium">Change</span> next to a setting to edit it; every change is recorded with who made it and when.
        </p>
        <p className="text-sm text-muted-foreground">
          <Badge variant="secondary">To confirm</Badge> marks a starting value the cooperative hasn&apos;t confirmed yet. Please check these with the Board or the manager and
          change them if needed.
        </p>
      </div>
      {groups.map((group) => (
        <section key={group} className="flex flex-col gap-2">
          <div>
            <h2 className="text-lg font-semibold">{group}</h2>
            {GROUP_HELP[group] ? <p className="text-sm text-muted-foreground">{GROUP_HELP[group]}</p> : null}
          </div>
          <div className="divide-y rounded-lg border">
            {rows
              .filter((r) => r.group === group)
              .map((r) => {
                const p = PRESENTATION[r.key];
                return (
                  <div key={r.key} className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium">
                        {p.label} {r.confirm && !p.readonly ? <Badge variant="secondary">To confirm</Badge> : null}
                      </span>
                      <span className="text-xs text-muted-foreground">{p.help}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {p.readonly ? (
                        <p className="text-sm text-muted-foreground">
                          {p.readonly.reason}{" "}
                          {p.readonly.link ? (
                            <Link href={p.readonly.link.href} className="text-foreground underline underline-offset-4">
                              {p.readonly.link.label}
                            </Link>
                          ) : null}
                        </p>
                      ) : (
                        <>
                          <p className="whitespace-pre-line text-sm tabular-nums" data-testid={`setting-${r.key}`}>
                            {describe(p.spec, r.value, accounts)}
                          </p>
                          <SettingEditor settingKey={r.key} label={p.label} spec={p.spec} value={r.value} accounts={accounts} />
                        </>
                      )}
                      {r.changedBy && r.updatedAt ? (
                        <span className="text-xs text-muted-foreground">
                          Last changed {formatDateTime(r.updatedAt)} by {r.changedBy}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <SettingsContent />
    </Suspense>
  );
}
