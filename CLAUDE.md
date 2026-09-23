# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` and `CODEX.md` are the authoritative agent contracts — read them in full before non-trivial work. This file is a fast orientation layer; when it conflicts with AGENTS.md / CODEX.md / `docs/specs/`, the latter win.

## Heads-up: Next.js 16 (breaking changes)

This repo runs **Next 16.2 + React 19.2** with Turbopack. APIs, conventions, and file structure differ from older Next training data. Before writing routing, layout, or config code, check the relevant guide in `node_modules/next/dist/docs/` and heed deprecation notices. `next.config.ts` is TypeScript and ESM.

## Mission ship-gate (state alignment in every segment handoff)

> **North star:** Build **Haven** for Circle of Life: **Expand. Perfect. Secure. Multiply. Through enhanced management by virtual staff and real time, accurate access to the complete body of information upon which we thrive.** Support assisted living operations across facilities and legal entities on **one secure, role-governed data layer**, improving resident safety and quality, regulatory readiness, staff clarity, and owner visibility. AI must remain **subordinate to human judgment, licensure rules, and auditability**.

Circle of Life operates five Florida ALF facilities. Homewood Lodge is the current acceptance and controlled launch facility; Oakridge seeded validation evidence remains historical.

State **mission alignment** (`pass` | `risk` | `fail`) with one sentence in every segment handoff. Misalignment can block release even when tests pass. Full statement: `docs/mission-statement.md`.

## Where to look

| Need | Path |
|------|------|
| Build sequence + module index | `docs/specs/README.md` |
| Spec (source of truth for *what* to build) | `docs/specs/<NN>-*.md` — read `## COL Alignment Notes` |
| Current closeout work | `docs/specs/TRACK-A-CLOSEOUT-ROADMAP.md` |
| Next backlog segment | `docs/specs/TRACK-D-ENHANCED-BACKLOG-PLAN.md` |
| Session-to-session loop log | `docs/Autonomous.md` |
| Agent registry / playbooks | `agents/registry.yaml`, `agents/playbooks/` |
| Gate runner runbook | `docs/agent-gates-runbook.md` |
| Frontend route contract | `docs/specs/FRONTEND-CONTRACT.md` |

## Commands

Common scripts (see `package.json` for the full list — many `homewood:*` / `demo:*` variants exist):

| Script | Purpose |
|--------|---------|
| `npm run dev` | Next dev server (Turbopack) |
| `npm run build` | Runs `migrations:check` + `migrations:check:hosted` + `check:admin-shell` + `check:memory-care` then `next build` |
| `npm run lint` | ESLint `src/` with `--max-warnings 0`, then `lint:constitution`. Pre-existing React Compiler-rule debt is baselined in `eslint-suppressions.json`; lint fails only on new violations. After fixing old ones run `npx eslint src --prune-suppressions` and commit the smaller file. Never re-run `--suppress-all`. CI (`finance-integration.yml` → `segment:gates -- --segment HFA-CI`) runs this same lint. |
| `npm run typecheck` | `tsc --noEmit -p tsconfig.typecheck.json` |
| `npm run test` | Vitest (happy-dom, includes `src/**/*.test.{ts,tsx}`) |
| `npm run test:watch` | Vitest watch |
| `npx vitest run <path/to/file.test.ts>` | Run a single test file |
| `npx vitest run -t "<name pattern>"` | Run a single test by name |
| `npm run segment:gates -- --segment "<id>"` | **Required** gate runner; add `--ui` when routes/layouts/visuals changed |
| `npm run migrations:check` | SQL migration naming + sequence |
| `npm run migrations:check:hosted` | Refuses `public.`-qualified extension functions that cannot resolve hosted |
| `npm run migrations:verify:pg` | Replay migrations on throwaway Postgres (Docker) |
| `npm run migrations:verify:ledger` | Which migrations are merged but not applied (add `--staging`) |
| `npm run a11y:routes` | Playwright + axe (needs `BASE_URL`) |
| `npm run design:review` | Playwright UI snapshots + report |
| `npm run audit:ci` | `npm audit --audit-level=high` |
| `npm run check:secrets` / `npm run secrets:gitleaks` | Secret scanning |
| `npm run demo:pilot-readiness` | Bundled local probes (set `BASE_URL`) |
| `npm run homewood:test-launch` | Playwright suite against Homewood pilot |

**Gate artifact rule:** Do not call a segment done without a PASS JSON under `test-results/agent-gates/`. CI runs the same bundle via `.github/workflows/ci-gates.yml`.

## Architecture (the parts that span many files)

