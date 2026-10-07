import { execSync } from "node:child_process";

/** E2E runs against the dev database: bring it to the latest migration and seed (idempotent). */
export default function globalSetup(): void {
  execSync("npm run -s db:migrate", { stdio: "inherit" });
  execSync("npm run -s db:seed", { stdio: "inherit" });
}
