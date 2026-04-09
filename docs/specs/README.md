# Haven — Implementation Specs

**This folder is the single source of truth for building Haven.** When spec content conflicts with the roadmap overview, trust these specs.

## Supabase Project

- **URL:** https://manfqmasfqppukpobpld.supabase.co
- **Timezone:** America/New_York (all facilities in North Florida)
- **Critical:** Confirm Pro plan with signed BAA before any PHI enters. Confirm Point-in-Time Recovery enabled.

## Current state (reconciled 2026-04-09)

**Repo migrations:** **`001`–`115`** — verify with `npm run migrations:check` and `npm run migrations:verify:pg` before release.

**Where acceptance stands**

| Layer | Status | Authoritative file |
|-------|--------|-------------------|
| Phase 1 — engineering (lint, build, replay, gates) | **PASS** | [PHASE1-CLOSURE-RECORD.md](./PHASE1-CLOSURE-RECORD.md) |
| Phase 1 — full acceptance (real auth, RLS matrix, UAT, Pro/BAA/PITR) | **NOT COMPLETE** — **Track A:** A1+A2 **done** (2026-04-09); A3–A6 remain | [TRACK-A-CLOSEOUT-ROADMAP.md](./TRACK-A-CLOSEOUT-ROADMAP.md), [PHASE1-ACCEPTANCE-CHECKLIST.md](./PHASE1-ACCEPTANCE-CHECKLIST.md) |
| Phase 2 — acceptance | **PASS** (2026-04-04) | [PHASE2-ACCEPTANCE-CHECKLIST.md](./PHASE2-ACCEPTANCE-CHECKLIST.md) |
| Phases 3–6 — Core DDL + primary UI | **Shipped** in repo | Phase tables below |
| Phases 3–6 — live proof / operational hardening | **Incomplete** until Track A closes; Tracks B–C done; **Track D** Core **D1–D10** + Enhanced **D12–D21** shipped (see [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md)) — further Enhanced backlog per plan | Same tables + [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md) |

**Important:** Code and migrations have **outpaced** formal Phase 1 acceptance. **Do not** treat “migrations applied” or “routes exist” as equivalent to **Track A closed** or **production-ready** for PHI.

**Next free migration number:** **`116`** — use for all new DDL after updating this README and the relevant spec.

