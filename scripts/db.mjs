#!/usr/bin/env node
// Local PostgreSQL lifecycle for development: `node scripts/db.mjs up|down|reset|status`.
//
// Three setups are supported (PG_MODE in .env, auto-detected when unset):
//   portable  PostgreSQL zip binaries under PG_HOME (default %LOCALAPPDATA%\pcmpc-pg).
//             `up` runs initdb on first use, then pg_ctl start; `down` runs pg_ctl stop.
//   service   A native Windows install running as service PG_SERVICE. up/down only check it.
//   external  Any other reachable server (CI service container, Linux/macOS install). up/down only check it.
// In every mode `up` finishes by creating the databases named in DATABASE_URL and DATABASE_URL_TEST.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pg from "pg";

if (existsSync(".env")) process.loadEnvFile(".env");

const cmd = process.argv[2] ?? "status";
const devUrl = requireEnv("DATABASE_URL");
const testUrl = process.env.DATABASE_URL_TEST;
const target = new URL(devUrl);
const port = target.port || "5432";
const user = decodeURIComponent(target.username || "postgres");
const password = decodeURIComponent(target.password || "");

const pgHome = process.env.PG_HOME ?? join(process.env.LOCALAPPDATA ?? join(process.env.HOME ?? ".", ".local"), "pcmpc-pg");
const binDir = join(pgHome, "pgsql", "bin");
const dataDir = join(pgHome, "data");
const logFile = join(pgHome, "postgres.log");
const exe = (name) => join(binDir, process.platform === "win32" ? `${name}.exe` : name);
const mode = process.env.PG_MODE ?? (existsSync(exe("pg_ctl")) ? "portable" : process.env.PG_SERVICE ? "service" : "external");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is not set. Copy .env.example to .env first.`);
    process.exit(1);
  }
  return v;
}

function portableRunning() {
  const r = spawnSync(exe("pg_ctl"), ["status", "-D", dataDir], { encoding: "utf8" });
  return r.status === 0;
}

function initPortable() {
  console.log(`initdb → ${dataDir}`);
  mkdirSync(pgHome, { recursive: true });
  const pwfile = join(tmpdir(), `pcmpc-pw-${process.pid}`);
  writeFileSync(pwfile, password);
  try {
    execFileSync(
      exe("initdb"),
      ["-D", dataDir, "-U", user, `--pwfile=${pwfile}`, "--auth=scram-sha-256", "-E", "UTF8",
        "--locale-provider=builtin", "--builtin-locale=C.UTF-8", "--locale=C"],
      { stdio: "inherit" },
    );
  } finally {
    rmSync(pwfile, { force: true });
  }
}

async function serviceRunning(name) {
  const r = spawnSync("sc", ["query", name], { encoding: "utf8" });
  return r.status === 0 && /RUNNING/.test(r.stdout);
}

async function reachable() {
  const client = new pg.Client({ connectionString: adminUrl() });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function waitUntilReachable(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await reachable()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function adminUrl() {
  const u = new URL(devUrl);
  u.pathname = "/postgres";
  return u.toString();
}

async function ensureDatabases() {
  const names = [devUrl, testUrl].filter(Boolean).map((u) => decodeURIComponent(new URL(u).pathname.slice(1)));
  const client = new pg.Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    for (const name of names) {
      const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
      if (rowCount === 0) {
        await client.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
        console.log(`created database ${name}`);
      }
    }
  } finally {
    await client.end();
  }
  console.log(`databases ready: ${names.join(", ")}`);
}

async function up() {
  if (mode === "portable") {
    if (!existsSync(join(dataDir, "PG_VERSION"))) initPortable();
    if (!portableRunning()) {
      // Fully detached: the server must not inherit this shell's pipes (they would never close) or
      // its console (when the shell exits, new backends would fail to start with 0xC0000142).
      const child = spawn(exe("pg_ctl"), ["start", "-D", dataDir, "-l", logFile, "-o", `-p ${port}`], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      if (!(await waitUntilReachable(180_000))) {
        console.error(`PostgreSQL did not start within 3 minutes (after an unclean shutdown it first checks its data files). See ${logFile}`);
        process.exit(1);
      }
      console.log(`portable PostgreSQL started on port ${port} (log: ${logFile})`);
    }
  } else if (mode === "service") {
    if (!(await serviceRunning(process.env.PG_SERVICE))) {
      console.error(`Windows service ${process.env.PG_SERVICE} is not running. Start it from services.msc (admin).`);
      process.exit(1);
    }
  }
  if (!(await reachable())) {
    console.error(`PostgreSQL is not reachable at ${target.host} (mode: ${mode}).`);
    process.exit(1);
  }
  await ensureDatabases();
}

async function down() {
  if (mode === "portable") {
    if (portableRunning()) execFileSync(exe("pg_ctl"), ["stop", "-D", dataDir, "-m", "fast", "-w", "-t", "30"], { stdio: "inherit" });
    else console.log("portable PostgreSQL is not running");
    return;
  }
  console.log(`mode ${mode}: the server is managed outside this project; nothing to stop.`);
}

/** Drops and recreates the dev database (DATABASE_URL). Local hosts only; never in production. */
async function reset() {
  const host = target.hostname;
  if (process.env.APP_ENV === "production" || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    console.error(`refusing to reset a non-local or production database (${host})`);
    process.exit(1);
  }
  const name = decodeURIComponent(target.pathname.slice(1));
  const quoted = `"${name.replaceAll('"', '""')}"`;
  const client = new pg.Client({ connectionString: adminUrl() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${quoted}`);
  } finally {
    await client.end();
  }
  console.log(`database ${name} dropped and recreated; run db:migrate and db:seed next`);
}

async function status() {
  const ok = await reachable();
  console.log(`mode: ${mode} · ${target.host} · ${ok ? "reachable" : "NOT reachable"}`);
  process.exit(ok ? 0 : 1);
}

const actions = { up, down, reset, status };
if (!(cmd in actions)) {
  console.error(`usage: node scripts/db.mjs ${Object.keys(actions).join("|")}`);
  process.exit(1);
}
await actions[cmd]();
