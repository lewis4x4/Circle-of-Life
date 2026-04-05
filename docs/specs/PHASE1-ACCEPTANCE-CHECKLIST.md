# Phase 1 — acceptance checklist (UI + sign-off)

Use this to declare **Phase 1 complete** before starting Phase 2. Phase 2 specs and builds are **not** prerequisites for this testing.

**Canonical milestone** (`docs/specs/README.md`): *At Week 12, COL can run daily operations on the platform at 1 pilot facility (Oakridge ALF). Caregivers document care, administer medications via eMAR, report incidents, view schedules, and clock in/out. Administrators manage staff, certifications, billing, and view facility dashboard.*

---

## Phase 1 full acceptance — current status (authoritative)

| Layer | Status |
|-------|--------|
| **Engineering baseline** | **PASS** — lint, build, migration replay, secrets, audit, segment gates; see §G and [PHASE1-CLOSURE-RECORD.md](./PHASE1-CLOSURE-RECORD.md) |
| **Known gap waivers (§F)** | **PARTIALLY REMEDIATED** — W-RCA-01 / W-COLL-01 / W-BILL-EF-01 closed in repo; **W-ADMIN-01** remains — [PHASE1-WAIVER-LOG.md](./PHASE1-WAIVER-LOG.md) |
| **Environment / remote migrations** | **PASS** — Repo migrations **001–071** (2026-04-06); apply **070–071** on remote via `supabase db push` before pilot; see [PHASE1-ENV-CONFIRMATION.md](./PHASE1-ENV-CONFIRMATION.md) |
| **Full product acceptance** (remaining preconditions, A–D UAT, RLS, Pro/BAA/PITR) | **NOT COMPLETE** — [PHASE1-EXECUTION-LOG.md](./PHASE1-EXECUTION-LOG.md), [PHASE1-RLS-VALIDATION-RECORD.md](./PHASE1-RLS-VALIDATION-RECORD.md) |

**Closure record:** [PHASE1-CLOSURE-RECORD.md](./PHASE1-CLOSURE-RECORD.md) — **NOT COMPLETE** until blockers in that file are cleared.

**Do not** treat repo-only verification as full Phase 1 acceptance.

---

## When to run UI testing

| Stage | What to do |
|-------|------------|
| **During development** | Smoke each feature as it lands (happy path + one failure path). |
| **Before “Phase 1 complete”** | Full pass of this checklist with **real auth roles** and **seeded pilot data** (e.g. Oakridge demo users). |
| **Before production / external pilot** | Repeat checklist on the **target environment** (URLs, env vars, Supabase project) plus accessibility pass if you use `npm run segment:gates -- --segment "…" --ui`. |
| **After any release candidate** | Re-run at least the **milestone-critical** rows (caregiver daily ops + admin billing/staff + dashboard). |

**You do not need Phase 2** to finish Phase 1 UI testing. Phase 2 adds depth (advanced meds, compliance engine, etc.); it is explicitly later in `docs/specs/README.md`.

---

## Preconditions

**Who verifies:** Items below are **your** checks on the target environment. An AI/agent in the repo cannot log into your Supabase dashboard or confirm BAA/PITR; it can only confirm what the codebase does (e.g. no Storage API usage yet).

