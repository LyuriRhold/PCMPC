import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Meter reading · PCMPC",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "PCMPC Reading" },
};

export const viewport: Viewport = { themeColor: "#0e7490", width: "device-width", initialScale: 1, maximumScale: 1 };

/** The meter readers' phone app: no sidebar, big touch targets, works offline (public/sw.js). */
export default function ReaderLayout({ children }: LayoutProps<"/">) {
  return <main className="flex min-h-dvh flex-col">{children}</main>;
}