**Stack:** Next.js 16 App Router (TS) + Supabase (Postgres + RLS + Edge Functions in Deno) + Tailwind v4 + Sentry. Deployed to Netlify (`main` only — see Netlify rule below).

### App Router shape
- `src/app/` uses **route groups** to layer experiences without affecting the URL: `(admin)`, `(caregiver)`, `(med-tech)`, `(dietary)`, `(family)`, `(onboarding)`. Most operator surfaces live under `src/app/(admin)/admin/<segment>/`.
- `next.config.ts` redirects bare `/<segment>` → `/admin/<segment>` for mirrored hubs. Do not add a top-level `/<segment>/page.tsx` if `(admin)/<segment>` exists — the redirect will collide. `check:admin-shell` runs in `build` to enforce this. The redirect list lives in `src/lib/routing/legacy-redirects.ts`; only `(admin)/admin/layout.tsx` mounts the admin shell, so a mirrored `(admin)/<segment>` missing from that list renders with no header or nav (COL-644). `src/lib/routing/route-shell-coverage.test.ts` fails on any such gap and on any unclassified top-level `src/app` folder.
- A `v2` namespace under `(admin)/admin/v2/` is the design-system-composed surface (lint forbids direct primitive imports outside `design-preview/`).

### Design system
- `src/design-system/` exports primitives, templates, and tokens. ESLint plugin `ui-v2` enforces:
  - `no-raw-color`, `no-raw-spacing` (use tokens),
  - `require-kpi-info` (KPI-shaped components need accessibility metadata),
  - `no-direct-primitive-import` inside `v2` pages.
- The `quiet-primitives/enforce-route-markup-quiet-operator` rule applies to HL7 inbound for now and will widen — operator-facing primitives (e.g. `QuietDatePicker`) must not silently pre-fill values. Empty stays empty until the caller supplies controlled `value` or explicit `initialVisibleMonthIso`.

### Data layer (Supabase) — non-negotiables
1. **RLS first.** Every table has RLS enabled before data lands. Use the helpers in `00-foundation.md`: `haven.organization_id()`, `haven.app_role()`, `haven.has_facility_access()`, `haven.accessible_facility_ids()`. Filter `organization_id` first (cheapest), then `facility_id IN (SELECT haven.accessible_facility_ids())`.
2. **Audit everything.** Clinical/financial tables apply the `haven_capture_audit_log` trigger. `audit_log` is immutable — no UPDATE or DELETE policies.
3. **Soft deletes only.** `deleted_at timestamptz NULL`; all queries filter `WHERE deleted_at IS NULL`.
4. **Money in cents.** `integer`. Never `numeric`, `float`, or `money`.
5. **UTC timestamps.** All `timestamptz` is UTC; convert to America/New_York on the frontend.
6. **UUID PKs** (`uuid DEFAULT gen_random_uuid()`). Exceptions: sequence counters (`incident_sequences`, `invoice_sequences`).
7. **Denormalized `organization_id` + `facility_id`** on most tables for RLS performance.

### Migrations
- Sequential `supabase/migrations/NNN_*.sql`. **Get the next number from `npm run migrations:next`, not from the last file in the directory.** The directory answers a question about the past; the contest is about the future, and two branches cut an hour apart both see the same highest number. `migrations:next` also counts numbers claimed by open pull requests. `npm run migrations:check:claims` gates the same thing in CI, and `migrations:check` still enforces ordering once everything has merged.
- After touching migrations: `npm run migrations:verify:pg` (Docker replay).
- **Is it actually applied?** `npm run migrations:verify:ledger` names every migration on your branch that production has not run, and `-- --staging` does the same for Haven HFO Staging. It compares by version and then by name — never `max(version)` — and only ever SELECTs. `.github/workflows/migration-drift.yml` runs it twice a day so merged-but-unapplied surfaces the same day rather than during an unrelated audit.

**Applying to a hosted project.** `supabase db push` does not work on this repo: the 3-digit `NNN_` names collide with the 14-digit `2026…` ones (seven files begin with `202`), so the CLI cannot match remote version `202` to `202_workflow_events.sql`. Do **not** run the `migration repair --status reverted` it suggests — that rewrites the ledger to claim an applied migration was reverted. Apply the file directly instead:

```
supabase db query --linked -f supabase/migrations/NNN_name.sql
```

That sends the exact file through the Management API — no database password, no hand-pasting. Then do both of these, because that path does neither for you:

