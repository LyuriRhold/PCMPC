import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/auth-guard";
import { formatDate, formatDateTime, isBusinessDate } from "@/lib/dates";
import { guardPage } from "@/lib/page-guard";
import { cn } from "@/lib/utils";
import { allowedStatusTargets, getMemberProfile } from "@/modules/members/service";
import { ApprovePanel, BeneficiariesEditor, StatusChangeForm } from "@/modules/members/ui/profile-panels";
import { MemberStatusBadge } from "@/modules/members/ui/status-badge";

export const metadata: Metadata = { title: "Member · PCMPC MIS" };

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "beneficiaries", label: "Beneficiaries" },
  { id: "history", label: "Status history" },
] as const;

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[11rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

const date = (d: string | null) => (d && isBusinessDate(d) ? formatDate(d) : d);

async function MemberContent(props: PageProps<"/members/[id]">) {
  const access = await guardPage("members.read");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sp = await props.searchParams;
  const tab = TABS.find((t) => t.id === sp.tab)?.id ?? "profile";
  const approvedNo = typeof sp.approved === "string" && /^M-\d+$/.test(sp.approved) ? sp.approved : null;

  const profile = await getMemberProfile(id, can(access.user, "members.read_sensitive"));
  if (!profile) notFound();
  const { member: m, beneficiaries, history } = profile;
  const canWrite = can(access.user, "members.write");
  const canApprove = can(access.user, "members.approve");
  const terminal = m.status === "TERMINATED" || m.status === "DECEASED";
  const fullName = `${m.lastName}, ${m.firstName}${m.middleName ? ` ${m.middleName}` : ""}${m.suffix ? ` ${m.suffix}` : ""}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/members" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Member registry
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{fullName}</h1>
          <MemberStatusBadge status={m.status} />
          <span className="font-mono text-sm text-muted-foreground">{m.memberNo ?? "no member no. yet"}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {m.type === "REGULAR" ? "Regular" : "Associate"} member
          {m.membershipDate ? ` · member since ${formatDate(m.membershipDate)}` : ""}
        </p>
      </div>

      {approvedNo ? (
        <p role="status" className="rounded-lg border border-green-600/40 bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950/30">
          Approved as {approvedNo}. The member is now ACTIVE.
        </p>
      ) : null}

      {m.status === "APPLICANT" && canApprove ? (
        <ApprovePanel memberId={m.id} pmesDate={m.pmesDate} bodResolutionNo={m.bodResolutionNo} hasConsent={!!m.privacyConsentAt} />
      ) : null}

      <nav aria-label="Member sections" className="flex gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/members/${m.id}?tab=${t.id}`}
            aria-current={tab === t.id ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              tab === t.id ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.id === "beneficiaries" ? ` (${beneficiaries.length})` : ""}
          </Link>
        ))}
      </nav>

      {tab === "profile" ? (
        <div className="flex flex-col gap-4">
          {canWrite && !terminal ? (
            <div>
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/members/${m.id}/edit`} />}>
                Edit details
              </Button>
            </div>
          ) : null}
          <div className="grid gap-6 lg:grid-cols-2">
            <dl className="divide-y rounded-lg border px-4 py-2">
              <Row label="Birthdate" value={date(m.birthdate)} />
              <Row label="Sex" value={m.sex} />
              <Row label="Civil status" value={m.civilStatus} />
              <Row label="Occupation" value={m.occupation} />
              <Row label="Employer / business" value={m.employer} />
              <Row label="TIN" value={m.tin} />
              <Row label="Valid ID" value={m.validIdType ? `${m.validIdType}${m.validIdNo ? ` · ${m.validIdNo}` : ""}` : null} />
            </dl>
            <dl className="divide-y rounded-lg border px-4 py-2">
              <Row
                label="Address"
                value={[m.addrStreet, m.addrPurok, m.addrBarangay, m.addrMunicipality, m.addrProvince].filter(Boolean).join(", ")}
              />
              <Row label="Mobile" value={m.mobile} />
              <Row label="E-mail" value={m.email} />
              <Row label="PMES date" value={date(m.pmesDate)} />
              <Row label="BOD resolution" value={m.bodResolutionNo} />
              <Row label="Approved" value={m.approvedAt ? formatDateTime(m.approvedAt) : null} />
              <Row label="Privacy consent" value={m.privacyConsentAt ? `Given ${formatDateTime(m.privacyConsentAt)}` : "Not yet given"} />
              <Row label="Remarks" value={m.remarks} />
            </dl>
          </div>
          {!can(access.user, "members.read_sensitive") ? (
            <p className="text-xs text-muted-foreground">
              Birthdate, ID no., TIN and mobile are partly hidden for your role (Data Privacy Act).
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === "beneficiaries" ? (
        canWrite && !terminal ? (
          <BeneficiariesEditor
            memberId={m.id}
            initial={beneficiaries.map((b) => ({ name: b.name, relationship: b.relationship, birthdate: b.birthdate, sharePct: b.sharePct }))}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Relationship</TableHead>
                <TableHead>Birthdate</TableHead>
                <TableHead className="text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {beneficiaries.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>{b.name}</TableCell>
                  <TableCell>{b.relationship}</TableCell>
                  <TableCell>{date(b.birthdate) ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{b.sharePct}%</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      ) : null}

      {tab === "history" ? (
        <div className="flex flex-col gap-4">
          {canApprove && m.status !== "APPLICANT" ? (
            <section className="flex flex-col gap-2 rounded-lg border p-4">
              <h2 className="text-sm font-semibold">Change status</h2>
              <StatusChangeForm memberId={m.id} targets={allowedStatusTargets(m.status)} />
            </section>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When (Manila)</TableHead>
                <TableHead>From → to</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No status changes yet.
                  </TableCell>
                </TableRow>
              ) : null}
              {history.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="tabular-nums">{formatDateTime(h.at)}</TableCell>
                  <TableCell className="text-xs">
                    {h.fromStatus} → {h.toStatus}
                  </TableCell>
                  <TableCell>{h.reason}</TableCell>
                  <TableCell>{h.ref ?? "—"}</TableCell>
                  <TableCell>{h.byUsername ?? "system"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

export default function MemberPage(props: PageProps<"/members/[id]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <MemberContent {...props} />
    </Suspense>
  );
}
