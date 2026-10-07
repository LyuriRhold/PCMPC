import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Banned test-only call names are assembled at runtime so this file itself stays scanner-clean.
const dot = (name: string) => `.${name}(`;

let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function scanWith(files: Record<string, string>) {
  root = mkdtempSync(join(tmpdir(), "pcmpc-scan-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const r = spawnSync(process.execPath, ["scripts/scan-placeholders.mjs", "--root", root], { encoding: "utf8" });
  return { status: r.status, hits: r.stdout.split(/\r?\n/).filter((l) => /:\d+: /.test(l)) };
}

describe("scan-placeholders", () => {
  it.each([
    ["// TODO later", "TODO"],
    ["// FIXME", "FIXME"],
    ["// XXX hack", "XXX"],
    ['throw new Error("Not implemented");', "Not implemented"],
    ["// @ts-ignore", "@ts-ignore"],
    ["// @ts-expect-error", "@ts-expect-error"],
    ["let a: any = 1;", ": any"],
    ["const b = a as any;", "as any"],
    ["// eslint-disable-next-line no-console", "eslint-disable without -- reason"],
    ["/* eslint-disable */", "eslint-disable without -- reason"],
  ])("flags %j in src as %s", (line, rule) => {
    const r = scanWith({ "src/x.ts": `export {};\n${line}\n` });
    expect(r.hits).toEqual([`src/x.ts:2: ${rule}`]);
    expect(r.status).toBe(1);
  });

  it.each(["only", "skip", "todo", "fixme"])("flags .%s( in tests", (name) => {
    const r = scanWith({ "tests/unit/a.test.ts": `it${dot(name)}"x", () => {});\n` });
    expect(r.hits).toEqual([`tests/unit/a.test.ts:1: ${dot(name)}`]);
  });

  it.each(["xit", "xdescribe"])("flags %s( in tests", (name) => {
    const r = scanWith({ "tests/e2e/a.spec.ts": `${name}("x", () => {});\n` });
    expect(r.hits).toEqual([`tests/e2e/a.spec.ts:1: ${name}(`]);
  });

  it("allows clean code, reasoned eslint-disable, look-alike words and tests/fixtures", () => {
    const r = scanWith({
      "src/ok.ts": [
        "// eslint-disable-next-line no-console -- printed by the CLI on purpose",
        "const company = 'anything';",
        "type T = { many: string };",
        "const todos = [];",
      ].join("\n"),
      "src/page.tsx": "export default function P() { return null; }\n",
      "tests/fixtures/x/tests/a.test.ts": `it${dot("only")}"fixture", () => {});\n`,
      "tests/unit/a.test.ts": `it("ok", () => {});\nconst notes = "TODO is fine in tests";\n`,
      "src/readme.md": "TODO: markdown is not code\n",
    });
    expect(r.hits).toEqual([]);
    expect(r.status).toBe(0);
  });
});
