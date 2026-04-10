<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Haven — App Builder System Prompt

## Mission (non-negotiable ship gate)

> **North star:** Build **Haven** — a unified operations platform for **assisted living facilities** (ALF), **home health**, and **home- and community-based care** — so multi-site, multi-entity operators can run clinical workflows, compliance, workforce, family engagement, and business operations on **one secure, role-governed data layer**. Improve **resident safety and quality**, **regulatory readiness**, **staff clarity**, and **owner visibility**. Use **AI** to reduce administrative burden and surface risk early; it must remain **subordinate to human judgment, licensure rules, and auditability**.

Mission alignment (`pass` | `risk` | `fail`) must be recorded in every segment handoff. Misalignment can block release even when tests pass.

---

## Who You Are Building For

**Client:** Circle of Life (COL) — 5 Florida ALF facilities (Oakridge, Rising Oaks, Homewood Lodge, Plantation, Grande Cypress). Oakridge ALF is the pilot facility. All facilities are in the America/New_York timezone and fall under Florida AHCA Chapter 429 / FAC 59A-36 regulations.

**Supabase project:** https://manfqmasfqppukpobpld.supabase.co
**Stack:** Next.js + TypeScript + Tailwind + Supabase (PostgreSQL, RLS, Edge Functions) + Netlify

---

## Where Everything Lives

| Resource | Path |
|----------|------|
| **This file (agent operating guide)** | `AGENTS.md` |
| **Engineer command contract** | `CODEX.md` |
| **Spec folder (source of truth for what to build)** | `docs/specs/` |
| **Spec index + build sequence** | `docs/specs/README.md` |
| **Roadmap orientation (read-only context)** | `docs/roadmap-overview.md` |
| **Current closeout roadmap (Track A)** | `docs/specs/TRACK-A-CLOSEOUT-ROADMAP.md` |
| **COL wiki & roadmap gap analysis** | `docs/haven-gap-analysis.docx` |
| **Phase 1 closure record** | `docs/specs/PHASE1-CLOSURE-RECORD.md` |
| **Phase 1 acceptance checklist** | `docs/specs/PHASE1-ACCEPTANCE-CHECKLIST.md` |
| **Phase 2 acceptance checklist** | `docs/specs/PHASE2-ACCEPTANCE-CHECKLIST.md` |
| **Frontend route contract** | `docs/specs/FRONTEND-CONTRACT.md` |
| **Agent registry** | `agents/registry.yaml` |
| **Agent playbooks** | `agents/playbooks/` |
| Gate report schema | `agents/schemas/gate-report.schema.json` |
| Segment gate runner | `scripts/agent-gates/run-segment-gates.mjs` |
| Gate JSON artifacts | `test-results/agent-gates/` |

---

## Spec File System — How to Read a Spec

Every module has its own markdown file in `docs/specs/`. Each spec contains: schema DDL (complete CREATE TABLE statements), RLS policies, business rules, API endpoints, Edge Functions, and UI screens. Build from specs + owner messages — not from the roadmap overview alone.

**Spec status as of 2026-04-08:**

| Status | Meaning |
|--------|---------|
| `FULL` | Complete: DDL, RLS, API contracts, UI screens, business rules, edge functions. Engineer can build from it today. |
| `PARTIAL` | Core schema present; some sections (API contracts, UI screens, business rules) incomplete. Read carefully — implement what is defined, flag what is missing. |
| `STUB` | Skeleton only. Table definitions exist but workflows and UI are not designed. Do not build until owner promotes to PARTIAL. |
| `+ COL notes` | A `## COL Alignment Notes` section has been appended with Circle of Life-specific context. **Read this section before implementing.** It contains real client workflow details, vendor names, regulatory specifics, and items where the generic spec diverges from COL's actual operations. |

**Current spec status by module:**

