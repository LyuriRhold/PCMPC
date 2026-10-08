import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ComingSoon } from "@/components/coming-soon";
import { ALL_NAV_ITEMS, comingSoonItem, NAV_SECTIONS } from "@/components/layout/nav";
import { PageLoading } from "@/components/page-loading";

// Planned screens (status "soon" in src/components/layout/nav.ts) render the under-construction
// page. Real routes always win over this catch-all; any other path is "not found".

export function generateStaticParams() {
  return ALL_NAV_ITEMS.filter((i) => i.status === "soon").map((i) => ({ slug: i.href.split("/").filter(Boolean) }));
}

async function itemFor(params: Promise<{ slug: string[] }>) {
  const { slug } = await params;
  return comingSoonItem(`/${slug.join("/")}`);
}

export async function generateMetadata(props: PageProps<"/[...slug]">): Promise<Metadata> {
  const item = await itemFor(props.params);
  return { title: item ? `${item.label} (coming soon) · PCMPC MIS` : "Not found · PCMPC MIS" };
}

async function ComingSoonContent({ params }: { params: Promise<{ slug: string[] }> }) {
  const item = await itemFor(params);
  if (!item) notFound();
  const section = NAV_SECTIONS.find((s) => s.items.includes(item))?.title ?? "";
  return <ComingSoon item={item} section={section} />;
}

export default function ComingSoonPage(props: PageProps<"/[...slug]">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <ComingSoonContent params={props.params} />
    </Suspense>
  );
}
