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
| 29 | `26-digital-twin.md` | Facility Digital Twin | `096` | `twin_scenario_runs` + deterministic seed; **~6 months live data** prerequisite. |
| 30 | `13-maintenance.md` | Facility Maintenance | `097` | Shares `vendors.id` (Module 19); work orders, PM schedules, building inventory. |

---

### Completion remediation tracks (execute before future roadmap migrations `096+`, and before calling earlier phases “complete”)

The repo now contains broad **Core-shipped** surface area across Phases 1–6. That is **not** the same as operational readiness or acceptance. Migrations `093`–`095` are now consumed by Phase 1 auth remediation, so before resuming future roadmap work at **`096`** and beyond, execute the remediation tracks below in order.

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

#### Track B — Platform hardening

Add the missing confidence layers that gates alone do not provide.

| Order | Item | Scope |
|-------|------|-------|
| B1 | Automated regression layer | Critical-path browser tests, role/RLS contract checks, and repeatable smoke coverage for pilot workflows; unauthenticated: `web-health` (14 probes) + `auth-smoke`; authenticated: `auth-smoke:real` (blocked on A1) |
| B2 | Observability | Structured logs, error tracking, Edge-function failure visibility, cron/job dashboards, deployment/run health visibility; spec: [OBSERVABILITY-SPEC.md](./OBSERVABILITY-SPEC.md) |
| B3 | CI hardening | Expand beyond `segment:gates`; add selected `--ui` coverage and reduce dependence on visual/a11y-only proof; spec: [CI-HARDENING-SPEC.md](./CI-HARDENING-SPEC.md) |
| B4 | Operational runbooks | Secret rotation, cron ownership, replay/failure handling, deployment verification, operator-facing failure paths; [PHASE1-OPS-VERIFICATION-RUNBOOK.md](./PHASE1-OPS-VERIFICATION-RUNBOOK.md) now includes cron register, secret rotation table, failure triage, and `pilot-readiness` bundle |

**Rule:** New high-risk modules should not be marked “complete” without test coverage and observable runtime behavior.

#### Track C — Workflow hardening

Deepen the workflows that currently exist as schema + basic UI, but still depend on manual babysitting or deferred automation.

| Order | Workflow area | Required hardening |
|-------|---------------|--------------------|
| C1 | Billing and revenue | AR aging automation parity, invoice-to-cash reconciliation proof, blocked-generation visibility, rerun workflow |
| C2 | Medications / eMAR | Missed-dose / PRN / schedule automation from spec, controlled-substance validation against real procedures |
| C3 | Referral → admission → discharge | Trace bed, payer, rate, resident conversion, discharge outcomes as one continuous lifecycle |
| C4 | Family and audit operations | Routine audit review/export workflow, family portal production readiness under PHI constraints |
| C5 | Executive operations | Snapshot cron ownership, secret setup, alert-evaluator strategy, KPI lineage/data-quality review |

#### Track D — Phase 6 completion pass

Before treating Phase 6 as “done,” revisit the recently shipped Core modules and close the major Enhanced gaps that matter operationally:

- Training: attachment / evidence workflow depth
- Dietary: medication / texture cross-check automation
- Transportation: trip scheduling / compliance reminders where required
- Referral CRM: HL7 listener / parser beyond manual queue ingest
- Reputation: platform sync / publishing APIs beyond manual tracking

#### Track E — Resume future roadmap modules

Only after Tracks A–D should roadmap execution resume with:

1. `096`–`097` (remaining Phase 6)
2. Phase 7 (`098`–`100`)
3. Phase 8 (`101`–`107`)

---

### Phase 7: Strategic

| Order | Spec file | Module | Migration range | Audit / build notes |
|-------|-----------|--------|-----------------|---------------------|
| 31 | `20-expansion-acquisition.md` | Expansion Planning | `098` | `expansion_scenarios` + immutable assumption hash; cap table modeling. |
| 32 | `27-regulatory-intelligence.md` | Regulatory Intelligence | `099`–`100` | `regulatory_sources` (url, etag, sha256); diff pipeline; routed through `ai_invocations` with `phi_class = 'none'`. |

---

### Phase 8: Moonshot AI and Ambient Intelligence

