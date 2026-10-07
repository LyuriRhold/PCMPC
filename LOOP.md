# LOOP.md — Running the build as a closed loop in Claude Code

## 1. The loop at a glance
| Part | What it is here |
|---|---|
| **Goal** | One phase, e.g. "Complete Phase 08 per its spec" (via `/goal`) |
| **Maker** | Claude Code on a strong model (Opus or Sonnet). It writes tests first, then code |
| **Gate** | A `Stop` hook → `node scripts/gate.mjs` → `npm run gate` (typecheck + lint + all tests + placeholder scan). It is a plain script: it costs zero tokens, and Claude can't argue with it |
| **Ceiling** | The gate lets Claude stop after **8 consecutive red attempts** and writes ⛔ BLOCKED into `PROGRESS.md`. Headless runs also use `--max-turns` |
| **Checker ≠ Maker** | Golden values come from the phase spec (written by humans and this plan), not from Claude. You review each phase, and an independent `reviewer` subagent checks the diff |

```
 /goal "Complete Phase XX"
      │
      ▼
 write acceptance tests (red) ──► implement task ──► tick PROGRESS ──► try to stop
      ▲                                                                  │
      │                         Stop hook: npm run gate                  │
      └──────── RED: "fix it" (attempt n/8) ◄────────────────────────────┤
                                                                         │ GREEN
                                                    phase summary ──► stop ──► YOU review & merge
```

## 2. One-time setup (part of Phase 00)

### 2.1 `.claude/settings.json`
```json
{
  "permissions": {
    "allow": [
      "Bash(npm run:*)", "Bash(npm install:*)", "Bash(npx drizzle-kit:*)", "Bash(npx playwright:*)",
      "Bash(npx shadcn@latest:*)", "Bash(git status)", "Bash(git diff:*)", "Bash(git add:*)",
      "Bash(git commit:*)", "Bash(git checkout:*)", "Bash(git log:*)", "Bash(docker compose:*)",
      "Bash(node scripts/*)"
    ],
    "deny": ["Bash(git push:*)", "Bash(vercel:*)", "Read(.env.production*)"]
  },
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "node scripts/gate.mjs", "timeout": 900 } ] }
    ]
  }
}
```

### 2.2 `scripts/gate.mjs` (cross-platform Node, works on Windows)
```js
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
```
Add `.claude/gate-state.json` to `.gitignore`.

### 2.3 `scripts/scan-placeholders.mjs` (spec; Claude writes it in Phase 00)
- It fails (exit 1) if `src/**` contains `TODO`, `FIXME`, `XXX`, `Not implemented`, `@ts-ignore`, `@ts-expect-error`, `: any`, `as any`, or `eslint-disable` without a `-- reason`.
- It fails if `tests/**` contains `.only(`, `.skip(`, `.todo(`, `xit(` or `xdescribe(`.
- It prints `file:line: rule` for each hit. It has its own test with fixtures (A0.8).

### 2.4 `package.json` scripts
```json
"typecheck": "tsc --noEmit",
"lint": "eslint . --max-warnings=0",
"test": "vitest run",
"e2e": "playwright test",
"scan": "node scripts/scan-placeholders.mjs",
"gate": "npm run typecheck && npm run lint && npm run test && npm run scan"
```
E2E is **not** in the gate because it is slow. It runs in each phase's exit checks, and in CI.

### 2.5 `.claude/agents/reviewer.md` (independent checker)
```markdown
---
name: reviewer
description: Reviews a finished PCMPC phase diff against its spec. Use after a phase is marked awaiting review.
tools: Read, Grep, Glob, Bash
model: sonnet
---
You did NOT write this code. Review branch `phase-XX-*` vs `main` against `docs/phases/PHASE-XX-*.md`.
Score each item PASS/FAIL with file:line evidence:
1. Every acceptance row has a test using the exact golden values (compare numbers).
2. tests/acceptance changed only in the first "test(phase-XX)" commit (git log -p).
3. Every money movement goes through postJournal inside a transaction.
4. No float math on money, no new Date() for business dates.
5. Every server action: requirePermission + zod + audit.
6. SoD rules in the spec are enforced server-side, not only hidden in the UI.
7. Nothing outside the phase scope was built.
8. Migrations apply cleanly on an empty DB.
Output: table of results + list of must-fix items. Do not modify files.
```

### 2.6 Prove the gate works (do this once, at the end of Phase 00)
1. On a scratch branch, change rounding in `src/lib/money.ts` from HALF-UP to truncation.
2. Tell Claude: *"The gate is red. Fix it until the gate passes."* Then take your hands off the keyboard.
3. Watch the Stop hook block, Claude find the cause, and the gate go green. Delete the scratch branch.

If Claude manages to stop while red, the hook is not wired correctly. Fix that before Phase 01.

## 3. Running a phase

### Interactive (recommended)
```
cd C:\Users\rldejoya\source\repos\PCMPC
claude
/model opus            (or sonnet: the maker)
/goal Complete Phase 08 exactly as specified in docs/phases/PHASE-08-share-capital.md, following CLAUDE.md. Done = all Phase 08 tasks ticked in PROGRESS.md, Phase 08 summary written, status 🟡, and npm run gate passes.
```
`/goal` keeps Claude working across turns until a small, fast model judges the goal met. The Stop hook ensures it can't claim "done" while anything is red. Each phase file ends with its ready-to-paste `/goal` line.

### Headless / unattended (optional)
```
claude -p "Complete Phase 08 exactly as specified in docs/phases/PHASE-08-share-capital.md, following CLAUDE.md." --max-turns 120 --permission-mode acceptEdits
```
The Stop hook still applies, and `--max-turns` is the hard ceiling.

### If your Claude Code build has no `/goal`
Use a normal prompt with the same text. The Stop hook alone keeps it looping until green.

## 4. After every phase (you = the outer loop)
1. In Claude Code: *"Use the reviewer agent on phase XX."* Read its PASS/FAIL table.
2. Skim `git diff main...phase-XX-<slug>`. Pay most attention to `tests/acceptance/` (the golden values must match the spec) and to migrations.
3. Run the app (`npm run dev`) and try the phase's E2E flow by hand.
4. Answer anything under `PROGRESS.md › Questions`. If an answer changes a rule, update `docs/DOMAIN.md` or the phase spec **yourself**.
5. Merge to `main`, tag `phase-XX`, set the status to ✅, and start the next phase.

## 5. Ceilings & cost control
- **Gate ceiling:** 8 consecutive red stops (`MAX_BLOCKS`). Raise it only for big phases (06, 11, 14, 15).
- **Turn ceiling:** `--max-turns 120` headless. Interactive: if a phase runs for more than about 3 hours, stop it and split the phase.
- **Model routing:** Opus/Sonnet for the maker. The `/goal` completion check uses a small model by default. The reviewer agent runs on Sonnet. The gate itself costs nothing.
- **Context hygiene:** start a **fresh session per phase**. `PROGRESS.md` is the memory between sessions, so keep summaries tight.
- **If ⛔ BLOCKED appears:** read the last gate output, answer or fix the question, delete the BLOCKED line, and re-run `/goal`.

## 6. Escape hatch
For a chat that isn't a build (asking questions, planning), start Claude with the gate off:
- PowerShell: `$env:PCMPC_GATE="off"; claude`
- Git Bash: `PCMPC_GATE=off claude`
