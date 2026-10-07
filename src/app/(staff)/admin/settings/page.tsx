import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/dates";
import { format as formatMoney } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { fractionToPercent } from "@/lib/rates";
import { SETTINGS, type SettingKind } from "@/modules/settings/registry";
import { listSettings } from "@/modules/settings/service";
import { SettingEditor } from "@/modules/settings/ui/setting-editor";

export const metadata: Metadata = { title: "Coop settings · PCMPC MIS" };

function display(kind: SettingKind, value: unknown): string {
  if (value === null || value === undefined) return "(not seeded)";
  switch (kind) {
    case "money":
      return formatMoney(BigInt(String(value)));
    case "rate":
      return `${fractionToPercent(String(value))}%`;
    case "bool":
      return value ? "Yes" : "No";
    case "json":
      return JSON.stringify(value, null, 2);
    default:
      return String(value);
  }
}

/** The value as the person edits it: pesos without the sign, percent, JSON text. */
function editText(kind: SettingKind, value: unknown): string {
  if (value === null || value === undefined) return "";
  switch (kind) {
    case "money":
      return formatMoney(BigInt(String(value))).replace("₱", "").replaceAll(",", "");
    case "rate":
      return fractionToPercent(String(value));
    case "bool":
      return value ? "true" : "false";
    case "json":
      return JSON.stringify(value, null, 2);
    default:
      return String(value);
  }
}

function enumOptions(schema: z.ZodType): string[] | null {
  if (schema instanceof z.ZodEnum) return schema.options.map(String);
  if (schema instanceof z.ZodLiteral) return [...schema.values].map(String);
  return null;
}

async function SettingsContent() {
  const access = await guardPage("admin.settings");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const rows = await listSettings();
  const groups = [...new Set(rows.map((r) => r.group))];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Coop settings</h1>
        <p className="text-sm text-muted-foreground">
          Profile, rates, limits and policies. Values marked <Badge variant="secondary">CONFIRM</Badge> are working
          defaults from DOMAIN.md that PCMPC has not confirmed yet. Every change is kept in the history and the audit log.
        </p>
      </div>
      {groups.map((group) => (
        <section key={group} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{group}</h2>
          <div className="divide-y rounded-lg border">
            {rows
              .filter((r) => r.group === group)
              .map((r) => {
                const kind = r.kind as SettingKind;
                const options = enumOptions(SETTINGS[r.key].schema);
                const fixed = options !== null && options.length < 2;
                return (
                  <div key={r.key} className="grid gap-3 p-3 md:grid-cols-[1fr_1fr_auto] md:items-start">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        {r.label} {r.confirm ? <Badge variant="secondary">CONFIRM</Badge> : null}
                      </span>
                      <code className="text-xs text-muted-foreground">{r.key}</code>
                      {r.note ? <span className="text-xs text-muted-foreground">{r.note}</span> : null}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {kind === "json" ? (
                        <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{display(kind, r.value)}</pre>
                      ) : (
                        <span className="text-sm tabular-nums" data-testid={`setting-${r.key}`}>
                          {display(kind, r.value)}
                        </span>
                      )}
                      {r.updatedAt ? (
                        <span className="text-xs text-muted-foreground">updated {formatDateTime(r.updatedAt)}</span>
                      ) : null}
                    </div>
                    <div>
                      {fixed ? (
                        <span className="text-xs text-muted-foreground">fixed</span>
                      ) : (
                        <SettingEditor
                          settingKey={r.key}
                          kind={kind}
                          initial={editText(kind, r.value)}
                          options={options ?? undefined}
                        />
                      )}
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
