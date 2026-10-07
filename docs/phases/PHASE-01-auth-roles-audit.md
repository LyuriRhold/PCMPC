# Phase 01 — Auth, Roles, Audit Trail & Coop Settings

**Goal:** secure login, role-based permissions with segregation of duties, a complete audit trail, the coop profile/settings, and gapless document numbering. Every later phase uses these.
**Depends on:** 00.
**Inputs from PCMPC:** CDA reg. no., TIN, address, fiscal year, staff list with roles.

## Scope
- **In:** auth library decision + setup, users, roles, permissions, `requirePermission()`, `assertNotSameUser()` (SoD), login lockout, audit log + viewer, settings store (seeded from `docs/DOMAIN.md §2`), numbering service, admin seed.
- **Out:** member portal logins, 2FA (Backlog), SSO.

## Data model
- `users` (username unique, full_name, email?, password hash via the auth lib, role_code, is_active, failed_attempts, locked_until, last_login_at)
- `roles` (code, name) and `role_permissions` (role_code, permission_code). Roles are listed in `PLAN.md §3`.
- Permission codes use the form `<module>.<action>`: `members.read|write|approve|read_sensitive`, `share.read|post`, `savings.read|post|run_interest`, `loans.read|apply|recommend|approve|release|collect|writeoff`, `cash.session|receipt|cancel|dv_prepare|dv_approve|verify`, `water.customers|apply|approve|install|rates|read_meter|review_readings|bill|adjust_prepare|adjust_approve|disconnect|reconnect`, `store.pos|receive|adjust|approve_adjust|price`, `gl.read|jv_prepare|jv_approve|close|reopen`, `reports.read|cda`, `admin.users|settings`, `audit.read`
- `audit_log` (at, user_id, action, entity, entity_id, before jsonb, after jsonb, ip, user_agent). Append-only, and a DB trigger blocks UPDATE/DELETE.
- `settings` (key, value jsonb, updated_by, updated_at) plus `settings_history`
- `number_series` (code, prefix_format, year, next_no, padding, resets_yearly)

## Business rules
- Passwords are at least 10 characters. 5 failed logins lock the account for 15 minutes. Inactive users can't log in. The idle session timeout is 8 hours (CONFIRM).
- Users are deactivated, never deleted. An admin can't deactivate or demote themself.
- `requirePermission()` runs **server-side** in every server action, route handler and protected page. Hiding things in the UI is not security.
- `audit()` records before/after for every mutation and never stores password hashes or secrets.
- `numbering.next(code, tx)` uses `SELECT … FOR UPDATE` inside the caller's transaction. On rollback the number is not consumed, so there are no gaps.
- Settings changes are audited and keep their history.

## Screens
Login · Users (list, create, edit, deactivate, reset password) · Roles & permissions matrix (read-only grid; editing in v1 is via seed) · Audit log (filters: user, entity, date range, action) · Coop settings (profile + rates, grouped by module).

## Tasks
- **T1.1** Choose Better Auth vs Auth.js (credentials) and record the decision with its reason in `PROGRESS.md › Decisions`. Install and configure it with sessions stored in Postgres.
- **T1.2** Schema + migrations for users, roles, role_permissions, audit_log (with the immutability trigger), settings, settings_history, number_series.
- **T1.3** Seed: roles, permission matrix, settings defaults from DOMAIN §2, number series from DOMAIN §5, and the first admin from env `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`.
- **T1.4** `src/lib/auth-guard.ts`: `getCurrentUser()`, `requirePermission(code)`, `assertNotSameUser(preparerId, approverId)`.
- **T1.5** `src/lib/audit.ts` `audit(tx, {action, entity, entityId, before, after})`, plus the audit log viewer.
- **T1.6** Login/logout pages, lockout logic, and protected `(staff)` layout redirect.
- **T1.7** Users admin UI and actions.
- **T1.8** Settings service (`getSetting<T>(key)` with zod-typed keys) and the settings UI.
- **T1.9** `src/lib/numbering.ts` `next(code, tx, date)`.

## Acceptance tests (golden)
| ID | Given / When | Then |
|---|---|---|
| A1.1 | TELLER calls an action requiring `loans.approve` | throws Forbidden; an audit row `auth.denied` is written |
| A1.2 | ADMIN creates user `teller1` | an `audit_log` row `user.create` exists; `after.username = "teller1"`; no password/hash field in before/after |
| A1.3 | 5 wrong passwords for `teller1`, then the correct one | 6th attempt rejected "account locked"; after the clock advances 15 min, login succeeds and failed_attempts resets to 0 |
| A1.4 | 20 concurrent `numbering.next("GJ")` in 2026 | 20 distinct values `GJ-2026-00001` … `GJ-2026-00020`, no gaps, no duplicates |
| A1.5 | `numbering.next("GJ")` inside a transaction that rolls back, then another call | the second call returns the same number the rolled-back call had |
| A1.6 | Deactivated user logs in | rejected |
| A1.7 | AUDITOR opens the audit log | allowed; any mutation action → Forbidden |
| A1.8 | `assertNotSameUser(u1, u1)` | throws "Segregation of duties: preparer cannot approve" |
| A1.9 | Direct SQL `UPDATE audit_log …` | DB raises an error (trigger) |
| A1.10 | E2E: login as admin → dashboard → open Users → logout | redirected to login; protected URL redirects to login |

## Exit checks
`npm run gate` · `npm run build` · `npm run e2e -- phase-01` · fresh `db:reset && db:migrate && db:seed` works.

## /goal
```
/goal Complete Phase 01 exactly as specified in docs/phases/PHASE-01-auth-roles-audit.md, following CLAUDE.md. Done = all Phase 01 tasks ticked in PROGRESS.md, Phase 01 summary written, status 🟡, and npm run gate passes.
```
