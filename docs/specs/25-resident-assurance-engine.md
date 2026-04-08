# 25 — Resident Assurance Engine

**Module:** Resident Assurance Engine — resident observation, rounding, and assurance  
**Dependencies:** [`00-foundation.md`](00-foundation.md), [`03-resident-profile.md`](03-resident-profile.md), [`04-daily-operations.md`](04-daily-operations.md), [`07-incident-reporting.md`](07-incident-reporting.md), [`11-staff-management.md`](11-staff-management.md), [`09-infection-control.md`](09-infection-control.md)  
**Migrations:** `098_resident_assurance_schema.sql`, `099_resident_assurance_rls.sql`, `100_resident_assurance_audit.sql`, `101_resident_assurance_seed.sql`  
**Canonical routes:** [`FRONTEND-CONTRACT.md`](FRONTEND-CONTRACT.md) — `/admin/rounding`, `/admin/rounding/live`, `/admin/rounding/plans`, `/admin/rounding/plans/new`, `/admin/rounding/plans/[id]`, `/admin/rounding/reports`, `/caregiver/rounds`, `/caregiver/rounds/[residentId]`

---

## Implementation note (repo migrations vs moonshot spec)

Applied migrations use **`haven.organization_id()`**, **`haven.app_role()`**, **`haven.accessible_facility_ids()`**, and `public.haven_set_updated_at` / `haven_capture_audit_log` per [`004_haven_rls_helpers.sql`](../../supabase/migrations/004_haven_rls_helpers.sql) and [`006_audit_triggers.sql`](../../supabase/migrations/006_audit_triggers.sql).

This module is a **Phase A foundational MVP** of the broader moonshot resident rounding concept. It intentionally ships the minimum complete workflow first and defers predictive, ambient, and family-facing extensions.

---

## Purpose

- Build a world-class resident observation and rounding system that goes beyond checklist charting.
- Ensure residents are seen at the correct cadence based on policy, care needs, and temporary watch rules.
- Give caregivers a fast mobile workflow for routine checks and a structured path for exceptions.
- Give supervisors live visibility into due, overdue, missed, reassigned, and excused checks.
- Produce defensible audit evidence for survey readiness, incident review, and staffing feasibility.

This module must align with Haven's mission: improve resident safety and quality, regulatory readiness, staff clarity, and owner visibility on one secure, role-governed data layer. AI remains subordinate to human judgment and auditability.

---

## Scope tiers

### Core (ship first)

- Resident observation plans and plan rules.
- Scheduled task generation with due and grace windows.
- Caregiver mobile rounding workflow for due-now and overdue checks.
- Observation logs with structured quick-select fields and exception capture.
- Supervisor live board and basic completion reports.
- RLS, auditability, late-entry visibility, and reassignment history.

### Enhanced (defer)

- Escalation ladder automation.
- Triggered watch workflows from incidents, PRNs, infection concerns, and family concerns.
- Documentation integrity flagging and anti-fraud review queues.
- Offline sync queue and sync conflict handling.
- Deeper incident correlation and staffing feasibility analytics.

### Future / moonshot

- AI risk prediction.
- Intelligent route sequencing.
- Shift-end summaries.
- Ambient or beacon-backed proof-of-presence signals.
- Family-facing wellness digest.

---

## Product thesis

Most systems treat rounds as a checkbox task. Haven should treat rounds as a live safety assurance layer that:

- knows who should be checked,
- knows how often,
- knows why,
- makes the check fast to perform,
- detects likely misses or low-quality documentation,
- escalates risk before an incident occurs,
- preserves defensible audit evidence,
- and converts observation data into operational intelligence.

---

## Supported rounding models

### Baseline routine checks

- Every 2 hours while awake
- Every shift
- Bedtime confirmation
- Morning wake / hygiene confirmation

### Enhanced safety checks

- Hourly fall-risk checks
- Q30 wandering checks
- Q15 post-incident observation
- Toileting assistance rounds

### Temporary condition-based watch

- 24-hour increased monitoring after fall
- 72-hour hydration watch
- Post-medication-change observation period
- Return-from-hospital check cadence

### Programmatic rounds

- Overnight sleep / safety rounds
- Repositioning rounds
- Infection surveillance rounds
- Behavior watch rounds

### Exception-driven checks

- Resident has not been seen recently
- Missed meal and med pass
- Abnormal vitals entered
- Family concern follow-up

---

## Core workflow

