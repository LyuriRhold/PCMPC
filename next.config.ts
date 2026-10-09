import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // PDF rendering (bills, reading sheets) runs on the server with an embedded font that has ₱.
  serverExternalPackages: ["@react-pdf/renderer"],
  outputFileTracingIncludes: { "/api/water/**": ["./src/assets/fonts/**"] },
  partialPrefetching: true,
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
