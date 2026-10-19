import type { Metadata } from "next";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { businessToday, formatDate } from "@/lib/dates";
import { guardPageAny } from "@/lib/page-guard";
import { COMMITTEES } from "@/modules/governance/schema";
import { COMMITTEE_NAMES, listOfficers, listTrainings } from "@/modules/governance/service";
import { EndTermForm, OfficerForm, TrainingForm } from "@/modules/governance/ui/forms";

export const metadata: Metadata = { title: "Officers and trainings · PCMPC MIS" };

async function GovernanceContent() {
  const access = await guardPageAny(["reports.read", "members.read"]);
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const today = businessToday();
  const year = today.slice(0, 4);
  const [officers, trainings] = [await listOfficers(), await listTrainings(`${Number(year) - 1}-01-01`, today)];
  const edit = can(access.user, "members.write");
  const serving = (o: { termStart: string; termEnd: string | null }) => o.termStart <= today && (!o.termEnd || o.termEnd >= today);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Officers and trainings</h1>
        <p className="text-sm text-muted-foreground">The board, the committees and management with their terms, and the trainings they and other members attended. The CDA annual report lists them.</p>
      </div>
      {edit ? (
        <Card>
          <CardHeader>
            <CardTitle>Add an officer</CardTitle>
          </CardHeader>
          <CardContent>
            <OfficerForm committees={COMMITTEES.map((c) => ({ code: c, name: COMMITTEE_NAMES[c] }))} />
          </CardContent>
        </Card>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Board or committee</TableHead>
            <TableHead>Position</TableHead>
            <TableHead>Member</TableHead>
            <TableHead>Term</TableHead>
            <TableHead>Elected at the GA of</TableHead>
            {edit ? <TableHead /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {officers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={edit ? 6 : 5} className="text-center text-sm text-muted-foreground">
                No officers recorded yet.
              </TableCell>
            </TableRow>
          ) : null}
          {officers.map((o) => (
            <TableRow key={o.id}>
              <TableCell>{o.committeeName}</TableCell>
              <TableCell>
                {o.position}
                {serving(o) ? null : (
                  <Badge variant="outline" className="ml-2">
                    Past
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                <span className="font-mono text-xs">{o.memberNo}</span> {o.name}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatDate(o.termStart)} to {o.termEnd ? formatDate(o.termEnd) : "present"}
              </TableCell>
              <TableCell className="tabular-nums">{o.electedAtGa ? formatDate(o.electedAtGa) : "Appointed"}</TableCell>
              {edit ? <TableCell>{o.termEnd ? null : <EndTermForm officerId={o.id} label={`${o.position} ${o.name}`} />}</TableCell> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <h2 className="text-lg font-semibold">Trainings</h2>
      {edit ? (
        <Card>
          <CardHeader>
            <CardTitle>Record a training</CardTitle>
          </CardHeader>
          <CardContent>
            <TrainingForm />
          </CardContent>
        </Card>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Training</TableHead>
            <TableHead>Given by</TableHead>
            <TableHead className="text-right">Hours</TableHead>
            <TableHead>Attendees</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trainings.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                No trainings recorded since January {Number(year) - 1}.
              </TableCell>
            </TableRow>
          ) : null}
          {trainings.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="tabular-nums">{formatDate(t.heldOn)}</TableCell>
              <TableCell>{t.title}</TableCell>
              <TableCell>{t.provider}</TableCell>
              <TableCell className="text-right tabular-nums">{t.hours}</TableCell>
              <TableCell className="text-sm">{t.attendees.map((a) => `${a.memberNo} ${a.name}`).join("; ")}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function GovernancePage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <GovernanceContent />
    </Suspense>
  );
}
