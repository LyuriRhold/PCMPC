# PCMPC MIS

Management Information System for **Pipindan Community Multi-Purpose Cooperative** (Pipindan, Binangonan, Rizal):
water service billing, membership & share capital, savings & loans, cashiering, store and accounting.

- Plan & architecture: [`PLAN.md`](PLAN.md)
- Build loop: [`LOOP.md`](LOOP.md) · working rules: [`CLAUDE.md`](CLAUDE.md) · status: [`PROGRESS.md`](PROGRESS.md)
- Business rules: [`docs/DOMAIN.md`](docs/DOMAIN.md) · phase specs: [`docs/phases/`](docs/phases/)

## Requirements
- Node.js 24 LTS (see `.nvmrc`) and npm
- PostgreSQL 18 (see *Database on Windows* below)

## Quick start
```bash
npm ci
cp .env.example .env        # then adjust if needed
npm run db:up               # start local Postgres
npm run db:migrate
npm run db:seed
npm run dev                 # http://localhost:3000
```

## Commands
| Command | Does |
|---|---|
| `npm run dev` | Next.js dev server at http://localhost:3000 |
| `npm run db:up` / `db:down` | Start / stop local Postgres |
| `npm run db:generate` / `db:migrate` | Create / apply Drizzle migrations |
| `npm run db:seed` / `db:reset` | Seed reference data / drop and recreate the dev DB |
| `npm run db:seed:dev` | Load sample members for local development (refuses production and non-local DBs) |
| `npm run typecheck` / `lint` | `tsc --noEmit` / ESLint |
| `npm test` | Vitest: unit + integration + acceptance (uses `DATABASE_URL_TEST`) |
| `npm run e2e` | Playwright E2E |
| `npm run scan` | Placeholder/cheat scanner |
| `npm run gate` | typecheck → lint → test → scan (the loop gate) |

## Database on Windows
The project expects PostgreSQL 18 on `localhost:5432` with the credentials in `.env`.
`npm run db:up` creates the `pcmpc` and `pcmpc_test` databases if they are missing.
`scripts/db.mjs` supports three setups (set `PG_MODE` in `.env`, or let it auto-detect):

| Mode | Use when | `db:up` / `db:down` |
|---|---|---|
| `portable` (default when found) | No admin rights. PostgreSQL zip binaries in `%LOCALAPPDATA%\pcmpc-pg` | `initdb` on first run, then `pg_ctl start` / `pg_ctl stop` |
| `service` | Native install from the EDB installer (`PG_SERVICE=postgresql-x64-18`) | Checks that the Windows service is running |
| `external` | CI service container, Docker, Linux/macOS | Checks that the server is reachable |

**Portable setup (one time, no admin):**
1. Download the *Windows x86-64 binaries* zip for PostgreSQL 18 from
   https://www.enterprisedb.com/download-postgresql-binaries.
2. Extract it so that `%LOCALAPPDATA%\pcmpc-pg\pgsql\bin\pg_ctl.exe` exists. You can delete `pgsql\pgAdmin 4`,
   `pgsql\StackBuilder` and `pgsql\doc`.
3. Run `npm run db:up`. The first run initializes `%LOCALAPPDATA%\pcmpc-pg\data`, using the user and
   password from `DATABASE_URL`. The server log is `%LOCALAPPDATA%\pcmpc-pg\postgres.log`.

The portable server doesn't start with Windows. Run `npm run db:up` after each reboot.

**Native install:** run the EDB installer as admin, then set `PG_MODE=service` and `PG_SERVICE` in `.env`.
**Docker Desktop:** run any `postgres:18` container on port 5432, then set `PG_MODE=external`.
