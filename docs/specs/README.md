# Haven — Implementation Specs

**This folder is the single source of truth for building Haven.** When spec content conflicts with the roadmap overview, trust these specs.

## Supabase Project
- **URL:** https://manfqmasfqppukpobpld.supabase.co
- **Timezone:** America/New_York (all facilities in North Florida)
- **Critical:** Confirm Pro plan with signed BAA before any PHI enters. Confirm Point-in-Time Recovery enabled.

## Build Execution Order

Claude Code executes migrations and builds features in this exact sequence. Do not skip ahead. Each spec contains: database schemas (complete CREATE TABLE statements), RLS policies, business rules, API endpoints, Edge Functions, UI screens, and offline behavior.

For frontend stack, route naming, and Phase 1 UI scope locks, use `FRONTEND-CONTRACT.md` as the canonical source.

### Phase 1: Foundation & Core Operations (Weeks 1-12)

| Order | Spec File | Module | Weeks | What It Creates |
|-------|-----------|--------|-------|-----------------|
| 1 | `00-foundation.md` | Multi-tenant schema, auth, RBAC | 1-2 | Enum types, organizations, entities, facilities, units, rooms, beds, user_profiles, user_facility_access, family_resident_links, RLS helper functions, audit log system, census_daily_log, COL seed data |
| 2 | `03-resident-profile.md` | Resident Profile & Care Planning | 3-4 | residents, care_plans, care_plan_items, assessments, resident_photos, resident_contacts, resident_documents, assessment_templates (Katz ADL, Morse Fall, Braden, PHQ-9) |
| 3 | `04-daily-operations.md` | Daily Operations & Logging | 5-6 | daily_logs, adl_logs, resident_medications, emar_records, behavioral_logs, condition_changes, shift_handoffs, activities, activity_sessions, activity_attendance |
| 4 | `07-incident-reporting.md` | Incident & Risk Management | 7-8 | incidents, incident_followups, incident_photos, incident_sequences |
| 5 | `11-staff-management.md` | Staff Management & Scheduling | 9-10 | staff, staff_certifications, schedules, shift_assignments, time_records, shift_swap_requests, staffing_ratio_snapshots |
| 6 | `16-billing.md` | Resident Billing & Collections | 11-12 | rate_schedules, resident_payers, invoices, invoice_line_items, payments, collection_activities, invoice_sequences |

### Phase 1 execution interlock: UI scaffold first (added 2026-03-30)

Before implementing Step 4 (`07-incident-reporting.md`), run a focused **one-week Admin UI scaffold sprint** to stabilize IA and reusable page patterns:

- Build scaffold pages and route wiring for `/admin/residents`, `/admin/incidents`, `/admin/staff`, `/admin/billing`.
- Standardize shared Admin patterns (header, filter bar, table shell, loading/empty/error states).
- Keep data mocked or adapter-backed during this sprint; do not block on backend wiring.
- Avoid adding new database migrations during this UI-only interlock unless explicitly approved.

After this scaffold sprint, resume backend spec implementation in original order: **07 -> 11 -> 16**.

**Phase 1 Milestone:** At Week 12, COL can run daily operations on the platform at 1 pilot facility (Oakridge ALF). Caregivers document care, administer medications via eMAR, report incidents, view schedules, and clock in/out. Administrators manage staff, certifications, billing, and view facility dashboard.

**Sign-off:** Use [PHASE1-ACCEPTANCE-CHECKLIST.md](./PHASE1-ACCEPTANCE-CHECKLIST.md) for full UAT; **closure verdict** (PASS / PASS WITH WAIVERS / not complete) lives in [PHASE1-CLOSURE-RECORD.md](./PHASE1-CLOSURE-RECORD.md). Environment CLI checks: [PHASE1-ENV-CONFIRMATION.md](./PHASE1-ENV-CONFIRMATION.md). Engineering vs full acceptance: [PHASE1-PHASE2-OFFICIAL-SIGNOFF-REVIEW.md](./PHASE1-PHASE2-OFFICIAL-SIGNOFF-REVIEW.md).

### Phase 2: Clinical Depth & Compliance (Weeks 13-20)

**Scope & tiering guide:** `PHASE2-SCOPE.md` — defines Core/Enhanced/Future tiers per module. Specs implement Core; Enhanced is stretch; Future is explicitly deferred.

