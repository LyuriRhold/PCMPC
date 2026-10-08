import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { can } from "@/lib/auth-guard";
import { guardPage } from "@/lib/page-guard";
import { getMemberProfile } from "@/modules/members/service";
import { MemberForm } from "@/modules/members/ui/member-form";

export const metadata: Metadata = { title: "Edit member · PCMPC MIS" };

async function EditMemberContent(props: PageProps<"/members/[id]/edit">) {
  const access = await guardPage("members.write");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sensitive = can(access.user, "members.read_sensitive");
  const profile = await getMemberProfile(id, sensitive);
  if (!profile) notFound();
  const m = profile.member;
  if (m.status === "TERMINATED" || m.status === "DECEASED") {
    return <p className="text-sm text-muted-foreground">A {m.status} member&apos;s record can&apos;t be edited.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href={`/members/${m.id}`} className="text-sm text-muted-foreground underline underline-offset-4">
          ← {m.lastName}, {m.firstName}
        </Link>
        <h1 className="text-2xl font-semibold">Edit member details</h1>
      </div>
      <MemberForm
        mode="edit"
        memberId={m.id}
        isApplicant={m.status === "APPLICANT"}
        sensitiveLocked={!sensitive}
        initial={{
          type: m.type,
          lastName: m.lastName,
          firstName: m.firstName,
          middleName: m.middleName,
          suffix: m.suffix,
          birthdate: m.birthdate,
          sex: m.sex,
          civilStatus: m.civilStatus,
          addrStreet: m.addrStreet,
          addrPurok: m.addrPurok,
          addrBarangay: m.addrBarangay,
          addrMunicipality: m.addrMunicipality,
          addrProvince: m.addrProvince,
          mobile: m.mobile,
          email: m.email,
          occupation: m.occupation,
          employer: m.employer,
          tin: m.tin,
          validIdType: m.validIdType,
          validIdNo: m.validIdNo,
          pmesDate: m.pmesDate,
          bodResolutionNo: m.bodResolutionNo,
          privacyConsent: !!m.privacyConsentAt,
          remarks: m.remarks,
        }}
      />
    </div>
  );
}

export default function EditMemberPage(props: PageProps<"/members/[id]/edit">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <EditMemberContent {...props} />
    </Suspense>
  );
}