| Order | Spec file | Module / subsystem | Migration range | Description |
|-------|-----------|---------------------|-----------------|-------------|
| 33 | `ai-A-pattern-detection.md` | Cross-Resident Pattern Detection | `101`–`102` | `pattern_detection_jobs`, `pattern_detection_findings`; Edge Function; `phi_class` gate. |
| 34 | `ai-B-cognitive-load.md` | Cognitive Load Engine | `103` | `caregiver_load_samples`, `caregiver_load_rules`; deterministic scoring v1. |
| 35 | `ai-C-family-risk.md` | Family Relationship Health | `104` | `family_engagement_signals`, `family_risk_scores` — **blocked on BAA or de-ID pipeline**. |
| 36 | `ai-D-placement-optimizer.md` | Portfolio Placement Optimizer | `105` | `placement_constraints`, `placement_recommendations`; OR solver over census + staffing + payer mix. |
| 37 | `25-ambient-intelligence.md` | Ambient Environment Intelligence | `106`–`107` | `ambient_consent_policies`, `resident_sensor_opt_in`; BLE/MQTT gateway; retention TTL; redaction Edge Function. |

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

### Segment count summary (post Phase 3 queue)

| Phase | Segments / modules | Migration range |
|-------|-------------------|-----------------|
| Phase 3 remaining | 3 (24, 17-enh, 18-enh) | `047`–`049` |
| Phase 3.5 | 19 segments + audit `069` | `050`–`069` |
| Phase 4 | 3 modules | `075`–`080` (after repo `070`–`074`) |
| Phase 5 | 3 modules | `081`–`085` |
| Phase 6 | 8 modules | `086`–`092`, `096`–`097` (`093`–`095` reserved for auth remediation) |
| Phase 7 | 2 modules | `098`–`100` |
| Phase 8 | 5 modules / subsystems | `101`–`107` |

**~43** discrete segments/modules beyond the current Phase 3 queue (see tables above for authoritative ordering).

---

## Module Number Reference (27 modules + 4 AI subsystems)

Module numbers match the product roadmap, **not** the build sequence. Build order is in the phase tables above.

### Core product modules (1–27)

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
| 13 | Facility Maintenance & Environment | 6 | `13-maintenance.md` — not yet written (`097`) |
| 14 | Dietary & Nutrition Management | 6 | `14-dietary-nutrition.md` — ✅ Core (`089`); workflow depth in Completion Track D |
| 15 | Transportation & Appointments | 6 | `15-transportation.md` — ✅ Core (`090`); workflow depth in Completion Track D |
| 16 | Resident Billing & Collections | 1 + 3.5 patch | `16-billing.md` — ✅; Phase 3.5 `060` |
| 17 | Entity & Facility Finance | 3 + 3.5 patch | `17-entity-facility-finance.md` — ✅ Core; Enhanced `048` + `065` |
| 18 | Insurance & Risk Finance | 3 + 3.5 patch | `18-insurance-risk-finance.md` — ✅ Core; Enhanced `049` + `066` |
| 19 | Vendor & Contract Management | 3 + 3.5 patch | `19-vendor-contract-management.md` — ✅; Phase 3.5 `067` |
| 20 | Expansion & Acquisition Planning | 7 | `20-expansion-acquisition.md` — not yet written (`098`) |
| 21 | Family Portal | 5 | `21-family-portal.md` — ✅ Core (`083`–`084`); PHI / production readiness remains in Completion Track C |
| 22 | Referral Source CRM | 6 | `22-referral-crm.md` — ✅ Core (`091`); HL7 automation remains in Completion Track D |
| 23 | Reputation & Online Presence | 6 | `23-reputation.md` — ✅ Core (`092`); API sync remains in Completion Track D |
| 24 | Executive Intelligence Layer | 3 (v1) + 5 (v2) | `24-executive-intelligence.md` — 🟩 Core UI (`047`); v2: `24-executive-v2.md` — ✅ Core schema + admin (`085`); operational hardening remains in Completion Track C |
| 25 | Ambient Environment Intelligence | 8 | `25-ambient-intelligence.md` — not yet written (`106`–`107`) |
| 26 | Facility Digital Twin | 6 | `26-digital-twin.md` — not yet written (`096`) |
| 27 | Regulatory Intelligence & Arbitrage | 7 | `27-regulatory-intelligence.md` — not yet written (`099`–`100`) |

### Cross-cutting AI subsystems (Phase 8)

| ID | Name | Spec file | Migration | Notes |
|----|------|-----------|-----------|-------|
| AI-A | Cross-Resident Pattern Detection | `ai-A-pattern-detection.md` | `101`–`102` | `phi_class` gate via `ai_invocations` |
| AI-B | Cognitive Load Engine | `ai-B-cognitive-load.md` | `103` | Reads Module 11 + 04 signals |
| AI-C | Family Relationship Health | `ai-C-family-risk.md` | `104` | Blocked on BAA or de-ID |
| AI-D | Portfolio Placement Optimizer | `ai-D-placement-optimizer.md` | `105` | OR over census + staffing |

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
