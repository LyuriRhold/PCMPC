import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // PDF rendering (bills, reading sheets) runs on the server with an embedded font that has ₱.
  serverExternalPackages: ["@react-pdf/renderer"],
  outputFileTracingIncludes: { "/api/water/**": ["./src/assets/fonts/**"], "/api/reports/**": ["./src/assets/fonts/**", "./docs/cda-templates/**"] },
  partialPrefetching: true,
  experimental: {
    // Data-migration uploads go through a server action: files up to 4 MB (MAX_FILE_BYTES) plus the form's overhead.
    serverActions: { bodySizeLimit: "5mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
