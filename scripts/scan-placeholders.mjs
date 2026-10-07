#!/usr/bin/env node
// Placeholder / cheat scanner (LOOP.md §2.3). Part of `npm run gate`.
//   src/**   : TODO, FIXME, XXX, "Not implemented", @ts-ignore, @ts-expect-error, ": any", "as any",
//              and eslint-disable without a "-- reason".
//   tests/** : .only( .skip( .todo( .fixme( xit( xdescribe(   (tests/fixtures/** is exempt: it holds scanner fixtures)
// Prints `file:line: rule` for every hit and exits 1 if there are any.
// Usage: node scripts/scan-placeholders.mjs [--root <dir>]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const CODE_EXT = /\.(?:[cm]?[jt]sx?)$/;

const SRC_RULES = [
  { rule: "TODO", re: /\bTODO\b/ },
  { rule: "FIXME", re: /\bFIXME\b/ },
  { rule: "XXX", re: /\bXXX\b/ },
  { rule: "Not implemented", re: /not implemented/i },
  { rule: "@ts-ignore", re: /@ts-ignore\b/ },
  { rule: "@ts-expect-error", re: /@ts-expect-error\b/ },
  { rule: ": any", re: /:\s*any\b/ },
  { rule: "as any", re: /\bas\s+any\b/ },
  { rule: "eslint-disable without -- reason", re: /eslint-disable(?:-next-line|-line)?\b/, unless: /eslint-disable\S*[^\n]*?\s--\s*\S/ },
];

const TEST_RULES = [
  { rule: ".only(", re: /\.only\(/ },
  { rule: ".skip(", re: /\.skip\(/ },
  { rule: ".todo(", re: /\.todo\(/ },
  { rule: ".fixme(", re: /\.fixme\(/ },
  { rule: "xit(", re: /\bxit\(/ },
  { rule: "xdescribe(", re: /\bxdescribe\(/ },
];

function parseArgs(argv) {
  const i = argv.indexOf("--root");
  return { root: resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : process.cwd()) };
}

function* walk(dir, skip) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".") || skip(full)) continue;
      yield* walk(full, skip);
    } else if (e.isFile() && CODE_EXT.test(e.name)) {
      yield full;
    }
  }
}

function scanFile(file, rules, root, hits) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const { rule, re, unless } of rules) {
      if (re.test(line) && !(unless && unless.test(line))) {
        hits.push(`${relative(root, file).split(sep).join("/")}:${i + 1}: ${rule}`);
      }
    }
  });
}

const { root } = parseArgs(process.argv.slice(2));
if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`scan: root ${root} does not exist`);
  process.exit(2);
}
const fixturesDir = join(root, "tests", "fixtures");
const hits = [];

for (const f of walk(join(root, "src"), () => false)) scanFile(f, SRC_RULES, root, hits);
for (const f of walk(join(root, "tests"), (d) => d === fixturesDir)) scanFile(f, TEST_RULES, root, hits);

if (hits.length > 0) {
  console.log(hits.join("\n"));
  console.error(`\nscan: ${hits.length} placeholder/cheat hit(s). Fix them; do not hide them.`);
  process.exit(1);
}
console.log("scan: clean");