| Module | Spec File | Status |
|--------|-----------|--------|
| 00 Foundation | `00-foundation.md` | FULL + COL notes |
| 00 Foundation Regulatory | `00-foundation-regulatory.md` | PARTIAL + COL notes |
| 01 Referral & Inquiry | `01-referral-inquiry.md` | PARTIAL + COL notes |
| 02 Admissions | `02-admissions-move-in.md` | PARTIAL + COL notes |
| 03 Resident Profile | `03-resident-profile.md` | FULL + COL notes |
| 03 Resident Profile Advanced | `03-resident-profile-advanced.md` | PARTIAL + COL notes |
| 04 Daily Operations | `04-daily-operations.md` | FULL + COL notes |
| 04 Daily Ops Offline | `04-daily-operations-offline.md` | STUB |
| 05 Discharge & Transition | `05-discharge-transition.md` | PARTIAL + COL notes |
| 06 Medication Management | `06-medication-management.md` | FULL + COL notes |
| 07 Incident Reporting | `07-incident-reporting.md` | FULL + COL notes |
| 08 Compliance Engine | `08-compliance-engine.md` | FULL + COL notes |
| 09 Infection Control | `09-infection-control.md` | FULL + COL notes |
| 10 Quality Metrics | `10-quality-metrics.md` | PARTIAL + COL notes |
| 11 Staff Management | `11-staff-management.md` | FULL + COL notes |
| 12 Training & Competency | `12-training-competency.md` | PARTIAL (promoted 2026-04-08) |
| 13 Payroll Integration | `13-payroll-integration.md` | STUB — BLOCKED (COL payroll vendor unknown) |
| 14 Dietary & Nutrition | `14-dietary-nutrition.md` | PARTIAL (promoted 2026-04-08) |
| 15 Transportation | `15-transportation.md` | PARTIAL (promoted 2026-04-08) |
| 16 Billing & Collections | `16-billing.md` | FULL + COL notes |
| 17 Entity Finance | `17-entity-facility-finance.md` | PARTIAL + COL notes |
| 18 Insurance & Risk | `18-insurance-risk-finance.md` | PARTIAL + COL notes |
| 19 Vendor Management | `19-vendor-contract-management.md` | PARTIAL + COL notes |
| 21 Family Portal | `21-family-portal.md` | PARTIAL + COL notes |
| 22 Referral CRM | `22-referral-crm.md` | STUB |
| 23 Reputation | `23-reputation.md` | STUB |
| 24 Executive Intelligence | `24-executive-intelligence.md` | FULL + COL notes |
| 24 Executive Intelligence v2 | `24-executive-v2.md` | STUB |
| 25 Resident Assurance Engine | `25-resident-assurance-engine.md` | PARTIAL + COL notes |
| 26 Reporting Module | `26-reporting-module.md` | STUB |

---

## Current Build Position

**YOU ARE HERE: Closeout + hardening before expanding scope.**

Phases 1, 2, and 3 core modules are shipped. You are NOT at the start of a new feature phase. Execute in this order before anything else:

### Step 1 — Track A: Phase 1 Acceptance Closeout
Read `docs/specs/TRACK-A-CLOSEOUT-ROADMAP.md` in full before doing anything. This is the single execution roadmap for closing Phase 1.

Blockers requiring owner action (not agent action):
- ~~**A1 Auth unblock**~~ — **Cleared (2026-04-09)** for pilot JWTs + migrations `110`–`111`; see `docs/specs/PHASE1-AUTH-DEBUG-HANDOFF.md` if Auth regresses.
- ~~**A2 RLS matrix**~~ — **PASS** (owner sign-off, single-facility pilot); re-run **RLS-02** when a second facility exists — `docs/specs/PHASE1-RLS-VALIDATION-RECORD.md`.
- **A5 Pro/BAA/PITR:** Owner must confirm Pro plan, signed BAA, and Point-in-Time Recovery are active before any PHI enters production.
- **A3 Live UAT (depth):** Owner or delegated tester must complete `PHASE1-ACCEPTANCE-CHECKLIST.md` §B–§E rows in `PHASE1-EXECUTION-LOG.md` (§A + RLS owner-verified 2026-04-09).

Agent-executable steps: migration parity checks, script generation, gate recording, doc updates.

### Step 2 — Platform Hardening ✅ **closed (engineering)** (2026-04-09)
Automated regression (`ci-gates.yml` auth-smoke, nightly `ci-nightly.yml`), observability (Sentry SDK + structured Edge Function logs per `docs/specs/OBSERVABILITY-SPEC.md`), CI hardening (bundle-size budget per `docs/specs/CI-HARDENING-SPEC.md`), ops runbook updated (`docs/specs/PHASE1-OPS-VERIFICATION-RUNBOOK.md`). **No open Track B repo issues** — ongoing CI/Sentry work is operational, not backlog under “Track B.”

### Step 3 — Workflow Hardening ✅ **closed (engineering)** (2026-04-09)
Track C delivered per `docs/specs/TRACK-C-WORKFLOW-HARDENING.md` (Edge: `ar-aging-check`, `generate-emar-schedule`, `emar-missed-dose-check`, `exec-alert-evaluator`, plus existing billing/audit/exec KPI functions; lifecycle runbooks). **No open Track C implementation issues.** Per-project **deploy + secrets + crons** are **operations** (same doc); depth UAT remains in `PHASE1-EXECUTION-LOG.md` under **Track A**.

