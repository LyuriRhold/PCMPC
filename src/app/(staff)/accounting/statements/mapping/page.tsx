import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { guardPage } from "@/lib/page-guard";
import { mappingView, unmappedAccounts } from "@/modules/accounting/statements";
import { MapAccountForm, SegmentForm } from "@/modules/accounting/ui/forms";

export const metadata: Metadata = { title: "Statement mapping · PCMPC MIS" };

async function MappingContent() {
  const access = await guardPage("gl.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const canEdit = can(access.user, "gl.coa");
  const [view, unmapped] = await Promise.all([mappingView(), unmappedAccounts()]);
  const options = (statement: "SFC" | "SOO") => view.lines.filter((l) => l.line.statement === statement && !l.line.computed).map((l) => ({ id: l.line.id, label: l.line.caption }));
  const segments = view.segments.map((s) => ({ id: s.code, label: s.name }));
  const isSfc = (type: string) => ["ASSET", "LIABILITY", "EQUITY"].includes(type);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/accounting/statements" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Financial statements
        </Link>
        <h1 className="text-2xl font-semibold">Statement mapping</h1>
        <p className="text-sm text-muted-foreground">
          Every postable account rolls into one statement line: assets, liabilities and equity on the Statement of Financial Condition; revenues and expenses on the Statement of Operations, each in a business
          segment. The statements don&apos;t run while an account is unmapped.
        </p>
      </div>

      {unmapped.length ? (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle>Not mapped yet ({unmapped.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                {unmapped.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs">{a.code}</TableCell>
                    <TableCell>{a.name}</TableCell>
                    <TableCell>{canEdit ? <MapAccountForm accountId={a.id} label={`${a.code} ${a.name}`} lines={options(isSfc(a.type) ? "SFC" : "SOO")} current={null} /> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm">Every postable account is mapped.</p>
      )}

      {view.lines.map(({ line, accounts }) => (
        <Card key={line.id}>
          <CardHeader>
            <CardTitle className="text-base">
              {line.caption} <span className="font-mono text-xs font-normal text-muted-foreground">{line.statement === "SFC" ? "Financial condition" : "Operations"}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {line.computed ? (
              <p className="text-sm text-muted-foreground">Computed: revenues less expenses not yet closed into Undivided Net Surplus.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    {canEdit ? <TableHead>Move to</TableHead> : null}
                    {line.statement === "SOO" ? <TableHead>Segment</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-sm text-muted-foreground">
                        No accounts.
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {accounts.map((a) => (
                    <TableRow key={a.accountId}>
                      <TableCell>
                        <span className="font-mono text-xs">{a.code}</span> {a.name}
                      </TableCell>
                      {canEdit ? (
                        <TableCell>
                          <MapAccountForm accountId={a.accountId} label={`${a.code} ${a.name}`} lines={options(line.statement)} current={line.id} />
                        </TableCell>
                      ) : null}
                      {line.statement === "SOO" ? (
                        <TableCell>{canEdit ? <SegmentForm accountId={a.accountId} label={`${a.code} ${a.name}`} segments={segments} current={a.segment ?? "GENERAL"} /> : (a.segment ?? "GENERAL")}</TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function MappingPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <MappingContent />
    </Suspense>
  );
}
