import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // CLAUDE.md: business dates come from src/lib/dates.ts (Asia/Manila), never from `new Date()`.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/dates.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Use businessToday() / the injected clock from @/lib/dates instead of new Date().",
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "Use the injected clock from @/lib/dates instead of Date.now().",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "tests/fixtures/**",
  ]),
]);

export default eslintConfig;
