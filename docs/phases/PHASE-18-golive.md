# Phase 18 — Hardening, Vercel Deployment, Backups, UAT & Go-Live

**Goal:** make the MIS production-safe, deploy it to Vercel + Neon (Singapore), set up backups and monitoring, run UAT with PCMPC staff, and cut over.
**Depends on:** 17.
**Inputs from PCMPC:** go-live date, UAT participants per role, Vercel/Neon account owner (who pays), domain name (optional), BIR decision on system-generated receipts.

## Scope
- **In:** security hardening, authorization sweep, rate limiting, security headers, privacy notice & data-subject export, performance indexes, Vercel project (Pro plan for org use), Neon prod + staging branches, migrations on deploy, Vercel Cron, secrets, backups + restore drill, monitoring/alerts, local-mode fallback doc, UAT scripts, training guides, cut-over and parallel run, BIR registration track.
- **Out:** new features (Backlog).

## Tasks
- **T18.1** **Authorization sweep:** a static test that enumerates every server action / route handler and asserts it calls `requirePermission`.
- **T18.2** Login rate limit, security headers (CSP, frame-ancestors, HSTS in prod), cookie flags, CSRF review, dependency audit.
- **T18.3** Data privacy: privacy notice page, consent records, member data export (JSON/PDF) for access requests, retention notes in `docs/PRIVACY.md`.
- **T18.4** Performance: indexes for hot queries, pagination everywhere, N+1 check on reports.
- **T18.5** **Vercel + Neon:** Neon from the Vercel Marketplace (region AWS ap-southeast-1); Vercel function region `sin1`; envs Production / Preview (Neon branch per preview, CONFIRM) / Development; `pg` with the pooled URL; `vercel.json` crons calling `/api/cron/daily` at 16:05 UTC (00:05 Manila) with `CRON_SECRET`; migrations run in CI before promote. Write `docs/DEPLOY.md`.
- **T18.6** **Backups:** rely on Neon point-in-time restore (check the plan's retention). Add a nightly `pg_dump` via a GitHub Actions schedule to private storage, and a documented **monthly restore drill** (`docs/BACKUP.md`).
- **T18.7** Monitoring: health endpoint check, error logging, alert e-mail on cron failure.
- **T18.8** **Local-mode fallback** (`docs/LOCAL-MODE.md`): run on an office PC (`npm run build && npm start` + local Postgres) during long outages. Rule: **one active source of truth at a time**, switching only via backup/restore with a sign-off.
- **T18.9** **UAT:** scripts per role in `docs/uat/` (water reading & billing cycle on real phones, teller day, disconnection/reconnection, loan cycle, store day, month-end close, year-end allocation). Issue log with severity; fix P1/P2 before go-live.
- **T18.10** Training: one-page quick guides per role (Markdown → PDF).
- **T18.11** Go-live: final migration (Phase 17), 1-month parallel run (manual + system), daily reconciliation, sign-off by the Manager and BOD recorded in `PROGRESS.md`.
- **T18.12** BIR track (`docs/BIR.md`): decide manual BIR receipts (default) vs CAS/POS registration of the system; list requirements to raise with the BIR RDO.
- **T18.13** Water compliance (`docs/WATER-COMPLIANCE.md`): NWRB Certificate of Public Convenience and the approved tariff on file; rate schedules in the MIS match the approved tariff; senior-discount applicability; disconnection-notice rules; water-quality testing log (CONFIRM).

## Acceptance tests (golden)
| ID | Given / When | Then |
|---|---|---|
| A18.1 | Authorization sweep test | 0 server actions/route handlers without `requirePermission` (public: login, health) |
| A18.2 | 20 login attempts in 1 minute from one IP | later attempts get HTTP 429 |
| A18.3 | Response headers on a prod build | CSP, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, HSTS present |
| A18.4 | `/api/cron/daily` without/with a wrong `CRON_SECRET` | 401 |
| A18.5 | Cron at 16:05 UTC on 2026-12-31 | business date used = 2027-01-01 (Manila) |
| A18.6 | Backup → restore into an empty DB | TB as-of today identical to the source |
| A18.7 | Member data export for M-000001 | contains profile, share, savings, loans, store AR; excludes other members |
| A18.8 | Full E2E regression against the staging deployment | all green |

## Exit checks
`npm run gate` · `npm run build` · full `npm run e2e` against staging · UAT sign-off recorded · production smoke test after deploy.

## /goal
```
/goal Complete Phase 18 tasks T18.1–T18.8, T18.12 and T18.13 exactly as specified in docs/phases/PHASE-18-golive.md, following CLAUDE.md. Do not deploy to production yourself; prepare everything and document the steps. Done = those tasks ticked in PROGRESS.md, Phase 18 summary written, status 🟡, and npm run gate passes.
```
> T18.9–T18.11 (UAT, training, go-live) are people work. Claude assists, but humans run and sign off.