- [ ] `.env.local` points at the correct Supabase project (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
- [ ] Migrations applied through latest (`supabase migration list` local/remote aligned).
- [ ] Test users exist with correct `app_role` and facility access (see `docs/specs/DEMO-SEED-RUNBOOK.md` if using Oakridge seed).
- [ ] Facility selected in admin shell where the UI expects it (facility store).
- [ ] **Storage buckets:** Current Phase 1 UI does **not** call Supabase Storage (no `storage.from` / upload flows in `src/`). Bucket creation, CORS, and policies are **not** a Phase 1 app prerequisite until you add file uploads (e.g. incident photos, avatars). When you add them, verify buckets + RLS in the Supabase dashboard.
- [ ] **Compliance / ops (production):** Pro plan, signed BAA before PHI, Point-in-Time Recovery — per `docs/specs/README.md`; confirm in Supabase **Project Settings** / billing, not in this repo.

---

## A. Authentication and routing

- [ ] `/login` — valid admin / caregiver / family credentials each land in the correct shell.
- [ ] Invalid credentials show a clear error (no silent failure).
- [ ] Deep link while logged out redirects through login appropriately.
- [ ] Wrong role cannot open another shell’s routes (middleware / shell guards).

---

## B. Admin shell — milestone + supporting routes

### B1. Facility dashboard (`/admin`)

- [ ] Loads without crash; metrics and census preview reflect data (or empty state).
- [ ] Links to resident directory work.

### B2. Residents

- [ ] `/admin/residents` — list loads, filters/search behave, row links work; **Add resident** opens `/admin/residents/new` when a facility is selected.
- [ ] `/admin/residents/new` — can create a resident (identity + status + acuity); redirects to profile (requires role allowed by RLS insert policy).
- [ ] `/admin/residents/[id]` — detail loads; clinical snippets coherent.
- [ ] `/admin/residents/[id]/care-plan` — plan/items load or empty state.
- [ ] `/admin/residents/[id]/billing` — payer + invoice list scoped to resident.

### B3. Staff and workforce

- [ ] `/admin/staff` — roster loads, filters work; **Add staff** opens `/admin/staff/new` when a facility is selected.
- [ ] `/admin/staff/new` — can create a staff row (requires owner / org admin / facility admin per RLS); redirects to detail.
- [ ] `/admin/staff/[id]` — detail, certifications, upcoming shifts (if data present).
- [ ] `/admin/certifications` — list loads.
- [ ] `/admin/schedules` — list loads.
- [ ] `/admin/staffing` — list loads.
- [ ] `/admin/time-records` — list loads.

### B4. Incidents

- [ ] `/admin/incidents` — queue loads, filters work.
- [ ] `/admin/incidents/[id]` — detail and follow-ups.
- [ ] `/admin/incidents/trends` — chart/summary for date window.
- [ ] `/admin/incidents/[id]/rca` — RCA workspace persisted to **`incident_rca`** (Postgres); optional one-time import from localStorage. Verify save survives refresh.

### B5. Billing (admin milestone)

- [ ] `/admin/billing` — overview/ledger entry works.
- [ ] `/admin/billing/invoices` — list loads; open invoice detail.
- [ ] `/admin/billing/invoices/[id]` — line items and totals; **no demo fallback** (unknown UUID → not found).
- [ ] `/admin/billing/invoices/generate` — preview + generate draft invoices (verify rows in Supabase).
- [ ] `/admin/billing/payments/new` — record payment; invoice balance updates when applied.
- [ ] `/admin/billing/rates` — rate schedules visible.
- [ ] `/admin/billing/ar-aging` — buckets make sense for open invoices.
- [ ] `/admin/billing/org-ar-aging` — org view loads.
- [ ] `/admin/billing/revenue` — payment rollup loads.
- [ ] `/admin/billing/collections` — facility-scoped activity log loads; `/admin/billing/collections/new` — can log a touch linked to resident (optional invoice).

### B6. Other admin

- [ ] `/admin/family-messages` — threads and send reply (staff).
- [ ] `/admin/assessments/overdue` — list loads.
- [ ] `/admin/care-plans/reviews-due` — list loads.
- [ ] Facility switcher updates lists where scoped by facility.

---

## C. Caregiver shell — milestone

- [ ] `/caregiver` — shift brief loads; critical links work.
- [ ] `/caregiver/tasks` — queue loads; can complete/document ADL flow.
- [ ] `/caregiver/meds` — eMAR queue; Given/Refused (or equivalent) persists.
- [ ] `/caregiver/incident-draft` — can submit incident; appears in admin incident list.
- [ ] `/caregiver/schedules` (or `/caregiver/caregiver/schedules`) — assignments visible.
- [ ] `/caregiver/clock` — clock in/out persists `time_records`.
- [ ] `/caregiver/resident/[id]` — profile loads; **Open eMAR** goes to meds; **Quick Add Note** appends `daily_logs`.
- [ ] `/caregiver/resident/[id]/log` — shift note append works.
- [ ] `/caregiver/resident/[id]/adl` — log ADL.
- [ ] `/caregiver/resident/[id]/behavior` — log behavior.
- [ ] `/caregiver/resident/[id]/condition-change` — log condition change.
- [ ] `/caregiver/handoff`, `/caregiver/followups`, `/caregiver/prn-followup` — load and actions work where applicable.
- [ ] `/caregiver/me` — session and sign-out.

---

## D. Family shell

- [ ] `/family` — feed loads for linked resident(s).
- [ ] `/family/care-plan` — summary loads.
- [ ] `/family/billing`, `/family/invoices`, `/family/payments` — read-only financial views.
- [ ] `/family/calendar` — events load.
- [ ] `/family/messages` — send/receive with staff inbox parity.

---

## E. Cross-cutting UX

- [ ] Loading states (no infinite spinners on happy path).
- [ ] Empty states (new facility with no rows).
- [ ] Error states (simulate bad network or revoke session).
- [ ] Mobile caregiver flows usable on a phone-width viewport.
- [ ] Optional: run machine gates (see `agents/registry.yaml` header for segment vs agent ids):
  `npm run segment:gates -- --segment "phase1-acceptance" --ui`
  — writes proof JSON under `test-results/agent-gates/`. Requires Docker for `migrations:verify:pg` if you set `REQUIRE_PG_VERIFY=1`; otherwise a failed Docker replay is **advisory** only.

---

## F. Known Phase 1 limitations (not Phase 2)

Document waiver or backlog item if you accept these for “100% Phase 1”:

- [x] **RCA workspace** — saved to **`incident_rca`** (replaces localStorage-only waiver).
- [ ] **Edge functions** — monthly invoice generation deployed as `generate-monthly-invoices` + schedule docs; **AR aging** batch automation may still be backlog vs full `16-billing.md` table.
- [x] **Collection activities** — admin list + create at `/admin/billing/collections*`.
- [ ] **Some admin pages** are list-heavy with no create wizards — acceptable if milestone is “run daily ops” on seeded data.

---

## Backend review — what “comprehensive” means

Automated / repo checks you should treat as **baseline** (run before sign-off):

- [ ] `npm run build` (includes migration ordering check).
- [ ] `npm run lint`
- [ ] `npm run migrations:verify:pg` (Docker replay of all migrations).
- [ ] `npm run check:secrets` / `npm audit` per your CI policy.
- [ ] `supabase db push` / `supabase migration list` aligned for the target project.

**Not fully replaced by agents:** a human or scripted **RLS matrix** (per role: admin, caregiver, family) proving:

- Users only read/write rows for allowed facilities/residents.
- Family cannot see other residents’ clinical/financial data without links + flags.

**This document does not certify** that every RLS policy was line-audited against `00-foundation` through `16-billing.md`; that remains the strongest remaining risk for “100% backend right.” Use Supabase policy tests, SQL probes, or a formal security review for final sign-off.

---

## Mission alignment (ship gate)

Before closing Phase 1, record **mission alignment** `pass` | `risk` | `fail` with one sentence (see `docs/mission-statement.md`, `AGENTS.md`).

---

## Comprehensive review — 2026-04-05 (automated + route inventory)

**Record:** [PHASE1-PHASE2-OFFICIAL-SIGNOFF-REVIEW.md](./PHASE1-PHASE2-OFFICIAL-SIGNOFF-REVIEW.md)

| Check | Result |
|-------|--------|
| `npm run lint` | PASS |
| `npm run build` (includes `migrations:check`) | PASS |
| `npm run migrations:verify:pg` | PASS |
| `npm run check:secrets` | PASS |
| `npm audit` | 0 vulnerabilities |
| Milestone routes compile (admin / caregiver / family) | PASS — see `next build` route list |

**Verdict:** **Phase 1 engineering readiness: PASS.** **§F gap waivers:** approved 2026-04-06. Full acceptance remains **NOT COMPLETE** — see [PHASE1-CLOSURE-RECORD.md](./PHASE1-CLOSURE-RECORD.md) (RLS, UAT, `.env` host + seeds, dashboard Pro/BAA/PITR). **Mission alignment:** `risk` until blockers close.

---

## G. Gate evidence — Phase 1 closure (refreshed 2026-04-05)

| Command / gate | Result |
|----------------|--------|
| `npm run lint` | PASS |
| `npm run build` | PASS (71 migrations 001–071) |
| `npm run migrations:verify:pg` | PASS |
| `npm run check:secrets` | PASS |
| `npm audit` | 0 vulnerabilities |
| `npm run segment:gates -- --segment "phase1-closeout-2026-04-05" --ui --no-chaos` | PASS |

**Artifacts:**

- `test-results/agent-gates/2026-04-05T19-33-16-726Z-phase1-closeout-2026-04-05.json` (current)
- `test-results/agent-gates/2026-04-05T02-04-25-955Z-phase1-final-closure-2026-04-06.json` (prior)

**Detail:** [PHASE1-CLOSURE-RECORD.md](./PHASE1-CLOSURE-RECORD.md)

---

## H. Execution log & waivers (owner)

- Row-by-row results: [PHASE1-EXECUTION-LOG.md](./PHASE1-EXECUTION-LOG.md)
- Waivers: [PHASE1-WAIVER-LOG.md](./PHASE1-WAIVER-LOG.md)

---

## I. RLS validation (owner)

- [PHASE1-RLS-VALIDATION-RECORD.md](./PHASE1-RLS-VALIDATION-RECORD.md) — **PENDING** until executed on target project.
- Procedure: [PHASE1-RLS-MANUAL-PROCEDURE.md](./PHASE1-RLS-MANUAL-PROCEDURE.md)
