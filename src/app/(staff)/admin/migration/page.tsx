import type { Metadata } from "next";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { addDays, businessToday, formatDate, formatDateTime } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPageAny } from "@/lib/page-guard";
import { batchErrors, listBatches, migrationCutoff, openingEntry, reconciliation, STATUS_LABEL } from "@/modules/migration/service";
import { MIGRATION_ENTITIES, TEMPLATES } from "@/modules/migration/templates";
import { BatchButtons, UploadForm } from "@/modules/migration/ui/forms";
import { PostForm } from "@/modules/migration/ui/post-form";

export const metadata: Metadata = { title: "Data migration · PCMPC MIS" };

/** The last month end before today: the usual cut-off (go-live on the 1st). */
function lastMonthEnd(today: string): string {
  return addDays(`${today.slice(0, 7)}-01`, -1);
}

async function MigrationContent() {
  const access = await guardPageAny(["migration.import", "migration.post"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const canImport = can(access.user, "migration.import");
  const canPost = can(access.user, "migration.post");
  const cutoff = await migrationCutoff();
  const batches = await listBatches();
  const rec = cutoff ? await reconciliation(cutoff) : null;
  const withErrors = batches.filter((b) => b.status === "UPLOADED" && b.errorCount > 0).slice(0, 3);
  const errors = await Promise.all(withErrors.map(async (b) => ({ batch: b, errors: (await batchErrors(b.id)).slice(0, 50) })));
  const nonZero = rec ? rec.rows.filter((r) => r.tb !== 0n || r.subledger !== 0n) : [];
  const opening = rec?.posted ? await openingEntry() : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Data migration</h1>
        <p className="text-sm text-muted-foreground">
          Bring PCMPC&apos;s existing records into the MIS as of a cut-off date: download each template, fill it in, upload it (it is checked row by row; nothing is
          written yet), stage it, then post the opening balances once every control account agrees with the cut-off trial balance. The runbook is docs/CUTOVER.md.
        </p>
      </div>

      {rec?.posted ? (
        <Card>
          <CardHeader>
            <CardTitle>Opening balances posted</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            The books start from the opening entry {opening?.jeNo ?? ""} dated {formatDate(rec.cutoffDate)}; the months up to the cut-off are closed. Later corrections go through
            the regular screens.
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">Upload them in this order: the members first (the other files refer to them), the trial balance last.</p>
          <ol className="grid list-decimal gap-1 pl-5 sm:grid-cols-2">
            {MIGRATION_ENTITIES.map((e) => (
              <li key={e}>
                <a className="underline underline-offset-2" href={`/api/migration/templates/${e}`} download>
                  {TEMPLATES[e].title} template
                </a>
                <span className="text-muted-foreground"> · {TEMPLATES[e].purpose.split(". ")[0]}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {canImport && !rec?.posted ? (
        <Card>
          <CardHeader>
            <CardTitle>Upload a file</CardTitle>
          </CardHeader>
          <CardContent>
            <UploadForm entities={MIGRATION_ENTITIES.map((e) => ({ value: e, title: TEMPLATES[e].title }))} cutoff={cutoff ?? lastMonthEnd(businessToday())} cutoffFixed={!!cutoff} />
          </CardContent>
        </Card>
      ) : null}

      <h2 className="text-lg font-semibold">Files</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Records</TableHead>
            <TableHead>File</TableHead>
            <TableHead>Cut-off</TableHead>
            <TableHead>Uploaded</TableHead>
            <TableHead className="text-right">Rows</TableHead>
            <TableHead>Problems</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                No files uploaded yet.
              </TableCell>
            </TableRow>
          ) : null}
          {batches.map((b) => (
            <TableRow key={b.id}>
              <TableCell>{TEMPLATES[b.entity].title}</TableCell>
              <TableCell className="max-w-48 truncate" title={b.fileName}>
                {b.fileName}
              </TableCell>
              <TableCell className="tabular-nums">{formatDate(b.cutoffDate)}</TableCell>
              <TableCell className="text-xs">
                {formatDateTime(b.createdAt)} · {b.uploadedBy}
              </TableCell>
              <TableCell className="text-right tabular-nums">{b.rowCount}</TableCell>
              <TableCell>
                {b.errorCount === 0 ? (
                  <span className="text-muted-foreground">No errors</span>
                ) : (
                  <a className="text-destructive underline underline-offset-2" href={`/api/migration/batches/${b.id}/errors`} download>
                    {b.errorCount} error{b.errorCount === 1 ? "" : "s"}
                  </a>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={b.status === "POSTED" || b.status === "STAGED" ? "default" : "outline"}>{STATUS_LABEL[b.status]}</Badge>
              </TableCell>
              <TableCell>
                {canImport && ["UPLOADED", "VALIDATED", "STAGED"].includes(b.status) ? (
                  <BatchButtons batchId={b.id} fileName={b.fileName} canStage={b.status === "VALIDATED"} canRollBack />
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {errors.map(({ batch, errors: list }) => (
        <Card key={batch.id}>
          <CardHeader>
            <CardTitle>
              Problems in {batch.fileName} ({TEMPLATES[batch.entity].title})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 text-right">Row</TableHead>
                  <TableHead>Column</TableHead>
                  <TableHead>Problem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((e, i) => (
                  <TableRow key={`${e.row}-${e.column}-${i}`}>
                    <TableCell className="text-right tabular-nums">{e.row}</TableCell>
                    <TableCell>{e.column}</TableCell>
                    <TableCell>{e.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {batch.errorCount > list.length ? <p className="mt-2 text-sm text-muted-foreground">The first {list.length} are shown; download the error list for all {batch.errorCount}.</p> : null}
          </CardContent>
        </Card>
      ))}

      {rec ? (
        <>
          <h2 className="text-lg font-semibold">Reconciliation</h2>
          <p className="text-sm text-muted-foreground">
            As of {formatDate(rec.cutoffDate)}: each control account in the trial balance next to the total of its {rec.posted ? "posted" : "staged"} records. Trial balance totals:
            debits {format(rec.tbDebit)}, credits {format(rec.tbCredit)}.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Trial balance</TableHead>
                <TableHead className="text-right">Subsidiary records</TableHead>
                <TableHead className="text-right">Difference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nonZero.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                    Nothing staged on a control account yet.
                  </TableCell>
                </TableRow>
              ) : null}
              {nonZero.map((r) => (
                <TableRow key={r.accountId}>
                  <TableCell>
                    <span className="font-mono text-xs">{r.code}</span> {r.name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{format(r.tb)}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(r.subledger)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${r.difference === 0n ? "" : "font-semibold text-destructive"}`}>{format(r.difference)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rec.blockers.length ? (
            <div className="rounded-md border border-destructive/40 p-3 text-sm">
              <p className="font-medium">Before posting:</p>
              <ul className="list-disc pl-5">
                {rec.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {rec.posted ? null : <PostForm cutoff={rec.cutoffDate} cutoffLabel={formatDate(rec.cutoffDate)} canPost={rec.canPost} allowed={canPost} />}
        </>
      ) : null}
    </div>
  );
}

export default function MigrationPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <MigrationContent />
    </Suspense>
  );
}