1. Administrator, nurse, or supervisor creates a resident observation plan.
2. One or more plan rules define interval, daypart, and grace window.
3. The task generation engine expands plan rules into task instances for the shift window.
4. Assigned caregivers see due-now and overdue checks in a mobile-first list.
5. A caregiver completes a check with structured quick-select fields in 2–5 seconds for the routine path.
6. Exception paths require more detail and create an observation exception row when configured.
7. Supervisors monitor completion, late entries, reassignment, and missed checks on a live board.
8. Reports roll up completion, timeliness, and missed-check metrics by facility, shift, staff member, unit, and resident.

---

## Interval logic

The system must support both static and dynamic interval assignment.

### Static assignment sources

- Care plan
- Resident service plan
- Facility policy template
- Clinical order where relevant
- Supervisor manual assignment

### Dynamic assignment triggers (future workflow source; schema lands now)

- Recent fall
- Wandering attempt
- Acute illness
- New medication with monitoring requirements
- Behavior change
- Dehydration risk
- Skin integrity risk
- Infection concern
- Return from hospital or ER
- Family complaint alleging lack of attention

### Intervals to support in Core

- Q15
- Q30
- Q45
- Hourly
- Every 2 hours
- Every 4 hours
- Per shift
- Custom daypart rules

### Daypart support

Rules may vary by time window, such as:

- Daytime hourly
- Overnight every 2 hours
- Meal-adjacent checks only around meals
- Toileting rounds from 6 AM through 10 PM

---

## Check payload requirements

Every completed check must capture:

- resident,
- assigned staff,
- actual completing staff,
- scheduled due time,
- completion timestamp,
- completion status,
- location / context,
- resident presentation,
- distress / exception indicators,
- intervention performed if any,
- note when required.

### Recommended quick-select fields

- Awake / asleep
- In room / common area / off unit / appointment
- In bed / in chair / ambulating
- Calm / agitated / confused / distressed
- Breathing normal / concern noted
- Pain concern yes/no
- Toileting needed / assisted
- Hydration offered
- Repositioned
- Skin concern observed
- Fall hazard observed
- Refused assistance
- Not found / immediate escalation

### Exception states

- Resident not found where expected
- Resident declined interaction
- Resident appears ill
- Resident appears injured
- Environmental hazard present
- Family concern reported
- Staff unable to complete because assignment was impossible

---

## Mobile workflow requirements

### Primary views

- **Now**: due now and overdue checks
- **My Residents**: assigned residents with next due countdown
- **Rounds Timeline**: completed, due, overdue, missed, escalated
- **Exception Queue**: follow-up items needing attention

### One-tap routine path

1. Tap resident card
2. Choose quick observation preset
3. Submit in 2–5 seconds

### Progressive disclosure

Ask for more detail only when:

- there is an abnormal observation,
- the resident is not found,
- help was provided,
- a refusal occurred,
- or the entry is late.

### UX rules

- Swipe and large tap targets for caregiver flows.
- Countdown timers and urgency coloring.
- No silent backdating.
- Late entries require a reason.

---

## Database (Core)

### Tables

- `resident_observation_plans`
- `resident_observation_plan_rules`
- `resident_observation_tasks`
- `resident_observation_logs`
- `resident_observation_exceptions`
- `resident_watch_protocols`
- `resident_watch_instances`
- `resident_watch_events`
- `resident_observation_assignments`
- `resident_observation_escalations`
- `resident_observation_integrity_flags`
- `resident_observation_templates`

### Key schema expectations

#### `resident_observation_plans`

- Links resident, organization, entity, and facility.
- Stores `status`, `source_type`, `effective_from`, `effective_to`, `created_by`, `approved_by`, and `rationale`.

#### `resident_observation_plan_rules`

- Stores interval type, interval minutes, daypart start/end, days of week, grace minutes, required field schema, and escalation policy reference.

#### `resident_observation_tasks`

- Stores one expected check per resident per rule occurrence.
- Keeps `scheduled_for`, `due_at`, `grace_ends_at`, `assigned_staff_id`, `status`, `completed_log_id`, `reassigned_from_staff_id`, and `reassignment_reason`.

#### `resident_observation_logs`

- Stores `observed_at` and `entered_at` separately.
- Tracks `entry_mode` (`live`, `late`, `offline_synced`, `bulk`).
- Stores quick status, location, resident state, intervention codes, note, and late reason.

#### `resident_observation_exceptions`

- Stores exception type, severity, follow-up requirement, linked incident, assigned owner, and resolution metadata.

#### Watch and integrity tables

- `resident_watch_protocols`, `resident_watch_instances`, and `resident_watch_events` land in Core schema so later trigger workflows do not need a breaking redesign.
- `resident_observation_integrity_flags` lands in Core schema for future documentation-quality review, even if Phase A does not automate flag creation.

### Required enums