### Step 4 — Phase 6 Completion Pass ✅ (segments D1–D10 + D12–D57, 2026-04-09)
Modules 11 (Staff), 12 (Training), 13 (Payroll), 14 (Dietary), 15 (Transportation), 22 (Referral CRM), 23 (Reputation) — COL Alignment Notes still govern **Enhanced** backlog. **Track D** execution log: `docs/specs/TRACK-D-PHASE6-PASS.md` (gate artifacts per segment). **Shipped:** D1–D7 Module 15 transport (expiry → `112`/`113` requests + mileage → day-grouped list); **D10** migration `114` org mileage rate + `/admin/transportation/settings`; D2/D3/D8 training + dietary hubs; D4 referrals HL7 counts + reputation SYS label; D9 reputation posted-reply metric; **D12** Edge `process-referral-hl7-inbound`; **D13** `/admin/dietary/clinical-review`; **D14** `/admin/transportation/calendar`; **D15** `/admin/transportation/mileage-approvals`; **D16** HL7 inbound manual **Draft lead**; **D17** `/admin/payroll/[id]` mileage → `payroll_export_lines`; **D18** payroll batch **CSV** download; **D19** `/admin/reputation` **replies CSV**; **D20** `/admin/training` **All facilities** org-wide competency list (RLS); **D21** `/admin/training` **demonstrations CSV**; **D22** `/admin/referrals/hl7-inbound` **queue CSV**; **D23** `/admin/dietary` **diet orders CSV**; **D24** `/admin/transportation` **transport requests CSV**; **D25** `/admin/transportation/mileage-approvals` **mileage logs CSV**; **D26** `/admin/payroll` **batches list CSV**; **D27** `/admin/referrals` **pipeline leads CSV**; **D28** `/admin/reputation` **accounts CSV**; **D29** `/admin/staff` **roster CSV**; **D30** `/admin/certifications` **certifications CSV**; **D31** `/admin/time-records` **time records CSV**; **D32** `/admin/staffing` **ratio snapshots CSV**; **D33** `/admin/schedules` **schedule weeks CSV**; **D34** shared **`src/lib/csv-export`** for all hub CSVs; **D35** `/admin/schedules/[id]` **shift assignments** list + CSV + new-week redirect to detail; **D36** `/admin/shift-swaps` **`shift_swap_requests`** list + CSV; **D37** `/admin/shift-swaps` **approve/deny** (pending); **D38** migration **`116`** **`training_programs`** + **`staff_training_completions`** + `/admin/training` **completions list + CSV**; **D39** `/admin/training/completions/new` **log completion** form; **D40** migration **`117`** completion **PDF** + hub column; **D41** migration **`118`** **`inservice_log_sessions`** + **`inservice_log_attendees`**; **D42** **`/admin/training`** in-service list + CSV + **`/admin/training/inservice/new`**; **D43** **`/admin/training/inservice/new`** **catalog program → `staff_training_completions`** per attendee; **D44** **`/admin/reputation/integrations`** + migration **`119`** **Google OAuth** token store (owner connect); **D45** **`POST /api/reputation/sync/google`** manual Google **review import** (draft `reputation_replies`); **D46** **`POST /api/cron/reputation/google-reviews`** secret-gated **scheduled** import (same logic); **D47** **`POST /api/reputation/sync/yelp`** Yelp Fusion excerpt import (API key); **D48** **`POST /api/reputation/replies/[id]/post-google`** Google **updateReply**; **D49** **`POST /api/reputation/replies/[id]/post-yelp`** Yelp Partner **public reply**; **D50** **`/admin/dietary/clinical-review`** **liquid-form vs thickened-fluid** advisory (`med-fluid-diet-hints.ts`); **D51**–**D52** **solid oral vs texture-modified food** (IDDSI 3–6; **D52** expands levels 5–6); **D53** **IDDSI labels in hint callouts**; **D54** **`/dietary` → `/admin/dietary`** redirects (`next.config.ts`); **D55** **`/<segment>` → `/admin/<segment>`** for all mirrored `(admin)` hub roots (`next.config.ts`); **D56** **`/admin/transportation/calendar`** **Month** grid (Week/Month toggle); **D57** same route **`.ics`** export (loaded window). **Plan + remaining Enhanced items (D58+):** `docs/specs/TRACK-D-ENHANCED-BACKLOG-PLAN.md`; README **Track D** section; execution log `docs/specs/TRACK-D-PHASE6-PASS.md`.

### Step 5 — Module 25: Resident Assurance Engine
Then remaining strategic modules in order per owner direction.

