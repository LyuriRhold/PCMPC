#!/usr/bin/env node
// Stop-hook gate: Claude cannot stop while `npm run gate` is red.
// Ceiling: after MAX_BLOCKS consecutive red stops it lets Claude stop and flags PROGRESS.md.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";

const STATE = ".claude/gate-state.json";
const MAX_BLOCKS = 8;

if (process.env.PCMPC_GATE === "off") process.exit(0);   // manual escape hatch for non-build chats
try { readFileSync(0, "utf8"); } catch {}                   // drain hook JSON from stdin
if (!existsSync("package.json")) process.exit(0);           // nothing to verify before scaffolding

let state = { blocks: 0 };
try { state = JSON.parse(readFileSync(STATE, "utf8")); } catch {}

let ok = true, out = "";
try {
  out = execSync("npm run gate --silent", { encoding: "utf8", stdio: "pipe", timeout: 14 * 60 * 1000 });
} catch (e) {
  ok = false;
  out = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
}

if (ok) { writeFileSync(STATE, JSON.stringify({ blocks: 0 })); process.exit(0); }

state.blocks += 1;
if (state.blocks >= MAX_BLOCKS) {
  writeFileSync(STATE, JSON.stringify({ blocks: 0 }));
  appendFileSync("PROGRESS.md",
    `\n\n> ⛔ BLOCKED ${new Date().toISOString()}: gate red ${MAX_BLOCKS}x in a row. Needs human review.\n`);
  process.exit(0);                                          // ceiling reached → allow stop
}
writeFileSync(STATE, JSON.stringify(state));

const tail = out.split(/\r?\n/).slice(-80).join("\n");
process.stdout.write(JSON.stringify({
  decision: "block",
  reason: `npm run gate is RED (attempt ${state.blocks}/${MAX_BLOCKS}). Find and fix the root cause. ` +
          `Do NOT edit tests/acceptance or weaken assertions.\n\n${tail}`
}));
process.exit(0);