**Phase 2 Milestone:** At Week 20, Haven enables one pilot facility to document structured assessments, maintain editable care plans, manage advanced medication workflows and controlled-substance accountability, monitor infections and vitals trends, and track survey/compliance deficiencies with operator-visible dashboards and follow-up workflows.

**Sign-off:** Phase 2 acceptance is recorded in [PHASE2-ACCEPTANCE-CHECKLIST.md](./PHASE2-ACCEPTANCE-CHECKLIST.md) and summarized with Phase 1 in [PHASE1-PHASE2-OFFICIAL-SIGNOFF-REVIEW.md](./PHASE1-PHASE2-OFFICIAL-SIGNOFF-REVIEW.md).

| Order | Spec File | Module | Weeks | What It Adds |
|-------|-----------|--------|-------|--------------|
| 7 | `03-resident-profile-advanced.md` | Care Planning Advanced | 13-14 | Assessment entry + auto-scoring, care plan editing/versioning, acuity scoring, task generation from care plan items |
| 8 | `06-medication-management.md` | Medication Management Advanced | 15-16 | PRN effectiveness prompts, medication error capture/trending, verbal orders, controlled substance count workflow |
| 9 | `09-infection-control.md` | Infection Control & Health Monitoring | 17-18 | Infection surveillance, vitals trending + alerts, outbreak detection/management, staff illness tracking |
| 10 | `08-compliance-engine.md` | Compliance Engine | 19-20 | Deficiency tracking, plans of correction, compliance dashboard, survey visit mode, policy library |

### Phase 3–7: Specs added on a rolling basis, always one phase ahead of build.

**Phase 3 (orientation alignment with `docs/roadmap-overview.md`):** business and multi-entity depth — Modules **17** (Entity & Facility Finance), **18** (insurance & risk finance), **19** (vendor & contract management), **24** (executive intelligence v1). Implement only after a numbered spec exists in this folder.

### Phase 3: Multi-entity finance & operations (Weeks 21+)

| Order | Spec File | Module | Weeks | What It Adds |
|-------|-----------|--------|-------|--------------|
| 11 | `17-entity-facility-finance.md` | Entity & Facility Finance | 21–22 (slice 1) | Chart of accounts, journal entries/lines, read-only ledger; RLS; integration hooks to Module 16 (no auto-posting in slice 1) |

## Module Number Reference

Module numbers match the roadmap (27 modules total), NOT the build sequence. Not every module number has a Phase 1 spec because Modules 1, 2, 5 are Phase 4 features.

| Module # | Name | Phase | Spec Status |
|----------|------|-------|-------------|
| 1 | Referral & Inquiry Management | 4 | Not yet spec'd |
| 2 | Admissions & Move-In | 4 | Not yet spec'd |
| 3 | Resident Profile & Care Planning | 1 (core) + 2 (advanced) | ✅ Core spec complete |
| 4 | Daily Operations & Logging | 1 | ✅ Spec complete |
| 5 | Discharge & Transition | 4 | Not yet spec'd |
| 6 | Medication Management | 1 (basic in 04) + 2 (advanced) | Basic in `04-daily-operations.md`. Advanced: `06-medication-management.md` |
| 7 | Incident & Risk Management | 1 | ✅ Spec complete |
| 8 | Autonomous Compliance Engine | 2 | `08-compliance-engine.md` |
| 9 | Infection Control & Health Monitoring | 2 | `09-infection-control.md` |
| 10 | Quality Metrics & Outcomes | 5 | Not yet spec'd |
| 11 | Staff Management & Scheduling | 1 | ✅ Spec complete |
| 12 | Training & Competency Management | 6 | Not yet spec'd |
| 13 | Facility Maintenance & Environment | 6 | Not yet spec'd |
| 14 | Dietary & Nutrition Management | 6 | Not yet spec'd |
| 15 | Transportation & Appointments | 6 | Not yet spec'd |
| 16 | Resident Billing & Collections | 1 | ✅ Spec complete |
| 17 | Entity & Facility Finance | 3 | `17-entity-facility-finance.md` |
| 18 | Insurance & Risk Finance | 3 | Not yet spec'd |
| 19 | Vendor & Contract Management | 3 | Not yet spec'd |
| 20 | Expansion & Acquisition Planning | 7 | Not yet spec'd |
| 21 | Family Portal | 5 | Not yet spec'd |
| 22 | Referral Source CRM | 6 | Not yet spec'd |
| 23 | Reputation & Online Presence | 6 | Not yet spec'd |
| 24 | Executive Intelligence Layer | 3 (v1) + 7 (v2) | Not yet spec'd |
| 25 | Ambient Environment Intelligence | 5 | Not yet spec'd |
| 26 | Facility Digital Twin | 6 | Not yet spec'd |
| 27 | Regulatory Intelligence & Arbitrage | 7 | Not yet spec'd |

