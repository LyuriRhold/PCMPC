# Phase 02 — Members Registry

**Goal:** encode applicants, run them through PMES and BOD approval, and maintain the official member registry with beneficiaries. Data-privacy controls apply.
**Depends on:** 01.
**Inputs from PCMPC:** membership application form, member number format, PMES process, required IDs.

## Scope
- **In:** applicants, approval, member profile, beneficiaries, status changes, duplicate detection, search, privacy masking, consent capture.
- **Out:** money of any kind. The membership fee and share capital come in Phase 08. Photo/signature upload (Vercel Blob) goes to the Backlog unless trivial.

## Data model
- `members`: member_no (null until approved), type `REGULAR|ASSOCIATE`, status (DOMAIN §4), last/first/middle name, suffix, birthdate, sex, civil_status, address (house/street, purok/sitio, barangay, municipality, province), mobile, email, occupation, employer/business, TIN?, valid_id_type, valid_id_no, pmes_date, bod_resolution_no, approved_at, membership_date, privacy_consent_at, remarks
- `member_beneficiaries` (member_id, name, relationship, birthdate, share_pct)
- `member_status_history` (member_id, from, to, reason, ref, at, by)

## Business rules
- New records start as APPLICANT with no member_no.
- **Approval** (`members.approve`) requires `pmes_date`, `bod_resolution_no` and privacy consent. It then assigns `member_no` from series `MEMBER`, sets status ACTIVE, and sets `membership_date` = business date.
- **Duplicates:** same normalized last + first name + birthdate as an existing non-terminated member blocks the save, and the message names the existing member_no.
- Beneficiary `share_pct` must total exactly 100 when any beneficiaries exist.
- Search is case-, accent- and extra-space-insensitive on name and member_no.
- Users without `members.read_sensitive` see birthdate, valid_id_no, TIN and mobile **masked**. Masking happens server-side.
- `canTerminate(memberId)` is an extensible checker (list of rules). This phase registers no money rules yet; Phases 08/09/11 add theirs. TERMINATED and DECEASED are terminal.
- Every status change writes `member_status_history` and the audit log.

## Screens
Member list (search, filter by status/type, pagination) · Application form · Approval queue · Member profile (Profile, Beneficiaries, Status history tabs; later phases add tabs) · Status change dialog.

## Tasks
- **T2.1** Schema + migrations + name normalization helper.
- **T2.2** Member service: create applicant, update, approve, change status, duplicate check, `canTerminate` registry.
- **T2.3** Beneficiaries service and validation.
- **T2.4** Server actions with permissions + audit; server-side masking.
- **T2.5** UI: list/search, application form (zod shared), approval queue, profile tabs.
- **T2.6** Seed fixture: 6 sample members for dev only (never in prod seed).

## Acceptance tests (golden)
| ID | Given / When | Then |
|---|---|---|
| A2.1 | Create applicant "Juan Dela Cruz", born 1990-05-10 | status APPLICANT, member_no null |
| A2.2 | Approve A2.1 without pmes_date | error "PMES date is required" |
| A2.3 | Approve with PMES 2026-10-01, BOD Res. 2026-15, consent, business date 2026-10-07 | status ACTIVE, member_no `M-000001`, membership_date 2026-10-07 |
| A2.4 | Approve a second applicant | member_no `M-000002` |
| A2.5 | Create applicant "JUAN  dela cruz" born 1990-05-10 | blocked: "Possible duplicate of M-000001" |
| A2.6 | Beneficiaries 60% + 30% / 60% + 40% | rejected "must total 100%" / accepted |
| A2.7 | Search "dela cruz" | finds M-000001 |
| A2.8 | TELLER (no read_sensitive) views M-000001 | birthdate shown as `••••-••-••`; valid_id_no masked except last 4 chars |
| A2.9 | Change status ACTIVE → TERMINATED → ACTIVE | second change rejected (terminal); history has 1 row |
| A2.10 | E2E: encode applicant → approve → list shows ACTIVE with member no. | pass |

## Exit checks
`npm run gate` · `npm run build` · `npm run e2e -- phase-02`.

## /goal
```
/goal Complete Phase 02 exactly as specified in docs/phases/PHASE-02-members.md, following CLAUDE.md. Done = all Phase 02 tasks ticked in PROGRESS.md, Phase 02 summary written, status 🟡, and npm run gate passes.
```