1. **Reload the PostgREST schema cache.** It answers from a cache; without a reload the new surface 404s and pages reading changed tables fail in ways that point at the page, not the cache. Every migration that changes the API surface should end with `NOTIFY pgrst, 'reload schema';` — most in this repo do not, so check.
2. **Record the ledger row**, or the next person cannot tell an applied migration from a missing one:

```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('NNN', 'name') on conflict (version) do nothing;
```

**`name` is the filename stem with the number stripped.** `411_facility_identity_health_scope_comment.sql` is recorded as `('411', 'facility_identity_health_scope_comment')` — never `('411', '411_facility_identity_health_scope_comment')` and never under a timestamp version if you can avoid it. `check-migration-ledger.mjs` parses each file as `<version>_<name>.sql` and matches on version first, then name; a name carrying its own number prefix matches neither key, so the migration silently reads as *unapplied* and the next person re-runs applied DDL. The Supabase MCP `apply_migration` tool writes whatever `name` you hand it under a generated timestamp version, which makes this easy to get wrong — prefer `execute_sql` for the DDL plus an explicit ledger insert.

**Verify the link before you apply anything.** `supabase/.temp/project-ref` in the shared checkout follows whatever was last rehearsed and is changed by other sessions without warning — it has been observed flipping between production and Haven HFO Staging within a single afternoon. `supabase db query --linked` will cheerfully run production DDL against staging, or the reverse. Either work in your own worktree and `supabase link --project-ref <ref>` it explicitly, or assert the ref before every apply:

```bash
test "$(cat supabase/.temp/project-ref)" = "<expected-ref>" || { echo "WRONG LINK"; exit 1; }
```

Production is `manfqmasfqppukpobpld`; Haven HFO Staging is `iwcnajanvjvynolltflw`. `migrations:verify:ledger` does *not* read the link — it resolves the ref itself — so its output is trustworthy even when the link is not.

**Not every migration is atomic.** Most wrap themselves in `BEGIN; … COMMIT;`, but some do not (`410_assessment_instrument_hold.sql` has only a plpgsql `BEGIN` inside a function body). A non-atomic file that fails halfway leaves the earlier statements applied, so re-running it dies on `42701 column … already exists` while the rest of it is genuinely missing. Before re-running a failed apply, check the objects one at a time rather than trusting the first error.

Migrations applied outside the CLI land under a timestamp version rather than `NNN`, which is why 384, 385 and 387 are recorded as `20260914203602`, `20260914203613` and `20260915182400`. Read the ledger by name, not by `max(version)` — text ordering puts `2026…` below `383`.

**Never schema-qualify an extension function with `public.`.** On a hosted Supabase project pgcrypto lives in `extensions`, so `public.gen_random_uuid()` is `42883: function does not exist` — which is how migration 380 failed hosted after replaying clean locally. Use the bare name (what the other ~128 migrations do; inside `SET search_path = ''` use `pg_catalog.` for built-ins like `gen_random_uuid`, or resolve the schema dynamically with `%I` the way `093` onward do for `crypt`/`gen_salt`). `scripts/pg-verify-stub.sql` now installs pgcrypto into `extensions` so the local replay reproduces this instead of hiding it, and `npm run migrations:check:hosted` fails the build on a `public.`-qualified extension call without needing a database at all.

### Edge Functions
- `supabase/functions/<kebab-case>/` (Deno). Examples: `generate-emar-schedule`, `ar-aging-check`, `exec-alert-evaluator`, `process-referral-hl7-inbound`. Auth-first; secrets via env only; **no PHI in logs**. Shared code under `supabase/functions/_shared/`.

### Lib boundaries
- `src/lib/` holds domain logic (billing, compliance, exec KPIs, audit export, CSV export, etc.) and is the shared seam between RSC pages and route handlers. Prefer typed Supabase `Database` helpers; avoid `as any`.
- `src/features/`, `src/stores/` (Zustand), `src/contexts/`, `src/hooks/` follow standard Next conventions.

## Roles (as of 2026-09-22, COL-615)

Owner rulings by Brian, 2026-09-22. This is the login-role model (`app_role`). Specs, seeds, tests and migrations written before this date may still name the retired roles; treat those names as history, not as roles to build for.