## Implementation note (Supabase migrations in repo)

Migrations under `supabase/migrations/` implement this foundation using schema **`haven`** for RLS helpers (`haven.organization_id()`, `haven.app_role()`, etc.) because **`auth` is reserved** by Supabase for platform objects. Behavior matches the spec; only the schema name differs from the `auth.*` snippets in `00-foundation.md`.

When applying SQL through **non-CLI** paths (e.g. some HTTP/MCP runners), prefer **`$func$ … $func$`** (or another non-`$$` delimiter) for function bodies so payloads are not mangled. The repo uses **`npm run migrations:verify:pg`** (Docker Postgres + auth stub) in gates to catch DDL regressions early.

## Critical Build Rules

1. **RLS first.** Every table must have Row Level Security enabled and policies applied before any data enters. Create the **haven** helper functions in migration `004_haven_rls_helpers.sql` before other tables’ policies (equivalent to the `auth.*` helpers described in `00-foundation.md`).

2. **Audit everything.** Every table that stores clinical or financial data must have the audit trigger from `00-foundation.md` applied. The `audit_log` table is immutable — no UPDATE or DELETE policies.

3. **Soft deletes only.** No hard deletes on any clinical, financial, or staff data. Use `deleted_at timestamptz NULL`. Queries filter `WHERE deleted_at IS NULL`.

4. **Money in cents.** All monetary values stored as `integer` (cents). $252,412.65 = 25241265. No `numeric`, no `float`, no `money` type.

5. **Timestamps in UTC.** All `timestamptz` columns store UTC. Frontend converts to America/New_York for display. The `timezone` column on organizations and facilities is for display conversion only.

6. **UUIDs for PKs.** All primary keys are `uuid DEFAULT gen_random_uuid()`. No serial/autoincrement except for sequence counters (incident_sequences, invoice_sequences).

7. **Denormalized `organization_id` and `facility_id`.** Most tables carry both for RLS performance. Policies filter on `organization_id = haven.organization_id()` first, then `facility_id IN (SELECT haven.accessible_facility_ids())` (see migrations).

8. **No secrets in code.** Supabase service role key, API keys, and production credentials go in `.env.local` (gitignored). Spec files describe the variables needed, never the values.

## Naming Conventions

- **Tables:** snake_case, plural (`residents`, `care_plans`, `emar_records`)
- **Columns:** snake_case (`first_name`, `created_at`, `facility_id`)
- **Enum types:** snake_case (`incident_severity`, `bed_status`)
- **Enum values:** snake_case (`level_1`, `fall_with_injury`, `private_pay`)
- **Indexes:** `idx_{table}_{column(s)}` (`idx_residents_facility`, `idx_incidents_severity`)
- **RLS policies:** descriptive English (`"Staff see residents in accessible facilities"`)
- **Edge Functions:** kebab-case (`generate-emar-schedule`, `incident-created`)
- **API routes:** kebab-case (`/residents/:id/care-plan`, `/facilities/:id/ar-aging`)

## Secrets / Environment Variables

Define these in `.env.local` (never committed):

```
SUPABASE_URL=https://manfqmasfqppukpobpld.supabase.co
SUPABASE_ANON_KEY=<from Supabase dashboard>
SUPABASE_SERVICE_ROLE_KEY=<from Supabase dashboard — server-side only, never expose to client>
ANTHROPIC_API_KEY=<if/when AI features are built — Phase 5+>
SENDGRID_API_KEY=<or equivalent email service>
TWILIO_ACCOUNT_SID=<for SMS alerts>
TWILIO_AUTH_TOKEN=<for SMS alerts>
```