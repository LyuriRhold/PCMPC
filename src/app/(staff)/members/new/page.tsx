import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { guardPage } from "@/lib/page-guard";
import { MemberForm } from "@/modules/members/ui/member-form";

export const metadata: Metadata = { title: "New membership application · PCMPC MIS" };

async function NewMemberContent() {
  const access = await guardPage("members.write");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href="/members" className="text-sm text-muted-foreground underline underline-offset-4">
          ← Member registry
        </Link>
        <h1 className="text-2xl font-semibold">New membership application</h1>
        <p className="text-sm text-muted-foreground">
          The applicant is saved as APPLICANT. A member number is assigned only when the Board approves.
        </p>
      </div>
      <MemberForm mode="create" />
    </div>
  );
}

export default function NewMemberPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <NewMemberContent />
    </Suspense>
  );
}
