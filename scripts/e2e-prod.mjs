#!/usr/bin/env node
// npm run e2e:prod [-- <playwright args>]: runs the @prod E2E tests (offline reading app) against
// a production build (`next build` + `next start`). Port 3000 must be free: stop `npm run dev` first.
import { spawnSync } from "node:child_process";

const result = spawnSync("npx", ["playwright", "test", "--grep", "@prod", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, E2E_SERVER: "prod" },
});
process.exit(result.status ?? 1);
