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
| `npm run typecheck` / `lint` | `tsc --noEmit` / ESLint |
| `npm test` | Vitest: unit + integration + acceptance (uses `DATABASE_URL_TEST`) |
| `npm run e2e` | Playwright E2E |
| `npm run scan` | Placeholder/cheat scanner |
| `npm run gate` | typecheck → lint → test → scan (the loop gate) |