**Post–Phase 6 work already in repo (`096`–`109`)** — see [Post–Phase 6 shipped work](#postphase-6-shipped-work-migrations-096109) below. Older roadmap drafts that reserved `096`+ for “digital twin” or “maintenance” are **obsolete**; those migration numbers are now consumed as listed.

### What to do next (closeout order)

1. **Track A** — **A1** (auth) + **A2** (RLS) owner-verified **2026-04-09**; **A3** real-auth UAT depth → **A4** env/seed → **A5** Pro/BAA/PITR → **A6** waiver review. Single roadmap: [TRACK-A-CLOSEOUT-ROADMAP.md](./TRACK-A-CLOSEOUT-ROADMAP.md). Production PHI still requires **A5** and remaining UAT rows.
2. **Confirm remote DB** — `supabase migration list` on the target project must match **local `001`–`115`** before claiming parity.
3. **Tracks B–C** — **Done (code)** per sections below; owner deploy/cron/UAT follow-up where noted.
4. **Track D** — **Segments D1–D10** (2026-04-09) + Enhanced **D12–D21** (incl. payroll **D17–D18**, reputation **D19**, training **D20–D21**) **shipped** (2026-04-09). Core operational visibility for Phase 6 modules 12, 14, 15, 22, 23 is in repo. **Enhanced backlog (D22+):** [TRACK-D-ENHANCED-BACKLOG-PLAN.md](./TRACK-D-ENHANCED-BACKLOG-PLAN.md). Shipped history: [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md). Run `segment:gates` per segment.
5. **Track E** — New DDL starting at migration **`116`** only after specs exist and Tracks A–D are appropriately satisfied for your risk tolerance.

---

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

After this scaffold sprint, resume backend spec implementation in original order: **07 → 11 → 16**.

**Phase 1 Milestone:** At Week 12, COL can run daily operations on the platform at 1 pilot facility (Oakridge ALF). Caregivers document care, administer medications via eMAR, report incidents, view schedules, and clock in/out. Administrators manage staff, certifications, billing, and view facility dashboard.

**Sign-off:** Use [PHASE1-ACCEPTANCE-CHECKLIST.md](./PHASE1-ACCEPTANCE-CHECKLIST.md) for full UAT; **closure verdict** (PASS / PASS WITH WAIVERS / not complete) lives in [PHASE1-CLOSURE-RECORD.md](./PHASE1-CLOSURE-RECORD.md). Environment CLI checks: [PHASE1-ENV-CONFIRMATION.md](./PHASE1-ENV-CONFIRMATION.md). Engineering vs full acceptance: [PHASE1-PHASE2-OFFICIAL-SIGNOFF-REVIEW.md](./PHASE1-PHASE2-OFFICIAL-SIGNOFF-REVIEW.md).

### Phase 2: Clinical Depth & Compliance (Weeks 13-20)

**Scope & tiering guide:** `PHASE2-SCOPE.md` — defines Core/Enhanced/Future tiers per module. Specs implement Core; Enhanced is stretch; Future is explicitly deferred. **Phase 3.5** (below) captures post-audit remediation for shipped Phase 2 modules — see [PHASE2-SCOPE.md](./PHASE2-SCOPE.md) cross-references.

**Phase 2 Milestone:** At Week 20, Haven enables one pilot facility to document structured assessments, maintain editable care plans, manage advanced medication workflows and controlled-substance accountability, monitor infections and vitals trends, and track survey/compliance deficiencies with operator-visible dashboards and follow-up workflows.

**Sign-off:** Phase 2 acceptance is recorded in [PHASE2-ACCEPTANCE-CHECKLIST.md](./PHASE2-ACCEPTANCE-CHECKLIST.md) and summarized with Phase 1 in [PHASE1-PHASE2-OFFICIAL-SIGNOFF-REVIEW.md](./PHASE1-PHASE2-OFFICIAL-SIGNOFF-REVIEW.md).

| Order | Spec File | Module | Weeks | What It Adds |
|-------|-----------|--------|-------|--------------|
| 7 | `03-resident-profile-advanced.md` | Care Planning Advanced | 13-14 | Assessment entry + auto-scoring, care plan editing/versioning, acuity scoring, task generation from care plan items |
| 8 | `06-medication-management.md` | Medication Management Advanced | 15-16 | PRN effectiveness prompts, medication error capture/trending, verbal orders, controlled substance count workflow |
| 9 | `09-infection-control.md` | Infection Control & Health Monitoring | 17-18 | Infection surveillance, vitals trending + alerts, outbreak detection/management, staff illness tracking |
| 10 | `08-compliance-engine.md` | Compliance Engine | 19-20 | Deficiency tracking, plans of correction, compliance dashboard, survey visit mode, policy library |

### Phase 3: Multi-Entity Finance, Procurement & Executive Intelligence (Weeks 21–28+)

**Vision:** Close the loop between clinical operations, financial accountability, insurance risk, vendor procurement, and executive visibility — on one RLS-governed data layer.

**Scope & tiering:** Each spec defines Core / Enhanced / Future tiers. Core ships first (one module at a time). Enhanced slices follow Core for Modules 17 and 18 within Phase 3. Future is explicitly Phase 5+.

#### Phase 3 build status

| Status | Meaning |
|--------|---------|
| ✅ SHIPPED CORE | Migration applied, primary UI live, gates passed |
| 🟧 HARDENING REQUIRED | Core shipped, but still missing live acceptance proof, automation depth, observability, or workflow hardening required before calling it complete |
| 🔒 ACCEPTANCE COMPLETE | Live-environment proof recorded: RLS/UAT/ops requirements closed for the target scope |
| 🟨 DB SHIPPED / UI PENDING | Migration applied remotely; application routes/types still in progress |
| 🔲 NEXT | Next on the docket — build this when asked "what's next" |
| ⬜ QUEUED | Spec exists, waiting for predecessor |

#### Phase 3 Core modules (strict dependency order)

| Order | Spec File | Module | Migration | Status | What It Creates |
|-------|-----------|--------|-----------|--------|-----------------|
| 11 | `17-entity-facility-finance.md` | Entity & Facility Finance (Core) | `040`–`043` | ✅ SHIPPED | Chart of accounts, journal entries/lines, read-only ledger, GL settings, budget lines; RLS; `/admin/finance/*` (7 routes) |
| 12 | `18-insurance-risk-finance.md` | Insurance & Risk Finance (Core) | `044`–`045` | ✅ SHIPPED | Policy inventory, renewals, data packages, claims (incident-linked), loss runs, premium allocations, COI tracking, workers' comp headers; GL hooks; `/admin/insurance/*` (10 routes) |
| 13 | `19-vendor-contract-management.md` | Vendor & Contract Management (Core) | `046` | ✅ SHIPPED | Vendor master, facility links, contracts, terms, alerts, POs with three-way match, vendor invoices, payments with GL hooks, vendor insurance (COI cross-ref to Module 18), scorecards; `/admin/vendors/*` (12 routes) |
| 14 | `24-executive-intelligence.md` | Executive Intelligence Layer v1 | `047` | ✅ SHIPPED (Core + reports + cohorts + KPI deltas + cohort peer table + CSS bar compare) | Org command center, KPI tiles w/ snapshot deltas, alerts, entity/facility drill-downs, saved reports (CSV + print/PDF), **`benchmark_cohorts`** CRUD + **live KPI peer comparison** (table + **CSS bar charts** on benchmarks), per-user settings; cron `exec-kpi-snapshot`; **Enhanced backlog:** chart library / richer executive dashboards |

**Spec note:** `24-executive-intelligence.md` includes `exec_kpi_snapshots.lineage`, `exec_alert_user_state`, and `benchmark_cohorts` — see spec DDL.

#### Phase 3 Enhanced slices (after Core 13–14 complete)

| Order | Module | Migration | Status | What It Adds |
|-------|--------|-----------|--------|--------------|
| 15 | Module 17 Enhanced — Finance Depth | `048` | ✅ SHIPPED | **`gl_period_closes`**, **`gl_posting_rules`**, **`journal_entries.gl_period_close_id`** in DB; UI: `/admin/finance/trial-balance`, `/admin/finance/posting-rules`, `/admin/finance/period-close`, auto-posting lib |
| 16 | Module 18 Enhanced — Insurance Intelligence | `049` | ✅ SHIPPED | **`renewal_data_packages`** + narrative columns; UI: renewal packages hub + detail, TCoR on insurance hub, `/api/insurance/renewal-narrative` (human review) |

#### Phase 3 implementation detail per module

**Module 19 — Vendor & Contract Management** (✅ SHIPPED)

Migration `046_vendor_contract_management.sql`: 8 enums, 14 tables, full RLS, audit triggers.

| Artifact | Path |
|----------|------|
| Migration | `supabase/migrations/046_vendor_contract_management.sql` |
| Types | `src/types/database.ts` (extend with all Module 19 tables/enums) |
| Admin UI | `src/app/(admin)/admin/vendors/*` — 12 routes |
| Nav | `src/components/layout/AdminShell.tsx` — add Vendors item |
| Auth gate | `src/lib/auth/admin-shell.ts` — add `"/vendors"` to `ADMIN_SHELL_SEGMENTS` |
| Contract | `docs/specs/FRONTEND-CONTRACT.md` — add `/admin/vendors/*` routes |

Tables: `vendors`, `vendor_facilities`, `contracts`, `contract_terms`, `contract_alerts`, `purchase_orders`, `po_line_items`, `vendor_invoices`, `vendor_invoice_lines`, `vendor_payments`, `vendor_payment_applications`, `vendor_insurance`, `vendor_scorecards`. RLS: owner/org_admin full CRUD; facility_admin SELECT + PO/invoice create for their facility only. GL hook: `journal_entries.source_type = 'vendor_payment'`.

Routes: `/admin/vendors` (hub), `/admin/vendors/directory`, `/admin/vendors/[id]`, `/admin/vendors/contracts`, `/admin/vendors/contracts/[id]`, `/admin/vendors/purchase-orders`, `/admin/vendors/purchase-orders/new`, `/admin/vendors/purchase-orders/[id]`, `/admin/vendors/invoices`, `/admin/vendors/invoices/[id]`, `/admin/vendors/payments`, `/admin/vendors/spend`.

---

**Module 24 — Executive Intelligence Layer v1** (🟩 Core admin UI + **daily KPI snapshot Edge Function** + cohort admin + **tile deltas vs last snapshot** + **benchmarks peer comparison** table + CSS bars — chart-library dashboards Enhanced backlog)

Migration `047_executive_intelligence.sql`: enums, **seven** tables (includes `exec_kpi_snapshots` with **`lineage`**, `exec_alert_user_state`, `benchmark_cohorts`), full RLS, audit triggers.

| Artifact | Path |
|----------|------|
| Migration | `supabase/migrations/047_executive_intelligence.sql` |
| Types | `src/types/database.ts` |
| KPI engine | `src/lib/exec-kpi-snapshot.ts` — live aggregates from source modules (+ versioned `ExecKpiPayload` for cron snapshots) |
| Alerts | `src/lib/exec-alerts.ts` — list / acknowledge `exec_alerts` |
| Admin UI | `src/app/(admin)/executive/*` (+ `/admin/*` re-exports) — overview, alerts, reports, benchmarks, settings |
| Nav | `src/components/layout/AdminShell.tsx` — Executive item after Dashboard |
| Auth gate | `src/lib/auth/admin-shell.ts` — `"/executive"` in `ADMIN_SHELL_SEGMENTS` (short path group) |

Tables: `exec_dashboard_configs`, `exec_kpi_snapshots` (**`lineage jsonb`**), `exec_alerts`, **`exec_alert_user_state`**, **`benchmark_cohorts`**, `exec_saved_reports`. KPI domains: census/occupancy, financial, clinical/safety, infection, compliance, workforce, insurance (Module 18), vendors (Module 19). Alert scoring: `severity_weight × recency_factor × impact_weight`. RLS: owner/org_admin full access; facility_admin scoped to their facilities.

Routes live: `/admin/executive` (command center), `/admin/executive/alerts`, `/admin/executive/reports`, `/admin/executive/benchmarks`, `/admin/executive/settings`, `/admin/executive/entity`, `/admin/executive/entity/[id]`, `/admin/executive/facility/[id]`. **Cron:** Edge Function `exec-kpi-snapshot` writes `exec_kpi_snapshots` daily per org (`EXEC_KPI_SNAPSHOT_SECRET`, `x-cron-secret`); see `supabase/functions/README.md`. Reports: CSV + browser print/save-as-PDF. **KPI tiles:** live vs latest `exec_kpi_snapshots` row (per scope). **Benchmarks:** select a cohort → **Compare KPIs** table + **CSS bar comparison** (occupancy, incidents, deficiencies, AR vs cohort max). **Enhanced backlog:** dedicated charting library / richer dashboards.

---

**Module 17 Enhanced — Finance Depth** (✅ DB + UI shipped — trial balance, posting rules, period close; auto-posting batch)

Migration `048_finance_enhanced.sql`.

Adds: **`gl_period_closes`**; **`entity_gl_settings.accounts_payable_gl_account_id`**; **`intercompany_markers` on `journal_lines`** (also listed in Phase 3.5 if not present after `048`); `gl_posting_rules` table (event type → debit/credit account pairs per entity); trial balance SQL view/RPC; period-close enforcement (block posting to closed periods); budget vs actual variance computation in UI; `src/lib/finance/auto-posting.ts` batch function: invoices/payments create balanced journal entries with `source_type = 'invoice'` / `source_type = 'payment'`.

---

**Module 18 Enhanced — Insurance Intelligence** (✅ DB + UI shipped — renewal packages, TCoR, narrative API w/ human review)

Migration `049_insurance_enhanced.sql`.

Adds: `src/lib/insurance/renewal-package.ts` (server-side assembly: census counts, incident aggregates, staffing metrics, billing totals → `renewal_data_packages.payload` JSON); total cost of risk KPI (premiums + paid losses + reserves per entity per rolling 12 months, surfaced on insurance hub + executive dashboard); `src/app/api/insurance/renewal-narrative/route.ts` AI-assisted draft endpoint (**human must review and approve before external use** — `generated_by`, `reviewed_by`, `published_by` audit columns). Per mission: AI subordinate to human judgment.

#### Phase 3 gate checklist (per module)

```bash
npm run migrations:check
npm run check:admin-shell
npm run lint
npm run build
npm run segment:gates -- --segment "<module-segment-id>" --ui
```

#### Phase 3 Milestone

At completion, an ALF owner logs into Haven and sees their entire portfolio — every facility's census, revenue, incident count, compliance backlog, staffing gaps, insurance exposure, and vendor spend — in one command center. They click a critical alert, drill into the facility, trace from a workers' comp claim to the incident report to the GL reserve entry to the vendor scorecard. Every dollar, risk event, and vendor obligation is traceable from the executive layer down to the source row, under row-level security, in a single session.

---

### Phase 3.5: Platform Hardening & Shipped-Module Remediation

**Purpose:** Remediate retrospective audit gaps in Phases 1–3 **without** breaking existing data. Core segments are **additive migrations** `050`–`068` (each its own gated segment); **post-audit follow-ups** (e.g. `069` RLS tighten) land immediately after. Placeholder / patch specs: `00-foundation-regulatory.md`, `platform-search.md`, `04-daily-operations-offline.md`, `pwa-caching-contract.md`.

#### 3.5-A: Foundation and platform infrastructure (`050`–`053`)

| Segment | Migration | Spec / artifact | What it does |
|---------|-----------|-----------------|--------------|
| `platform-audit-log-access` | `050` | Patch `00-foundation.md` | RLS SELECT on `audit_log` for owner/org_admin/facility_admin; `audit_log_export_jobs` + Edge Function `export-audit-log` (checksummed CSV/PDF); monthly partitions on `audit_log.created_at`. |
| `platform-auth-role-reconciliation` | `051` | Patch `00-foundation.md` | `user_profiles.auth_claim_version integer` + middleware: reject session when `profiles.updated_at > token.iat`; document single source of truth for role. |
| `platform-regulatory-jurisdiction` | `052` | `00-foundation-regulatory.md` | `facilities.license_authority`, `alf_license_type`, `cms_certification_number`, `medicaid_provider_id`; `ratio_rule_sets` + `facility_ratio_rule_set_id` FK; `shift_classification` enum on `shift_assignments`. |
| `platform-search-index` | `053` | `platform-search.md` | `search_documents` tsvector + GIN + RLS; **Admin UI** `/admin/search` (header search icon); resident trigger live — staff/vendors/incidents triggers backlog per spec. |

#### 3.5-B: PWA / offline / notifications (app + Edge Functions)

| Segment | Migration / artifact | What it does |
|---------|----------------------|--------------|
| `pwa-offline-emar` | `054` + `04-daily-operations-offline.md` | SW cache partitions; `emar_idempotency_key uuid UNIQUE` on `emar_records`; Background Sync contract + IndexedDB queue schema. |
| `pwa-push-notifications` | `055` + `supabase/functions/dispatch-push` | VAPID in secrets; `notification_subscriptions` (`user_id`, `endpoint`, `keys_json`, `created_at`); `dispatch-push` from incident/alert triggers. |
| `pwa-sw-caching-contract` | `pwa-caching-contract.md` | Stale-while-revalidate max ages per resource per shell; **no offline writes without idempotency keys**; document PgBouncer transaction mode + pooler URL. |

#### 3.5-C: Shipped Phase 1 module patches (`056`–`060`)

| Segment | Migration | Module | What it adds |
|---------|-----------|--------|--------------|
| `resident-advance-directives` | `056` | 03 Resident | `advance_directive_documents` (POLST, code status, physician signature, scan path, verified_by/at). |
| `emar-witness-device` | `057` | 04 Daily Ops | `emar_administration_witnesses`; `emar_records.device_id`, `app_version`; optional `adl_logs.duration_seconds`, `assisting_staff_ids`. |
| `incident-regulatory-timers` | `058` | 07 Incidents | `regulatory_reporting_obligations`; `notification_routes` + `on_call_schedules`; `incident_root_causes` + taxonomy. |
| `staff-credentials-background` | `059` | 11 Staff | `staff_background_checks`; deferred trigger on `shift_assignments` vs `staff_certifications`. |
| `billing-trust-ar-matview` | `060` | 16 Billing | `trust_account_entries`; `invoice_generation_profiles`; materialized view `ar_aging_facility_daily` + nightly refresh. |

#### 3.5-D: Shipped Phase 2 module patches (`061`–`064`)

| Segment | Migration | Module | What it adds |
|---------|-----------|--------|--------------|
| `care-plan-billing-version-lock` | `061` | 03 Advanced | `care_plan_versions.billing_snapshot_hash`; `care_plan_change_tasks` on assessment save. |
| `medication-rxnorm-witness` | `062` | 06 Medication | `medication_reference` (rxcui, ndc); `resident_medications.rxcui` FK; `controlled_substance_count_variance_events`; `integrations/pharmacy-fhir.md`. |
| `infection-jurisdiction-labs` | `063` | 09 Infection | `infection_threshold_profiles`; RTW clearance on illness episodes; `lab_observations` + `integration_inbound_queue`. |
| `compliance-citation-keys` | `064` | 08 Compliance | `regulatory_rules` (citation PK); FK from `deficiencies.citation`; policy publish approvals; `survey_visits` + notes. |

#### 3.5-E: Shipped Phase 3 module patches (`065`–`067`)

| Segment | Migration | Module | What it adds |
|---------|-----------|--------|--------------|
| `finance-intercompany` | `065` | 17 Finance | `intercompany_markers` on `journal_lines`; `entity_gl_settings.accounts_payable_gl_account_id` if not already in `048`. |
| `insurance-osha-allocation` | `066` | 18 Insurance | OSHA recordable flags; premium allocation enum + snapshot JSON; COI endorsement + `ai_extracted_json`. |
| `vendor-match-storage-scorecard` | `067` | 19 Vendor | `invoice_match_rules` + tolerance trigger; Storage bucket `vendor-documents`; `vendor_scorecard_signals` nightly. |

#### 3.5-F: AI invocation framework (`068`)

| Segment | Migration | What it does |
|---------|-----------|--------------|
| `ai-invocation-framework` | `068` | `ai_invocations` (model, `phi_class` enum `none`/`limited`/`phi`, hashes, tokens); **REJECT** if `phi_class = 'phi'` and no BAA env flag; `ai_invocation_policies` per org — compliance chokepoint for later AI features. |

#### 3.5-G: Post-audit RLS remediation (`069`)

| Segment | Migration | Spec / artifact | What it does |
|---------|-----------|-----------------|--------------|
| `phase1-audit-shift-swap-rls` | `069` | [PHASE1-ACCEPTANCE-REPORT.md](../PHASE1-ACCEPTANCE-REPORT.md) Gap R-3 | Tighten `shift_swap_requests` SELECT: drop facility-wide `status = 'pending'` visibility for non-privileged staff (additive policy replace). |

#### Phase 3.5 gate checklist

Same as Phase 3: `migrations:check`, `check:admin-shell`, `lint`, `build`, `segment:gates` per segment (`--ui` when routes/layouts/visuals change).

---

### Phase 4: Resident Lifecycle

Implement after predecessor migrations and specs exist.

| Order | Spec file | Module | Migration range | Audit / build notes |
|-------|-----------|--------|-----------------|---------------------|
| 17 | `01-referral-inquiry.md` | Referral and Inquiry | `075`–`076` | ✅ **Spec written.** `referral_sources`, `referral_leads` with duplicate merge, `pii_access_tier`, RLS; HL7 v2 ADT Enhanced via existing `integration_inbound_queue` (`063`). |
| 18 | `02-admissions-move-in.md` | Admissions and Move-In | `077`–`078` | ✅ **Spec written.** `admission_cases`, `admission_case_rate_terms`, RLS; optional `referral_leads` + `beds` + `rate_schedules` linkage. |
| 19 | `05-discharge-transition.md` | Discharge and Transition | `079`–`080` | ✅ **Spec written.** `discharge_med_reconciliation` + pharmacist fields; `residents.discharge_target_date`, `hospice_status`; FHIR export Enhanced. |

**Note:** Repo migrations already use `070`–`074` for other segments; Phase 4 DDL **starts at `075`**. Older roadmap PDFs may show obsolete numbers.

---

### Phase 5: Quality, Family, and Intelligence

| Order | Spec file | Module | Migration range | Audit / build notes |
|-------|-----------|--------|-----------------|---------------------|
| 20 | `10-quality-metrics.md` | Quality Metrics | `081`–`082` | ✅ **Spec written.** `quality_measures`, `quality_measure_results`, `pbj_export_batches`; view `quality_latest_facility_measures`; PBJ metadata Core. |
| 21 | `21-family-portal.md` | Family Portal | `083`–`084` | ✅ **Spec written.** `family_consent_records`, `family_message_triage_items`, `family_care_conference_sessions`; keyword DB triggers + WebRTC deferred to Enhanced. |
| 22 | `24-executive-v2.md` | Executive Intelligence v2 | `085` | ✅ **Spec written.** `exec_nlq_sessions` (+ optional `ai_invocations` FK), `exec_scenarios`; NLQ Edge/solver + Realtime dashboards = Enhanced. |

---

### Phase 6: Operational Depth

| Order | Spec file | Module | Migration range | Audit / build notes |
|-------|-----------|--------|-----------------|---------------------|
| 23 | `12-training-competency.md` | Training and Competency | `086`–`087` | ✅ **Spec written.** `competency_demonstrations` (evaluator, skills_json, attachments jsonb); Storage upload UI Enhanced. |
| 24 | `13-payroll-integration.md` | Payroll Integration | `088` | ✅ **Spec written.** `payroll_export_batches`, `payroll_export_lines` (`idempotency_key` UNIQUE); vendor CSV/API = Enhanced. |
| 25 | `14-dietary-nutrition.md` | Dietary and Nutrition | `089` | ✅ **Spec written.** `diet_orders`, `iddsi_food_level` / `iddsi_fluid_level`; med cross-check automation Enhanced. |
| 26 | `15-transportation.md` | Transportation | `090` | ✅ **Spec written.** `fleet_vehicles`, `vehicle_inspection_logs`, `driver_credentials`; trip scheduling/reminders remain follow-up depth. |
| 27 | `22-referral-crm.md` | Referral Source CRM | `091` | ✅ **Spec written.** `referral_hl7_inbound` queue; HL7 listener = Enhanced. |
| 28 | `23-reputation.md` | Reputation Management | `092` | ✅ **Spec written.** `reputation_accounts`, `reputation_replies` (`posted_by_user_id`); API sync = Enhanced. |

**Deferred (not yet in repo — migration numbers TBD, start at `110`+ when specced):**

| Spec file | Module | Notes |
|-----------|--------|-------|
| `26-digital-twin.md` / `27-digital-twin.md` | Facility Digital Twin | Spec exists in roadmap; **not** implemented — do **not** assume migration `096` (that number is [Executive Intelligence v3](#postphase-6-shipped-work-migrations-096109)). |
| `13-maintenance.md` | Facility Maintenance | Not yet written; shares `vendors` (Module 19). |

---

### Post–Phase 6 shipped work (migrations `096`–`109`)

These landed **after** Phase 6 (`086`–`092`) and Phase 1 auth remediation (`093`–`095`). They extend Executive Intelligence, add Resident Assurance and Reporting, and introduce onboarding — **in addition to** the phase tables above.

| Range | Spec / theme | What it does (summary) |
|-------|----------------|------------------------|
| `096`–`097` | `24-executive-intelligence.md` (v3 patch) | Executive Intelligence v3 + audit fix (`096_executive_intelligence_v3.sql`, `097_fix_exec_intelligence_audit.sql`). Admin: extended `/admin/executive/*` and `/admin/reports/*` surfaces as implemented in repo. |
| `098`–`101` | `25-resident-assurance-engine.md` | Resident Assurance schema, RLS, audit, seed (`098`–`101`). |
| `102`–`106` | `26-reporting-module.md` | Reporting module schema, RLS, audit, seed, saved-views backfill. |
| `107` | `25-resident-assurance-engine.md` (patch) | Resident Assurance indexes + RLS patch. |
| `108`–`109` | Onboarding (spec TBD / align with FRONTEND-CONTRACT) | `108_onboarding_responses.sql`, `109_onboarding_question_tiers.sql` — wire to product docs when promoting onboarding to FULL. |

**UI pointers (non-exhaustive):** `/admin/rounding/*`, `/caregiver/rounds/*`, `/admin/reports/*`, onboarding routes as present under `src/app/`. Edge Functions and API routes: see `supabase/functions/` and `src/app/api/`.

---

### Completion remediation tracks (closeout + hardening — still required)

The repo contains broad **Core-shipped** surface through migration **`109`**. That is **not** the same as operational readiness, acceptance, or PHI-safe production. Migrations **`093`–`095`** addressed **Phase 1 auth remediation** in SQL; **hosted Auth** may still block pilot JWTs — see Track A.

Execute the remediation tracks below **in order** for **evidence and hardening**, not as a claim that `096`+ is “future work only.”

#### Track A — Phase 1 acceptance closeout (blocking)

**Single closeout roadmap:** [TRACK-A-CLOSEOUT-ROADMAP.md](./TRACK-A-CLOSEOUT-ROADMAP.md) — ordered steps A1–A6, owners, evidence, and definition of done.

Use these authoritative files as the acceptance source of truth:

- [PHASE1-CLOSURE-RECORD.md](./PHASE1-CLOSURE-RECORD.md)
- [PHASE1-ACCEPTANCE-CHECKLIST.md](./PHASE1-ACCEPTANCE-CHECKLIST.md)
- [PHASE1-AUTH-DEBUG-HANDOFF.md](./PHASE1-AUTH-DEBUG-HANDOFF.md)
- [PHASE1-RLS-VALIDATION-RECORD.md](./PHASE1-RLS-VALIDATION-RECORD.md)
- [PHASE1-EXECUTION-LOG.md](./PHASE1-EXECUTION-LOG.md)
- [PHASE1-WAIVER-LOG.md](./PHASE1-WAIVER-LOG.md)

| Order | Item | Why it blocks completion | Required evidence |
|-------|------|--------------------------|-------------------|
| A1 | Auth unblock on target project | RLS and UAT cannot proceed while pilot users fail before JWT issuance | `PHASE1-AUTH-DEBUG-HANDOFF.md` resolved + `npm run demo:auth-check` shows pilot login success |
| A2 | RLS JWT matrix on target project | Policy existence in migrations is not enough; live tenant isolation must be proven | `PHASE1-RLS-VALIDATION-RECORD.md` = PASS |
| A3 | Real-auth pilot UAT | UI + routes + gates do not replace operator workflows with real auth/session behavior | `PHASE1-EXECUTION-LOG.md` sections A–E completed |
| A4 | Environment / seed / facility-context verification | Pilot readiness depends on correct target host, seeded users, and facility selector behavior | `PHASE1-ENV-CONFIRMATION.md` + execution log preconditions |
| A5 | Pro / BAA / PITR attestation | PHI handling and recovery posture are part of release readiness, not optional follow-up | Owner confirmation in closure docs |
| A6 | Active waiver review | Remaining waivers must map to named remediation work, not vague backlog language | `PHASE1-WAIVER-LOG.md` reviewed with owner |

**Rule:** Phase 1 remains **NOT COMPLETE** until Track A closes. Do not describe Core-shipped scope as fully accepted before these artifacts are updated.

#### Track B — Platform hardening ✅ (2026-04-09)

| Order | Item | Status | What was done |
|-------|------|--------|---------------|
| B1 | Automated regression | **DONE** | `auth-smoke` in `ci-gates.yml`; nightly `ci-nightly.yml` with full `--ui` gates + smoke + artifact upload |
| B2 | Observability | **DONE** | Sentry SDK (PHI stripping); structured logs in all 5 Edge Functions; health scripts; [OBSERVABILITY-SPEC.md](./OBSERVABILITY-SPEC.md) |
| B3 | CI hardening | **DONE** | Nightly CI; bundle-size budget (`scripts/bundle-size-check.mjs`); [CI-HARDENING-SPEC.md](./CI-HARDENING-SPEC.md) |
| B4 | Operational runbooks | **DONE** | Updated migrations/auth/report-scheduler; [PHASE1-OPS-VERIFICATION-RUNBOOK.md](./PHASE1-OPS-VERIFICATION-RUNBOOK.md) |

**Rule:** New high-risk modules should not be marked “complete” without test coverage and observable runtime behavior.

#### Track C — Workflow hardening ✅ (2026-04-09)

**Record:** [TRACK-C-WORKFLOW-HARDENING.md](./TRACK-C-WORKFLOW-HARDENING.md) — lifecycle UAT narrative: [TRACK-C-LIFECYCLE-RUNBOOK.md](./TRACK-C-LIFECYCLE-RUNBOOK.md).

| Order | Item | Status | What was done |
|-------|------|--------|----------------|
| C1 | Billing and revenue | **DONE (code)** | Edge `ar-aging-check` marks overdue invoices; monthly generation unchanged; finance posting paths documented for manual reconciliation |
| C2 | Medications / eMAR | **DONE (code)** | Edge `generate-emar-schedule`, `emar-missed-dose-check` (+ `exec_alerts`); PRN/controlled-substance **procedures** remain operator UAT |
| C3 | Referral → admission → discharge | **DONE (docs)** | Runbook for traceable E2E path; deep workflow UAT still owner-recorded in execution log |
| C4 | Family and audit | **DONE (baseline)** | Audit export + family routes unchanged; PHI UAT under Track A / checklist |
| C5 | Executive operations | **DONE (code)** | Edge `exec-alert-evaluator` creates alerts from KPI metrics; `exec-kpi-snapshot` unchanged |

**Owner follow-up:** Deploy new Edge Functions + set secrets ([supabase/functions/README.md](../../supabase/functions/README.md)); schedule crons per TRACK-C doc.

#### Track D — Phase 6 completion pass

**Execution log (segment picks, gate artifacts, deferrals):** [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md).

**Enhanced backlog (D22+):** [TRACK-D-ENHANCED-BACKLOG-PLAN.md](./TRACK-D-ENHANCED-BACKLOG-PLAN.md) — option comparison (**D12–D21** shipped 2026-04-09 per [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md)).

**Plan — what “Track D” means here**

- **Goal:** Close **operationally meaningful** gaps in Phase 6 modules (**12, 14, 15, 22, 23**) using existing Core schema first; **Enhanced** integrations (external APIs, heavy automation) ship as **separate bounded segments** with specs + gates — not as one big bang.
- **Definition of “Track D code pass” (engineering):** Segments **D1–D10** delivered with PASS gate artifacts — see table below. This does **not** replace **Track A** UAT, owner attestation, or Enhanced backlog work.

**Shipped segments (summary)**

| Seg | Module(s) | What shipped |
|-----|-------------|----------------|
| **D1** | 15 Transport | RLS-backed fleet/driver **expiry** cards on `/admin/transportation` |
| **D2** | 12 Training | `/admin/training` **competency_demonstrations** queue + batch counts (not org-wide snapshots) |
| **D3** | 14 Dietary | `/admin/dietary` **diet_orders** attention queue + roster + batch stats |
| **D4** | 22 + 23 | Referrals: **HL7 inbound** pending/failed counts; Reputation: **Module 23** SYS label + list hygiene |
| **D5** | 15 | Migration **`112`**, `resident_transport_requests` + **upcoming** list on hub |
| **D6** | 15 | Migration **`113`**, `mileage_logs`, **request CRUD** + mileage link |
| **D7** | 15 | **Day-grouped** upcoming transport list |
| **D8** | 14 | **`medication_texture_review_notes`** in attention queue + batch % |
| **D9** | 23 | **Posted replies** metric pillar on `/admin/reputation` |
| **D10** | 15 | Migration **`114`**, **`organization_transport_settings`**, `/admin/transportation/settings`, org rate on new mileage rows |

**Remaining items (Enhanced / not yet picked as a segment)**

Priority is **owner-led** (COL ops + compliance). Typical order of attack:

| Area | Backlog (from specs + TRACK-D deferrals) | Notes |
|------|--------------------------------------------|--------|
| **Track A** | A3–A6 UAT, env, Pro/BAA/PITR, waivers | **Blocks “production-ready for PHI”** — see [TRACK-A-CLOSEOUT-ROADMAP.md](./TRACK-A-CLOSEOUT-ROADMAP.md) |
| **12 Training** | Certificate / sign-in **storage** uploads, Baya/API hooks, **automated assignment**, org-wide compliance snapshots | D2 used **metadata-only** demonstrations |
| **14 Dietary** | **Automated** med–texture cross-check vs `resident_medications`, meal production sheets, vendor/menu integrations | D8 = **human-entered** notes visibility |
| **15 Transport** | Payroll export **approval**, **month/week calendar**, external calendar sync | **D10** = org **mileage rate**; D1+D5–D7 cover compliance cards + requests + grouping |
| **22 Referral CRM** | **HL7 listener/parser** beyond manual queue ingest; deeper CRM workflows | D4 = **counts** + link to queue |
| **23 Reputation** | **OAuth / platform APIs** for fetch + publish; optional AI reply (spec Enhanced) | D9 = **posted count** + existing draft/posted workflow |
| **Deploy / ops** | Track C Edge functions + crons on target project | [supabase/functions/README.md](../../supabase/functions/README.md), [TRACK-C-WORKFLOW-HARDENING.md](./TRACK-C-WORKFLOW-HARDENING.md) |

**Next engineering steps (when resuming Track D–style work)**

1. Confirm **remote migration parity** (`001`–`115`) and **owner priority** for the next Enhanced slice.
2. Promote or extend the relevant **module spec** (COL Alignment Notes) so the slice is **bounded** (schema, RLS, acceptance).
3. Implement **one segment**; run `npm run segment:gates -- --segment "<id>" --ui` when UI/routes change; record in [TRACK-D-PHASE6-PASS.md](./TRACK-D-PHASE6-PASS.md) as **D11+** or a named track.

#### Track E — Next roadmap DDL (after Tracks A–D and spec approval)

**Resident Assurance, Reporting, Exec v3, and onboarding migrations `096`–`109` are already in the repo** — see [Post–Phase 6 shipped work](#postphase-6-shipped-work-migrations-096109). Track E is for **what comes next**, using migration numbers **`110`** and above (assign per spec when promoted).

| Priority | Spec / theme | Notes |
|----------|--------------|--------|
| 1 | `20-expansion-acquisition.md` (planned) | Expansion planning — **spec not yet in `docs/specs/`**; not migrated. |
| 2 | `28-regulatory-intelligence.md` (planned) | Regulatory intelligence — **spec file not yet in `docs/specs/`**; add before migration. |
| 3 | `13-maintenance.md` | Facility maintenance — spec not yet written. |
| 4 | Digital twin | **No spec file in `docs/specs/`** as of 2026-04-08; **no** migration until spec exists + ~6 months live data prerequisite per original roadmap. |
| 5 | Phase 8 AI / ambient subsystems | See [Phase 8 (planned)](#phase-8-planned--migration-numbers-tbd); **do not** reuse numbers `106`–`109` — those are **taken** by Reporting patch, Resident Assurance patch, and Onboarding. |

---

### Phase 7: Strategic — build status vs repo (2026-04-08)

| Order | Spec file | Module | Migration range (planned) | Repo status (2026-04-08) |
|-------|-----------|--------|---------------------------|-------------------------|
| 31 | `25-resident-assurance-engine.md` | Resident Assurance Engine | `098`–`101`, patch `107` | ✅ **Shipped** — schema, RLS, audit, seed, indexes patch; admin `/admin/rounding/*`, caregiver `/caregiver/rounds/*`, API under `src/app/api/rounding/`. Hardening / acceptance: Tracks B–D as applicable. |
| 32 | `20-expansion-acquisition.md` | Expansion Planning | TBD (`110`+) | 🔲 Not migrated |
| 33 | `28-regulatory-intelligence.md` (planned) | Regulatory Intelligence | TBD (`110`+) | 🔲 Spec not yet in `docs/specs/`; not migrated |

---

### Phase 8 (planned) — migration numbers TBD

**Warning:** Older drafts assigned moonshot DDL to migrations `106`–`111`. In **this** repo, **`106`** is `reporting_saved_views_backfill`, **`107`** is Resident Assurance patch, **`108`–`109`** are onboarding. **Phase 8 specs below have no reserved migration numbers until renumbered starting at `110+`.**

| Order | Spec file | Module / subsystem | Planned content (assign migrations when specced) |
|-------|-----------|---------------------|--------------------------------------------------|
| 34 | `ai-A-pattern-detection.md` | Cross-Resident Pattern Detection | `pattern_detection_jobs`, `pattern_detection_findings`; Edge Function; `phi_class` gate. |
| 35 | `ai-B-cognitive-load.md` | Cognitive Load Engine | `caregiver_load_samples`, `caregiver_load_rules`; deterministic scoring v1. |
| 36 | `ai-C-family-risk.md` | Family Relationship Health | `family_engagement_signals`, `family_risk_scores` — **blocked on BAA or de-ID pipeline**. |
| 37 | `ai-D-placement-optimizer.md` | Portfolio Placement Optimizer | `placement_constraints`, `placement_recommendations`; OR solver over census + staffing + payer mix. |
| 38 | `26-ambient-intelligence.md` | Ambient Environment Intelligence | `ambient_consent_policies`, `resident_sensor_opt_in`; BLE/MQTT gateway; retention TTL; redaction Edge Function. |

---

### Scale and technology fixes (woven into phases above)

| Topic | Where it lands |
|-------|----------------|
| RLS performance / `facility_ids` session GUC | Phase 3.5-A `platform-search-index`; document GUC pattern in `00-foundation-regulatory.md`. |
| Audit log partitioning | Phase 3.5-A `platform-audit-log-access`. |
| Supabase connection pooling (PgBouncer transaction mode) | Phase 3.5-B `pwa-caching-contract.md` + `.env.local` pooler URL. |
| Storage lifecycle / org-scoped buckets | Phase 3.5-E `vendor-match-storage-scorecard`; replicate pattern in Phase 4/5 for clinical media + legal hold. |
| FHIR R4 export | Phase 4 Module 05 — `supabase/functions/fhir-export`. |
| Realtime executive dashboards | Phase 5 Module 24 v2 — private channels + JWT mirroring RLS. |
| Pre-aggregated KPIs | Phase 3 Module 24 — `exec_kpi_snapshots` + triggers on hot tables. |
| CI design review routes | Phase 3.5-B — segment gate `DESIGN_REVIEW_ROUTES` per segment. |
| Automated regression tests | Completion remediation Track B — critical-path browser coverage + role/RLS contract checks before future roadmap expansion. |
| Observability / error tracking / job visibility | Completion remediation Track B — structured logs, runtime error capture, Edge-function and cron visibility. |
| Cron ownership / secret rotation / replay runbooks | Completion remediation Track B — operational runbooks for deployed automation. |

---

### Data model time bomb defusal schedule

| Column / table needed | Phase | Migration |
|----------------------|-------|-----------|
| `residents.discharge_target_date`, `hospice_status` | Phase 4 (Module 05) | `079`–`080` |
| `invoices.legal_entity_id` | Phase 3 (Module 17 Enhanced `048`) | `048` |
| `journal_entries.period_id` FK | Phase 3 (Module 17 Enhanced `048`) | `048` |
| `incidents.regulatory_flags jsonb` | Phase 3.5-C | `058` |
| `staff.excluded_from_care boolean` | Phase 3.5-C | `059` |
| `facilities.cms_certification_number` | Phase 3.5-A | `052` |
| `vendor_invoices.currency`, `tax_lines` | Phase 6+ (multi-state; Module 19 patch) | `092` or later |
| `user_profiles.mfa_enforced_at` | Phase 3.5-A | `051` |
| `emar_records.device_id`, `app_version` | Phase 3.5-C | `057` |
| `family_portal_messages.encryption_key_id` | Phase 5 (Module 21) | `083`–`084` |

---

### Anthropic BAA blocker

Until a BAA is executed: the **`ai_invocations`** framework (Phase 3.5-F, migration `068`) enforces a **`phi_class` gate**. Features that would put PHI in prompts (e.g. family risk scoring, ambient transcription, compliance narratives with resident data) must either:

- Route through **Azure OpenAI with BAA**, or
- Run on **self-hosted open-weights** models, or
- Accept only **de-identified** payloads with structural redaction in the Edge Function.

Per-org provider routing is stored in **`ai_invocation_policies`**.

---

### Migration map summary (repo as of 2026-04-08)

| Range | What it covers |
|-------|----------------|
| `001`–`034` | Phase 1 Core + family calendar/messages + seeds + RLS tighten |
| `035`–`039` | Phase 2 clinical depth |
| `040`–`049` | Phase 3 finance, insurance, vendors, executive + Enhanced |
| `050`–`069` | Phase 3.5 platform + patches + AI invocation framework + shift-swap RLS |
| `070`–`074` | Incident RCA, billing uniqueness, staffing, time records |
| `075`–`080` | Phase 4 referral, admissions, discharge |
| `081`–`085` | Phase 5 quality, family portal, executive v2 |
| `086`–`092` | Phase 6 training, payroll, dietary, transport, referral CRM, reputation |
| `093`–`095` | Phase 1 auth remediation (SQL + seed repair — **hosted Auth** may still need project-level fix; Track A) |
| `096`–`097` | Executive Intelligence v3 + audit fix |
| `098`–`101`, `107` | Resident Assurance Engine (schema, RLS, audit, seed, patch) |
| `102`–`106` | Reporting module (`26-reporting-module.md`) |
| `108`–`109` | Onboarding (responses + question tiers) |
| **`110`+** | **Next** — expansion, regulatory intel, maintenance, digital twin, Phase 8 AI/ambient (renumber specs before DDL) |

Phase 3 Core (`047`–`049`) is **shipped**; the “Phase 3 remaining” wording is obsolete for execution — use the closeout tracks for acceptance and hardening.

---

## Module Number Reference (28 modules + 4 AI subsystems)

Module numbers match the product roadmap, **not** the build sequence. Build order is in the phase tables above.

### Core product modules (1–28)

| Module # | Name | Phase | Spec file / status |
|----------|------|-------|-------------------|
| 1 | Referral & Inquiry Management | 4 | `01-referral-inquiry.md` — ✅ Core (`075`–`076`); lifecycle hardening remains in Completion Track C |
| 2 | Admissions & Move-In | 4 | `02-admissions-move-in.md` — ✅ Core (`077`–`078`); lifecycle hardening remains in Completion Track C |
| 3 | Resident Profile & Care Planning | 1 + 2 (adv) | `03-resident-profile.md`, `03-resident-profile-advanced.md` — ✅ |
| 4 | Daily Operations & Logging | 1 + 3.5 offline | `04-daily-operations.md` — ✅; `04-daily-operations-offline.md` — placeholder |
| 5 | Discharge & Transition | 4 | `05-discharge-transition.md` — ✅ Core (`079`–`080`); export / lifecycle hardening remains in Completion Track C |
| 6 | Medication Management | 1 (in 04) + 2 (adv) + 3.5 patch | Basic in `04`; `06-medication-management.md` — ✅; Phase 3.5 `062` |
| 7 | Incident & Risk Management | 1 + 3.5 patch | `07-incident-reporting.md` — ✅; Phase 3.5 `058` |
| 8 | Autonomous Compliance Engine | 2 + 3.5 patch | `08-compliance-engine.md` — ✅; Phase 3.5 `064` |
| 9 | Infection Control & Health Monitoring | 2 + 3.5 patch | `09-infection-control.md` — ✅; Phase 3.5 `063` |
| 10 | Quality Metrics & Outcomes | 5 | `10-quality-metrics.md` — ✅ Core (`081`–`082`) |
| 11 | Staff Management & Scheduling | 1 + 3.5 patch | `11-staff-management.md` — ✅; Phase 3.5 `059` |
| 12 | Training & Competency Management | 6 | `12-training-competency.md` — ✅ Core (`086`–`087`); operational depth in Completion Track D |
| 13 | Facility Maintenance & Environment | 6 | `13-maintenance.md` — not yet written; migration **TBD** (`110`+) — **`097` in repo is Exec Intelligence audit fix, not maintenance** |
| 14 | Dietary & Nutrition Management | 6 | `14-dietary-nutrition.md` — ✅ Core (`089`); workflow depth in Completion Track D |
| 15 | Transportation & Appointments | 6 | `15-transportation.md` — ✅ Core (`090`); workflow depth in Completion Track D |
| 16 | Resident Billing & Collections | 1 + 3.5 patch | `16-billing.md` — ✅; Phase 3.5 `060` |
| 17 | Entity & Facility Finance | 3 + 3.5 patch | `17-entity-facility-finance.md` — ✅ Core; Enhanced `048` + `065` |
| 18 | Insurance & Risk Finance | 3 + 3.5 patch | `18-insurance-risk-finance.md` — ✅ Core; Enhanced `049` + `066` |
| 19 | Vendor & Contract Management | 3 + 3.5 patch | `19-vendor-contract-management.md` — ✅; Phase 3.5 `067` |
| 20 | Expansion & Acquisition Planning | 7 | `20-expansion-acquisition.md` — **spec not yet in `docs/specs/`**; migration TBD (`110`+) — **`102` in repo is reporting schema, not expansion** |
| 21 | Family Portal | 5 | `21-family-portal.md` — ✅ Core (`083`–`084`); PHI / production readiness remains in Completion Track C |
| 22 | Referral Source CRM | 6 | `22-referral-crm.md` — ✅ Core (`091`); HL7 automation remains in Completion Track D |
| 23 | Reputation & Online Presence | 6 | `23-reputation.md` — ✅ Core (`092`); API sync remains in Completion Track D |
| 24 | Executive Intelligence Layer | 3 (v1) + 5 (v2) + v3 patch | `24-executive-intelligence.md` — ✅ Core (`047`); v2: `24-executive-v2.md` — ✅ (`085`); **v3:** `096`–`097`; operational hardening remains in Completion Track C |
| 25 | Resident Assurance Engine | 7 | `25-resident-assurance-engine.md` — ✅ Core DDL + patches (`098`–`101`, `107`); UI/API shipped — acceptance follows Track A + B–D |
| 26 | Ambient Environment Intelligence (roadmap module 26) | 8 | `26-ambient-intelligence.md` — **not yet in repo**; migration TBD (`110`+) — **do not confuse with `26-reporting-module.md` below** |
| 27 | Facility Digital Twin | 6 | `27-digital-twin.md` — **not yet in `docs/specs/`**; migration TBD — **`105` in repo is reporting seed, not digital twin** |
| 28 | Regulatory Intelligence & Arbitrage | 7 | `28-regulatory-intelligence.md` — **not yet in `docs/specs/`**; migration TBD — **`103`–`104` in repo are reporting RLS/audit, not this module** |

### Supplemental product specs (filename `26-*` — Reporting)

| Name | Spec file | Migration | Status |
|------|-----------|-----------|--------|
| Reporting Module | `26-reporting-module.md` | `102`–`106` | ✅ **Shipped** — schema, RLS, audit, seed, saved-views backfill; admin `/admin/reports/*`. Distinct from roadmap “Module 26 Ambient” row above. |

### Cross-cutting AI subsystems (Phase 8 — migrations **TBD**, start `110`+)

| ID | Name | Spec file | Notes |
|----|------|-----------|-------|
| AI-A | Cross-Resident Pattern Detection | `ai-A-pattern-detection.md` | `phi_class` gate via `ai_invocations`; **do not** assume migrations `106`–`107` (taken by Reporting backfill + Resident Assurance patch) |
| AI-B | Cognitive Load Engine | `ai-B-cognitive-load.md` | **Do not** assume migration `108` (taken by onboarding responses) |
| AI-C | Family Relationship Health | `ai-C-family-risk.md` | **Do not** assume migration `109` (taken by onboarding tiers); blocked on BAA or de-ID |
| AI-D | Portfolio Placement Optimizer | `ai-D-placement-optimizer.md` | Next open number **`112`** as of 2026-04-09 — confirm before first DDL |

### Foundation addenda (not numbered modules)

| Artifact | Purpose |
|----------|---------|
| `00-foundation.md` | Core tenancy, RLS, audit — patches in 3.5-A (`050`–`051`) |
| `00-foundation-regulatory.md` | Regulatory/jurisdiction columns + ratio rules — `052` |

---

## Implementation note (Supabase migrations in repo)

Migrations under `supabase/migrations/` implement this foundation using schema **`haven`** for RLS helpers (`haven.organization_id()`, `haven.app_role()`, etc.) because **`auth` is reserved** by Supabase for platform objects. Behavior matches the spec; only the schema name differs from the `auth.*` snippets in `00-foundation.md`.

When applying SQL through **non-CLI** paths (e.g. some HTTP/MCP runners), prefer **`$func$ … $func$`** (or another non-`$$` delimiter) for function bodies so payloads are not mangled. The repo uses **`npm run migrations:verify:pg`** (Docker Postgres + auth stub) in gates to catch DDL regressions early.

## Critical Build Rules

1. **RLS first.** Every table must have Row Level Security enabled and policies applied before any data enters. Create the **haven** helper functions in migration `004_haven_rls_helpers.sql` before other tables' policies (equivalent to the `auth.*` helpers described in `00-foundation.md`).

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