- Observation task status
- Observation entry mode
- Observation source type
- Observation quick status
- Observation exception type
- Observation severity
- Watch status

---

## RLS (normative)

- Floor staff see only residents, plans, tasks, and logs in facilities they can access and only for the records relevant to their assignment scope.
- Supervisors and facility admins see operational detail for their facility.
- Owners and org admins may see cross-facility rollups within their organization.
- Family access is out of scope for Core and must not expose staffing surveillance detail.
- No hard deletion of completed or missed evidence in ordinary workflows.
- Late entries, reassignment, excusals, and overrides remain visible in audit history.

---

## Auditability requirements

- All plan changes, reassignment, excusals, and log updates must write to `audit_log`.
- Late entries must preserve both claimed observation time and actual entry time.
- Missed checks must remain traceable as missed, excused, reassigned, escalated, or completed late.
- No silent deletion of missed evidence.

---

## Integrations

### Resident profile / care planning

- Observation plans may derive from care-plan needs.
- Repeated rounding exceptions may justify care-plan review.

### Incident module

- Future triggered watch workflows may originate from incidents.
- Missed checks can be correlated with incident timelines.

### Medication management

- Future PRN follow-up and post-medication checks reuse the same task and logging engine.

### Staff scheduling

- Shift assignments drive default assignee selection for task generation.
- Reassignment history must remain auditable.

### Infection control

- Future symptom-watch workflows reuse the same observation task model.

### Executive intelligence

- Phase A reports remain module-local; Phase C exposes rollups to executive scorecards.

---

## Reporting requirements (Core)

- Completion rate by facility, unit, shift, staff member, and resident
- On-time completion rate
- Late completion rate
- Missed check rate
- Average completion delay
- Rescue / reassignment rate
- Exception follow-up aging

Every top-level metric should support drill-down to resident task and log timeline.

---

## Build sequence

### Phase A — foundational MVP

- Schema and RLS
- Resident observation plans
- Interval task generation
- Caregiver mobile logging
- Overdue and missed states
- Supervisor dashboard
- Basic reports

### Phase B — safety and compliance hardening

- Escalation engine
- Late-entry controls
- Integrity flags
- Triggered watch workflows
- Incident and medication integrations
- Audit exports

### Phase C — command center

- Role-based scorecards
- Facility heat maps
- Staffing feasibility analytics
- Command-center widgets

### Phase D — moonshot intelligence

- Dynamic routing
- Prediction models
- AI summaries
- Pattern detection
- Assurance scoring

### Phase E — future frontier

- Optional beacon / NFC proof signals
- Family wellness digest
- Voice-first rounding workflow
- Ambient documentation assist

---

## Definition of done (Core segment)

- Migrations `098`–`101` apply cleanly.
- RLS enforces facility and role scope.
- Caregivers can complete a routine check in under 5 seconds for the standard path.
- Late entries require a reason and visibly preserve entered-vs-observed timestamps.
- Supervisors can see due, overdue, missed, reassigned, and completed tasks without losing audit history.
- Completion reports calculate correctly at facility, shift, staff, and resident levels.
- UI routes ship with loading, empty, and error states.
- `npm run segment:gates -- --segment "<id>" --ui` passes for UI segments.

---

## Mission alignment

**pass** — this module directly strengthens resident safety, regulatory readiness, staff clarity, and owner visibility while keeping AI subordinate to human judgment and auditability.

## COL Alignment Notes

**Observation Log exists:** COL uses an `Observation Log.pdf` and `Alert Charting Log.docx` for clinical observation and alert tracking. Module 25's `resident_observation_logs` table digitalizes this workflow. The observation categories and alert types in the spec should match COL's existing charting taxonomy. Collect the Observation Log form and Alert Charting Log from COL to validate field mapping.

**24-Hour Communication Sheet:** COL uses a `24-Hour Communication Sheet.xlsx` for daily care coordination — a shift-to-shift summary of resident status. Module 25's supervisor board and shift completion reporting should replace this form. At pilot, run both in parallel (Haven digital + paper 24-hour sheet) for 30 days to build staff confidence before going Haven-only.

**Rounding frequency expectations:** COL's actual rounding frequency expectations (every 30 min? every 2 hours? by care level?) are not documented. The `resident_observation_plan_rules` table's `frequency_minutes` field must be set correctly per COL's standard of care. Collect this from COL's P&P manual or nursing director before activating the rounding engine.

**Pilot at Oakridge ALF:** Module 25 should launch first at Oakridge ALF (52 beds, pilot facility). Oakridge-specific staffing patterns (shift times, supervisor roles, unit structure) should be used to configure the first observation plans. The supervisor board at Oakridge will be the primary validation environment for the rounding workflow.