**Do not start new modules while Track A is open.**

---

## Non-Negotiable Build Rules

1. **RLS first.** Every table must have RLS enabled and policies applied before any data enters. The RLS helper functions in `00-foundation.md` (`haven.organization_id()`, `haven.app_role()`, `haven.has_facility_access()`, `haven.accessible_facility_ids()`) must exist before any dependent table's policies.

2. **Audit everything.** Every clinical or financial table must have the audit trigger applied (`haven_capture_audit_log`). The `audit_log` table is immutable — no UPDATE or DELETE policies. Ever.

3. **Soft deletes only.** No hard deletes on clinical, financial, or staff data. Use `deleted_at timestamptz NULL`. All queries filter `WHERE deleted_at IS NULL`.

4. **Money in cents.** All monetary values stored as `integer` (cents). No `numeric`, `float`, or `money` type.

5. **UTC timestamps.** All `timestamptz` columns store UTC. Frontend converts to America/New_York for display.

6. **UUIDs for all PKs.** `uuid DEFAULT gen_random_uuid()`. No serial/autoincrement except sequence counters.

7. **Denormalized `organization_id` + `facility_id` on most tables.** RLS filters `organization_id` first (cheapest), then `facility_id IN (SELECT haven.accessible_facility_ids())`.

8. **No secrets in code.** Keys go in `.env.local` (gitignored). Spec files describe variable names, never values.

9. **One segment at a time. One atomic commit per completed segment.** Run `npm run segment:gates -- --segment "<id>"` after each. Gate artifact required in `test-results/agent-gates/` before calling a segment done.

10. **Read the COL Alignment Notes.** Every spec with `## COL Alignment Notes` contains client-specific context that overrides or supplements the generic spec. Read it before implementing the module.

---

## COL-Specific Context You Must Know

- **5 facilities, 5 legal entities (LLCs).** Multi-tenant and multi-entity from the start.
- **Medicaid MCOs per facility:** FCC, Sunshine Health, Humana, WellCare, UHC (5–6 per facility). These are active payer relationships, not hypothetical.
- **Baya** is COL's external medication training partner. Baya-issued competency certificates are tracked in Module 12. The medication spec (Module 06) must not assume all medication training is in-house.
- **Form 1823** (FL AHCA Physician's Report) is the legal entry point for every ALF admission. It is a first-class tracked document in Module 02, not a footnote.
- **DCF coordination** (Department of Children & Families) is a real workflow at COL for Medicaid residents — at admission (eligibility review) and discharge (DCF Form 2506 notice).
- **Representative Payee / SSA-787** arrangements exist for some residents. Module 02 must model this.
- **Pilot facility is Oakridge ALF** (Lafayette County, FL, ~52 beds). All UI validation, seed data, and UAT runs against Oakridge first.

---

## Naming Conventions

- **Tables:** snake_case, plural (`residents`, `care_plans`, `emar_records`)
- **Columns:** snake_case (`first_name`, `created_at`, `facility_id`)
- **Enum types:** snake_case (`incident_severity`, `bed_status`)
- **Enum values:** snake_case (`level_1`, `fall_with_injury`, `private_pay`)
- **Indexes:** `idx_{table}_{column(s)}`
- **RLS policies:** descriptive English (`"Staff see residents in accessible facilities"`)
- **Edge Functions:** kebab-case (`generate-emar-schedule`, `incident-created`)
- **API routes:** kebab-case (`/residents/:id/care-plan`)

---

## Environment Variables (never commit values)

Define in `.env.local` (gitignored). Specs describe variable names, never values.

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
EXEC_KPI_SNAPSHOT_SECRET=
```

Additional variables are documented in individual spec files as features require them (e.g. VAPID keys for push notifications, SendGrid/Twilio for alerts). See each module's spec for its variable requirements.

---

## Autonomous Segment Discipline

- One segment at a time; one atomic commit per completed segment.
- No architecture reset without explicit approval.
- After implementation, run **`npm run segment:gates -- --segment "<segment-id>"`** (`--ui` when visual or routing work changed — also runs axe on the same routes unless `--no-a11y`). CI runs the same gate bundle via `.github/workflows/ci-gates.yml` (includes gitleaks, audit, ESLint, Docker migration replay).
- Security, RLS, and workspace boundaries are part of the gate model — not a post-release afterthought.

## Engineer / Codex Entrypoint

See **`CODEX.md`** for the command contract and commit discipline.

## Detailed Build Sequence

See **`docs/specs/README.md`** for the full phase-by-phase build sequence, migration numbers, module reference, and phase gate checklists.
