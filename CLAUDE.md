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
| `npm run build` | Runs `migrations:check` + `check:admin-shell` + `check:memory-care` then `next build` |
| `npm run lint` | ESLint `src/` with `--max-warnings 0`, then `lint:constitution` |
| `npm run typecheck` | `tsc --noEmit -p tsconfig.typecheck.json` |
| `npm run test` | Vitest (happy-dom, includes `src/**/*.test.{ts,tsx}`) |
| `npm run test:watch` | Vitest watch |
| `npx vitest run <path/to/file.test.ts>` | Run a single test file |
| `npx vitest run -t "<name pattern>"` | Run a single test by name |
| `npm run segment:gates -- --segment "<id>"` | **Required** gate runner; add `--ui` when routes/layouts/visuals changed |
| `npm run migrations:check` | SQL migration naming + sequence |
| `npm run migrations:verify:pg` | Replay migrations on throwaway Postgres (Docker) |
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
- `next.config.ts` redirects bare `/<segment>` → `/admin/<segment>` for mirrored hubs. Do not add a top-level `/<segment>/page.tsx` if `(admin)/<segment>` exists — the redirect will collide. `check:admin-shell` runs in `build` to enforce this.
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
- Sequential `supabase/migrations/NNN_*.sql`. Check `docs/Autonomous.md` and the latest file in `supabase/migrations/` for the next free number; `migrations:check` enforces ordering.
- After touching migrations: `npm run migrations:verify:pg` (Docker replay).

### Edge Functions
- `supabase/functions/<kebab-case>/` (Deno). Examples: `generate-emar-schedule`, `ar-aging-check`, `exec-alert-evaluator`, `process-referral-hl7-inbound`. Auth-first; secrets via env only; **no PHI in logs**. Shared code under `supabase/functions/_shared/`.

### Lib boundaries
- `src/lib/` holds domain logic (billing, compliance, exec KPIs, audit export, CSV export, etc.) and is the shared seam between RSC pages and route handlers. Prefer typed Supabase `Database` helpers; avoid `as any`.
- `src/features/`, `src/stores/` (Zustand), `src/contexts/`, `src/hooks/` follow standard Next conventions.

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
