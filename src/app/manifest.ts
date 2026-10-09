import type { MetadataRoute } from "next";

/** Web app manifest: the meter readers install /read on their phones' home screens. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PCMPC Meter Reading",
    short_name: "PCMPC Reading",
    description: "Read water meters on your routes, with or without signal.",
    start_url: "/read",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0e7490",
    icons: [{ src: "/reader-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
