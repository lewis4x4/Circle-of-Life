# Haven — Implementation Specs

**This folder is the single source of truth for building Haven.** When spec content conflicts with the roadmap overview, trust these specs.

## Supabase Project
- **URL:** https://manfqmasfqppukpobpld.supabase.co
- **Timezone:** America/New_York (all facilities in North Florida)
- **Critical:** Confirm Pro plan with signed BAA before any PHI enters. Confirm Point-in-Time Recovery enabled.

## Build Execution Order

Claude Code executes migrations and builds features in this exact sequence. Do not skip ahead. Each spec contains: database schemas (complete CREATE TABLE statements), RLS policies, business rules, API endpoints, Edge Functions, UI screens, and offline behavior.

### Phase 1: Foundation & Core Operations (Weeks 1-12)

| Order | Spec File | Module | Weeks | What It Creates |
|-------|-----------|--------|-------|-----------------|
| 1 | `00-foundation.md` | Multi-tenant schema, auth, RBAC | 1-2 | Enum types, organizations, entities, facilities, units, rooms, beds, user_profiles, user_facility_access, family_resident_links, RLS helper functions, audit log system, census_daily_log, COL seed data |
| 2 | `03-resident-profile.md` | Resident Profile & Care Planning | 3-4 | residents, care_plans, care_plan_items, assessments, resident_photos, resident_contacts, resident_documents, assessment_templates (Katz ADL, Morse Fall, Braden, PHQ-9) |
| 3 | `04-daily-operations.md` | Daily Operations & Logging | 5-6 | daily_logs, adl_logs, resident_medications, emar_records, behavioral_logs, condition_changes, shift_handoffs, activities, activity_sessions, activity_attendance |
| 4 | `07-incident-reporting.md` | Incident & Risk Management | 7-8 | incidents, incident_followups, incident_photos, incident_sequences |
| 5 | `11-staff-management.md` | Staff Management & Scheduling | 9-10 | staff, staff_certifications, schedules, shift_assignments, time_records, shift_swap_requests, staffing_ratio_snapshots |
| 6 | `16-billing.md` | Resident Billing & Collections | 11-12 | rate_schedules, resident_payers, invoices, invoice_line_items, payments, collection_activities, invoice_sequences |

**Phase 1 Milestone:** At Week 12, COL can run daily operations on the platform at 1 pilot facility (Oakridge ALF). Caregivers document care, administer medications via eMAR, report incidents, view schedules, and clock in/out. Administrators manage staff, certifications, billing, and view facility dashboard.

### Phase 2: Clinical Depth & Compliance (Weeks 13-20)

| Order | Spec File | Module | Weeks | What It Creates |
|-------|-----------|--------|-------|-----------------|
| 7 | `03-resident-profile-advanced.md` | Care Planning (advanced) | 13-14 | care_plan_tasks, assessment_schedules, acuity_history, decline_alerts, care_plan_reviews. Task generation engine, assessment scheduling automation, decline trajectory detection (7 algorithms), care plan review workflow. |
| 8 | `06-medication-management.md` | Medication Management (advanced) | 15-16 | medication_interactions, medication_interaction_alerts, medication_reconciliations, controlled_substance_counts, medication_errors, medication_destructions, physician_orders, pharmacies. Interaction checking, 3-way reconciliation, controlled substance lifecycle, error reporting, verbal order co-signature tracking. |
| 9 | `08-compliance-engine.md` | Autonomous Compliance Engine | 17-18 | survey_tags, compliance_scores, compliance_composite_scores, compliance_gap_alerts, mock_surveys, facility_policies, policy_acknowledgments, actual_surveys, survey_deficiencies. Continuous scoring engine, gap detection, mock survey simulation, policy management, deficiency tracking. Florida AHCA tag seed data. |
| 10 | `09-infection-control.md` | Infection Control & Health Monitoring | 19-20 | infections, outbreak_events, vital_sign_records, vital_sign_thresholds, immunization_records, staff_illness_logs, infection_surveillance_metrics. Outbreak detection algorithm, vital sign alerting, immunization tracking, antibiotic stewardship, staff illness tracking. |
| 11 | `10-quality-metrics.md` | Quality Metrics & Outcomes | 13-14 (concurrent) | quality_metric_definitions, quality_scores, quality_composite_scores, qip_projects, qip_cycles, satisfaction_surveys, satisfaction_responses. 16 metric calculations, composite scoring, QIP/PDSA management, satisfaction surveys, insurance carrier report generation. |