| Role (`app_role`) | Label | Lands on | Notes |
|---|---|---|---|
| `owner` | Owner | `/admin/executive` | |
| `org_admin` | Org Admin | `/admin/executive` | |
| `facility_admin` | Administrator | `/admin` | On-site authority for assigned facilities. |
| `manager` | Manager | `/admin` | |
| `admin_assistant` | Admin Assistant | `/admin/assistant-dashboard` | |
| `coordinator` | Service Coordinator | `/admin/coordinator-dashboard` | |
| `med_tech` | Med-Tech | `/floor` | Holds everything the retired `nurse` and `caregiver` roles held. Lands on the shared floor tablet app (`/floor`, COL-677, spec 40) and also uses the caregiver app (`/caregiver`). `/med-tech` is no longer in their navigation; the route stays until a later retirement. |
| `cook` | Cook | `/dietary` | Holds everything the retired `dietary` and `dietary_aide` roles held. |
| `housekeeper` | Housekeeper | `/caregiver/housekeeper` | Floor app housekeeper paths only (plus clock, schedules, me, policies, acknowledgments, shift swaps). Never clinical. Unlicensed staff who are not Med-Techs are Housekeeping. |
| `maintenance_role` | Maintenance | `/admin/facilities` | |
| `recruiter` | Recruiter | `/admin/referrals` | Finds residents to place. Referrals, pipeline and reputation only; the admin shell refuses it everywhere else. Briefly named `marketing` in PR #671; migration 469 renamed the enum value. Say "Recruiter", never "marketing". |
| `family` | Family Member | `/family` | |
| `broker` | Broker | `/admin/insurance` | |

**Retired (migration `468_role_consolidation.sql`).** `nurse` and `caregiver` ("Caregiver / Resident Aide") folded into `med_tech`; `dietary` ("Lead Cook / Dietary") and `dietary_aide` folded into `cook`. The values still exist in the Postgres enum, but nobody holds them and nothing may grant them. History (audit rows, `actor_role` columns, receipts) keeps the role that acted.

**Login roles are not staff positions.** `staff_role` values (`cna`, `lpn`, `rn`, `resident_aide`, `dietary_staff`, `dietary_aide`, `medication_tech`, `housekeeping` "Housekeeper", `cook`, `marketing_consultant`, ...) are job titles on the staff record. Do not rewrite them as login roles and do not remove them.

**Rule for every migration from 469 on:** grant `med_tech` / `cook`, never `nurse` / `caregiver` / `dietary` / `dietary_aide`. `supabase/tests/review_role_consolidation.sql` fails the replay otherwise (retired literals may appear only inside exclusion lists such as `NOT IN (...)`, where they exclude nobody). Generator and merge recipe: `scripts/role-sweep/generate-nurse-to-med-tech.py`. Code source of truth: `src/lib/rbac.ts` and `src/lib/auth/dashboard-routing.ts`.

## Segment discipline

- **One bounded segment at a time. One atomic commit per segment.** No architecture resets or scope expansion mid-segment without owner approval.
- After implementation: `npm run segment:gates -- --segment "<id>"` (`--ui` when visuals/routes changed; also runs axe on the same routes unless `--no-a11y`).
- Conventional commits (`feat:`, `fix:`, `chore:`). Handoff template at `agents/templates/segment-handoff.md`.
- Phase status: Phases 1–3 core modules shipped; current focus is **Track A** closeout + hardening, then Module 25 (Resident Assurance Engine). Do not start new modules while Track A is open.

## Deploys

**Netlify auto-publishes from `main` only** (`circleoflifealf` / `Circle-of-Life`). Pushes to other branches do not update production. Ship via PR or local merge into `main`, then `git push origin main`.

## Naming conventions

- Tables / columns / enum types / enum values: `snake_case` (tables plural).
- Indexes: `idx_{table}_{column(s)}`.
- RLS policies: descriptive English (`"Staff see residents in accessible facilities"`).
- Edge Functions and API routes: `kebab-case`.
- TS path alias: `@/*` → `src/*`.

## Secrets

`.env.local` (gitignored). Specs name the variables, never the values. `check:env-example` blocks JWT-like values from `.env.example`; `check:secrets` and `secrets:gitleaks` scan tracked files. The Supabase project is `https://manfqmasfqppukpobpld.supabase.co` (America/New_York).

## COL context you need before touching specs

- 5 facilities, 5 LLCs — multi-tenant + multi-entity from the start.
- Medicaid MCOs per facility (FCC, Sunshine Health, Humana, WellCare, UHC).
- **Baya** is the external med-training partner; Module 06 must not assume in-house only.
- **Form 1823** (FL AHCA Physician's Report) is the legal admission entry point — first-class doc in Module 02.
- **DCF coordination** (Medicaid admission/discharge, Form 2506) and **Representative Payee / SSA-787** are real workflows.
- Pilot facility: **Oakridge ALF** (Lafayette County, ~52 beds). UI validation, seeds, and UAT run against Oakridge first.
