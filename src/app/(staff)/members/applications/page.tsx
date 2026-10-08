import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/dates";
import { guardPage } from "@/lib/page-guard";
import { searchMembers } from "@/modules/members/service";

export const metadata: Metadata = { title: "Membership applications · PCMPC MIS" };

async function ApplicationsContent() {
  const access = await guardPage("members.approve");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { rows, total } = await searchMembers({ status: "APPLICANT", pageSize: 100 });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Membership applications</h1>
        <p className="text-sm text-muted-foreground">
          Applicants waiting for PMES and Board approval ({total}). Open one to approve it.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Applicant</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Barangay</TableHead>
            <TableHead>Encoded</TableHead>
            <TableHead className="sr-only">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                No pending applications.
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="font-medium">
                {m.lastName}, {m.firstName}
                {m.middleName ? ` ${m.middleName}` : ""}
              </TableCell>
              <TableCell>
                <Badge variant="outline">{m.type}</Badge>
              </TableCell>
              <TableCell>{m.addrBarangay}</TableCell>
              <TableCell className="tabular-nums">{formatDateTime(m.createdAt)}</TableCell>
              <TableCell className="text-right">
                <Link href={`/members/${m.id}`} className="text-sm underline underline-offset-4">
                  Review
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function ApplicationsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ApplicationsContent />
    </Suspense>
  );
}