**Phase 2 Milestone:** At Week 20, the platform handles: automated care plan task generation with decline detection, full medication lifecycle with interaction checking and controlled substance management, continuous autonomous compliance scoring against Florida AHCA survey tags, infection surveillance with outbreak detection, and comprehensive quality metrics with insurance carrier reporting capability.

### Phase 3–7: Specs added on a rolling basis, always one phase ahead of build.

## Module Number Reference

Module numbers match the roadmap (27 modules total), NOT the build sequence. Not every module number has a Phase 1 spec because Modules 1, 2, 5 are Phase 4 features.

| Module # | Name | Phase | Spec Status |
|----------|------|-------|-------------|
| 1 | Referral & Inquiry Management | 4 | Not yet spec'd |
| 2 | Admissions & Move-In | 4 | Not yet spec'd |
| 3 | Resident Profile & Care Planning | 1 (core) + 2 (advanced) | ✅ Core + Advanced specs complete |
| 4 | Daily Operations & Logging | 1 | ✅ Spec complete |
| 5 | Discharge & Transition | 4 | Not yet spec'd |
| 6 | Medication Management | 1 (basic in 04) + 2 (advanced) | ✅ Basic + Advanced specs complete |
| 7 | Incident & Risk Management | 1 | ✅ Spec complete |
| 8 | Autonomous Compliance Engine | 2 | ✅ Spec complete |
| 9 | Infection Control & Health Monitoring | 2 | ✅ Spec complete |
| 10 | Quality Metrics & Outcomes | 2 | ✅ Spec complete |
| 11 | Staff Management & Scheduling | 1 | ✅ Spec complete |
| 12 | Training & Competency Management | 6 | Not yet spec'd |
| 13 | Facility Maintenance & Environment | 6 | Not yet spec'd |
| 14 | Dietary & Nutrition Management | 6 | Not yet spec'd |
| 15 | Transportation & Appointments | 6 | Not yet spec'd |
| 16 | Resident Billing & Collections | 1 | ✅ Spec complete |
| 17 | Entity & Facility Financial Management | 4 | Not yet spec'd |
| 18 | Insurance & Risk Finance | 4 | Not yet spec'd |
| 19 | Vendor & Contract Management | 4 | Not yet spec'd |
| 20 | Expansion & Acquisition Planning | 7 | Not yet spec'd |
| 21 | Family Portal | 5 | Not yet spec'd |
| 22 | Referral Source CRM | 6 | Not yet spec'd |
| 23 | Reputation & Online Presence | 6 | Not yet spec'd |
| 24 | Executive Intelligence Layer | 4 (v1) + 7 (v2) | Not yet spec'd |
| 25 | Ambient Environment Intelligence | 3 | Not yet spec'd |
| 26 | Facility Digital Twin | 6 | Not yet spec'd |
| 27 | Regulatory Intelligence & Arbitrage | 7 | Not yet spec'd |

## Critical Build Rules

1. **RLS first.** Every table must have Row Level Security enabled and policies applied before any data enters. The RLS helper functions in `00-foundation.md` (`auth.organization_id()`, `auth.app_role()`, `auth.has_facility_access()`, `auth.accessible_facility_ids()`) must be created before any other table's RLS policies.

2. **Audit everything.** Every table that stores clinical or financial data must have the audit trigger from `00-foundation.md` applied. The `audit_log` table is immutable — no UPDATE or DELETE policies.

3. **Soft deletes only.** No hard deletes on any clinical, financial, or staff data. Use `deleted_at timestamptz NULL`. Queries filter `WHERE deleted_at IS NULL`.

4. **Money in cents.** All monetary values stored as `integer` (cents). $252,412.65 = 25241265. No `numeric`, no `float`, no `money` type.

5. **Timestamps in UTC.** All `timestamptz` columns store UTC. Frontend converts to America/New_York for display. The `timezone` column on organizations and facilities is for display conversion only.

6. **UUIDs for PKs.** All primary keys are `uuid DEFAULT gen_random_uuid()`. No serial/autoincrement except for sequence counters (incident_sequences, invoice_sequences).

7. **Denormalized `organization_id` and `facility_id`.** Most tables carry both for RLS performance. The RLS policies filter on `organization_id = auth.organization_id()` first (cheapest check), then `facility_id IN (SELECT auth.accessible_facility_ids())`.

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
