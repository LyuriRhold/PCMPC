import type { Metadata } from "next";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { businessToday, formatDate } from "@/lib/dates";
import { format } from "@/lib/money";
import { guardPage } from "@/lib/page-guard";
import { listAssetClasses, listAssets, listDepreciationRuns } from "@/modules/accounting/assets";
import { AssetForm, DepreciationRunForm } from "@/modules/accounting/ui/forms";

export const metadata: Metadata = { title: "Fixed assets · PCMPC MIS" };

async function AssetsContent() {
  const access = await guardPage("gl.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const [assets, classes, runs] = await Promise.all([listAssets(), listAssetClasses(), listDepreciationRuns()]);
  const totals = assets.reduce((s, a) => ({ cost: s.cost + a.asset.cost, accumulated: s.accumulated + a.asset.accumulated, book: s.book + a.bookValue }), { cost: 0n, accumulated: 0n, book: 0n });
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Fixed assets</h1>
        <p className="text-sm text-muted-foreground">
          The register of property and equipment. Buying an asset is posted by its voucher (to the class&apos;s property and equipment account); here it is depreciated straight-line each month, from the
          month it was acquired, down to its salvage value.
        </p>
      </div>
      {can(access.user, "gl.coa") ? (
        <Card>
          <CardHeader>
            <CardTitle>Add an asset</CardTitle>
          </CardHeader>
          <CardContent>
            <AssetForm classes={classes.filter((c) => c.isActive).map((c) => ({ code: c.code, name: c.name, life: c.defaultLifeMonths }))} />
          </CardContent>
        </Card>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tag</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Class</TableHead>
            <TableHead>Acquired</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">Life</TableHead>
            <TableHead className="text-right">Accumulated</TableHead>
            <TableHead className="text-right">Book value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assets.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                No assets in the register yet.
              </TableCell>
            </TableRow>
          ) : null}
          {assets.map(({ asset: a, className, bookValue }) => (
            <TableRow key={a.id}>
              <TableCell className="font-mono text-xs">{a.tag}</TableCell>
              <TableCell>
                {a.description}
                {a.status === "FULLY_DEPRECIATED" ? (
                  <Badge variant="secondary" className="ml-2">
                    Fully depreciated
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell>{className}</TableCell>
              <TableCell className="tabular-nums">{formatDate(a.acquisitionDate)}</TableCell>
              <TableCell className="text-right tabular-nums">{format(a.cost)}</TableCell>
              <TableCell className="text-right tabular-nums">{a.lifeMonths} mo</TableCell>
              <TableCell className="text-right tabular-nums">{format(a.accumulated)}</TableCell>
              <TableCell className="text-right tabular-nums">{format(bookValue)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={4}>Total</TableCell>
            <TableCell className="text-right tabular-nums">{format(totals.cost)}</TableCell>
            <TableCell />
            <TableCell className="text-right tabular-nums">{format(totals.accumulated)}</TableCell>
            <TableCell className="text-right tabular-nums">{format(totals.book)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      <Card>
        <CardHeader>
          <CardTitle>Depreciation runs</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {can(access.user, "gl.close") ? <DepreciationRunForm defaultPeriod={businessToday().slice(0, 7)} /> : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Depreciation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-sm text-muted-foreground">
                    No runs yet.
                  </TableCell>
                </TableRow>
              ) : null}
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="tabular-nums">{r.period}</TableCell>
                  <TableCell className="text-right tabular-nums">{format(r.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AssetsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <AssetsContent />
    </Suspense>
  );
}
