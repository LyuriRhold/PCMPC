import { Suspense } from "react";
import { Forbidden } from "@/components/forbidden";
import { PageLoading } from "@/components/page-loading";
import { guardPage } from "@/lib/page-guard";
import { logoutAction } from "@/modules/auth/session-actions";
import { getSetting } from "@/modules/settings/service";
import { readerWork } from "@/modules/water/billing-queries";
import { ReaderApp } from "@/modules/water/ui/reader-app";

async function ReaderContent() {
  const access = await guardPage("water.read_meter");
  if (!access.ok) return <Forbidden permission={access.permission} />;
  const [routes, high, low] = await Promise.all([readerWork(access.user.id), getSetting("water.high_factor"), getSetting("water.low_flag")]);
  return (
    <>
      <ReaderApp initial={{ routes, rules: { high, low } }} readerName={access.user.name} />
      <form action={logoutAction} className="mx-auto w-full max-w-md px-3 pb-4">
        <button type="submit" className="text-sm underline underline-offset-4">
          Sign out
        </button>
      </form>
    </>
  );
}

export default function ReaderPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <ReaderContent />
    </Suspense>
  );
}
