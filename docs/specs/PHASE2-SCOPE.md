# Phase 2 — Clinical Depth & Compliance: Scope & Tiering

**Phase**: 2 of 5
**Weeks**: 13–20
**Modules**: 4 (build order below)

---

## Phase 2 Milestone

> At the end of Phase 2, Haven enables one pilot facility to document structured assessments, maintain editable care plans, manage advanced medication workflows and controlled-substance accountability, monitor infections and vitals trends, and track survey/compliance deficiencies with operator-visible dashboards and follow-up workflows.

---

## Tier Definitions

| Tier | Definition | Spec treatment |
|------|-----------|----------------|
| **Core** | Must ship for Phase 2 milestone. Directly deepens Phase 1 operational workflows. | Full schema + UI + business rules in spec |
| **Enhanced** | High value, build if time allows within the module's 2-week window. No new external dependencies. | Schema designed but UI may be deferred; called out as stretch |
| **Future** | AI-dependent, vendor-dependent, or research-heavy. Do not build in Phase 2. | Listed as explicit non-goal in spec |

---

## Build Order

| Order | Spec File | Module | Weeks |
|-------|-----------|--------|-------|
| 7 | `03-resident-profile-advanced.md` | Care Planning Advanced | 13–14 |
| 8 | `06-medication-management.md` | Medication Management Advanced | 15–16 |
| 9 | `09-infection-control.md` | Infection Control & Health Monitoring | 17–18 |
| 10 | `08-compliance-engine.md` | Compliance Engine | 19–20 |

**Rationale for order change** (vs. README): Infection Control moved ahead of Compliance Engine. Infection control delivers concrete operational value from existing daily_logs data and has no upstream dependency on compliance. Compliance Engine reads from all other modules — it benefits from having infection control data available. Compliance also has the highest scope-creep risk and benefits from being last (forces discipline).

---

## Module 7: Care Planning Advanced (`03-resident-profile-advanced.md`)

### Milestone sentence

> Administrators and nurses can create and score structured assessments, edit versioned care plans, and generate caregiver task queues from care plan items. Acuity scores update from assessment data.

### Phase 1 foundation

- `care_plans`, `care_plan_items` tables with versioning, 15 categories, assistance levels
- `assessments` table with jsonb scores, risk_level, next_due_date
- 4 seeded `assessment_templates` (Katz ADL, Morse Fall, Braden, PHQ-9)
- Read-only care plan UI (admin + family)
- No assessment data entry UI

### Core

- Assessment entry UI for seeded types (Katz ADL, Morse Fall, Braden, PHQ-9) with form-driven structured input
- Auto-scoring: system computes total score + risk level from item responses per template `risk_thresholds`
- Acuity composite scoring: weighted formula from latest assessment scores → updates `residents.acuity_score`
- Care plan editing UI: create/edit care plan items, version care plans, set review dates
- Care plan approval workflow: draft → review → active with reviewed_by/approved_by
- Care plan item → caregiver task generation: active items with frequencies produce daily task queue entries
- Quarterly review workflow: flag plans approaching review_due_date, generate review checklist

### Enhanced

- Assessment trend views: score history over time per resident per type (line chart)
- Rules that suggest care plan updates when assessment scores cross risk thresholds
- Auto-generated quarterly review narrative draft from 90-day structured data
- Assessment overdue alerts surfaced on admin dashboard

### Future (not Phase 2)

- AI pattern recognition for decline across multiple data streams
- Photo timeline wound trending with time-series analysis
- Predictive hospitalization risk scoring

### Dependencies

- Reads: `daily_logs` (vitals for trending), `adl_logs` (ADL performance), `incidents` (falls inform fall risk)
- Extends: `assessments`, `care_plans`, `care_plan_items`, `residents`
- New tables likely: `care_plan_tasks` (generated daily task queue)

### Explicit non-goals

- No AI-generated care plan narratives as a required deliverable
- No automated care plan creation from assessment data (humans create plans)
- No wound photo intelligence

---

## Module 8: Medication Management Advanced (`06-medication-management.md`)

### Milestone sentence

> Nurses manage verbal orders with co-signature tracking, caregivers receive PRN effectiveness follow-up prompts, controlled substance counts are digitally reconciled shift-to-shift, and medication errors are captured with structured classification for trending.

### Phase 1 foundation

- `resident_medications` with full prescription model, PRN fields, controlled_schedule
- `emar_records` with Given/Refused/Held, PRN effectiveness fields
- Working eMAR queue UI (caregiver shell) with one-tap administration
- Controlled substance fields exist but no count workflow

### Core

- Medication profile UX improvements: better med list view in admin, medication history timeline
- PRN effectiveness follow-up prompts: timed alerts to caregiver after PRN administration at `prn_effectiveness_check_minutes`
- Medication error capture: structured error type (wrong med, wrong dose, wrong time, wrong resident, omission) + severity
- Medication error trending: dashboard showing errors per period by type, facility, shift
- Verbal order workflow: capture verbal/phone orders with timestamp, require physician co-signature within 48 hours, alert if unsigned
- Controlled substance count workflow: shift-to-shift count verification, dual-signature, discrepancy alerting

### Enhanced

- PRN ineffectiveness escalation: if PRN not effective after second administration, escalate to nurse
- Med-pass exception handling: better UX for held, not available, self-administered statuses
- Refusal/late-pass/error dashboards for admin oversight
- Medication destruction log for discharge/death scenarios

### Future (not Phase 2)

- Pharmacy integration (electronic orders, refill tracking)
- Drug-drug interaction checking engine
- External electronic prescribing integration
- Barcode scanning for medication verification
- Dosing validation against age/weight/renal function

### Dependencies

- Reads: `residents` (diagnoses, allergies for future interaction checking)
- Reads: `incidents` (medication-related incidents for error correlation)
- Extends: `resident_medications`, `emar_records`
- New tables likely: `medication_errors`, `verbal_orders`, `controlled_substance_counts`

### Explicit non-goals

- No external pharmacy vendor integration
- No automated interaction checking beyond simple allergy warnings
- No barcode infrastructure

---

## Module 9: Infection Control & Health Monitoring (`09-infection-control.md`)

### Milestone sentence

> Clinical staff track infection surveillance records, receive threshold-based vital sign alerts, and manage outbreak workflows. Staff illness tracking supports operational staffing decisions.

### Phase 1 foundation

- `daily_logs` captures temperature, BP, pulse, respiration, O2 sat, weight
- `condition_changes` table for acute change documentation
- `incidents` has infection-related categories
- `ahca_reportable` flag on incidents

### Core

- Infection surveillance records: type (UTI, respiratory, GI, skin, bloodstream), resident, dates, treatment, outcome
- Vitals trending views: per-resident vital sign history with visual timeline
- Threshold-based vital sign alerts: configurable per-resident baselines, alert when exceeded
- Outbreak detection rules: 2+ residents on same unit with same infection type within 72 hours triggers alert
- Outbreak case management: checklist-driven workflow (isolation, PPE, notifications, cleaning)
- Staff illness tracking: symptom screening, call-out coding, return-to-work documentation

### Enhanced

- Immunization tracking: flu, pneumonia, COVID, shingles with consent/declination records
- Antibiotic stewardship dashboards: courses per resident, culture-confirmed vs. empiric
- Trend analysis: infection rates per unit/facility/time window, benchmarking
- Infection rate calculation: infections per 1,000 resident-days

### Future (not Phase 2)

- Predictive outbreak detection (AI early warning from subtle vital sign patterns)
- Automated outbreak protocol orchestration (auto-send visitor restriction notices, etc.)
- Integration with public health reporting systems

### Dependencies

- Reads: `daily_logs` (vitals), `condition_changes` (symptoms)
- Reads: `incidents` (infection-related incidents)
- Reads: `staff` / `time_records` (staffing impact of illness)
- New tables likely: `infection_surveillance`, `infection_outbreaks`, `outbreak_actions`, `staff_illness_records`, `vital_sign_alerts`

### Explicit non-goals

- No automated AHCA outbreak reporting (manual notification with system-generated data)
- No predictive modeling
- No external lab result integration

---

## Module 10: Compliance Engine (`08-compliance-engine.md`)

### Milestone sentence

> Administrators track survey deficiencies with plans of correction, view a compliance dashboard reflecting available operational data, activate survey visit mode for rapid document retrieval, and manage a versioned policy library.

### Phase 1 foundation

- `ahca_reportable` / `ahca_reported` flags on incidents
- Audit log captures all clinical/financial data changes
- Assessment review_due_date tracks overdue assessments
- Care plan review_due_date tracks overdue reviews

### Core

- Deficiency tracking: tag number, description, severity, plan of correction, due date, corrective actions, evidence, follow-up date
- Plans of correction workflow: draft → submitted → accepted/rejected, with responsible party and timeline
- Compliance dashboard: summary view pulling from available operational data (overdue assessments, overdue care plan reviews, open incident follow-ups, infection counts, staff certification expirations)
- Survey visit mode: administrator activates when surveyor arrives; provides guided document search (pull any resident's chart, medication records, incident history, staff records by name/date)
- Policy & procedure library scaffolding: versioned documents, staff acknowledgment tracking

### Enhanced

- Rule-based compliance scoring for a focused set of high-value AHCA tags (10–15 most commonly cited, not exhaustive)
- Compliance reminders and task generation (e.g., "3 assessments overdue this week")
- Historical deficiency analysis: which tags cited most, recurrence tracking
- Emergency preparedness checklist tracking (generator tests, fire drills, evacuation drills)

### Future (not Phase 2)

- Full AHCA Form 3020 tag-by-tag exhaustive mapping (~100+ tags)
- AI mock survey engine
- AI-generated Plans of Correction narratives
- Regulatory change monitoring
- Auto-generated compliance narratives for broad survey readiness

### Dependencies

- Reads: ALL Phase 1 + Phase 2 modules (this is intentional — compliance is a cross-cutting view)
- Specifically: `assessments` (overdue), `care_plans` (review dates), `emar_records` (PRN compliance), `incidents` (open follow-ups), `infection_surveillance` (outbreak status), `staff_certifications` (expirations)
- New tables likely: `survey_deficiencies`, `plans_of_correction`, `compliance_rules`, `policy_documents`, `policy_acknowledgments`

### Explicit non-goals

- No attempt to map every AHCA tag on first pass
- No AI survey simulation
- No automated regulatory monitoring
- No heavy narrative generation
- Compliance engine does NOT replace human judgment on survey readiness — it surfaces data

---

## What Phase 2 explicitly does NOT include

These are deferred to Phase 3+ regardless of module:

1. External pharmacy integration (vendor contracts required)
2. Full drug-drug interaction engine (requires drug database licensing)
3. Exhaustive AHCA Form 3020 mapping (research project, not a 2-week build)
4. AI mock survey engine (requires compliance mapping maturity first)
5. AI decline pattern detection (requires assessment data volume first)
6. Wound photo intelligence (unless wound care becomes a specific pilot priority)
7. Barcode scanning infrastructure
8. External lab result integration
9. Predictive modeling of any kind
10. Automated external reporting (AHCA, public health)

---

## Florida AHCA regulatory touchpoints (Phase 2 relevant)

| Requirement | Module | How Phase 2 addresses it |
|-------------|--------|--------------------------|
| Care plans reviewed quarterly | 3 Adv | Review workflow with due dates + alerts |
| Fall risk reassessment after incident | 3 Adv | Assessment re-trigger linked to fall incidents |
| PRN effectiveness documentation | 6 Adv | Timed follow-up prompts + escalation |
| Controlled substance accountability | 6 Adv | Digital shift-to-shift count + audit trail |
| Medication error reporting | 6 Adv | Structured capture + trending |
| Verbal orders co-signed within 48hrs | 6 Adv | Workflow with unsigned order alerts |
| Infection surveillance documentation | 9 | Infection surveillance records |
| Outbreak reporting within 24hrs | 9 | Outbreak detection + management workflow |
| Survey deficiency correction | 8 | Deficiency tracking + Plans of Correction |
| Policy availability for surveyors | 8 | Digital policy library + survey visit mode |

---

## Success criteria for Phase 2 complete

Phase 2 is complete when:

1. All **Core** items for all 4 modules are built, tested, and passing segment gates
2. Assessment entry works end-to-end: nurse creates assessment → score computed → acuity updated → care plan review suggested if threshold crossed
3. eMAR PRN effectiveness prompts fire and persist
4. Controlled substance count reconciliation works shift-to-shift with dual signature
5. At least one infection surveillance → outbreak detection → management workflow completes end-to-end
6. Compliance dashboard shows at minimum these tiles with real Oakridge data: overdue assessments, overdue care plan reviews, open incident follow-ups, active infections, expiring staff certifications, open deficiencies
7. Survey visit mode can retrieve any single-resident chart (assessments, meds, incidents, care plan, daily logs) with p95 < 3 seconds on local dev
8. [Phase 2 acceptance checklist](./PHASE2-ACCEPTANCE-CHECKLIST.md) passes

### Hidden complexity areas

These are the most likely trouble spots — budget extra design time:

- **Care plan task generation rules**: translating frequencies ("3x daily," "every other day," "PRN") into concrete scheduled tasks with edge cases around holidays, shift boundaries, and partial days
- **Controlled substance dual-signature workflow**: two-user flow on a single device at shift handoff; UX for count mismatch resolution
- **Outbreak detection business rules**: defining what "same infection type" means when symptoms overlap (fever + cough could be respiratory OR COVID); handling edge cases at unit boundaries
- **Survey visit mode search UX**: building a fast, cross-table search that a non-technical admin can operate under pressure with a surveyor watching

---

## Next step

Write the 4 individual spec files in build order, using this scope document and its appendices as the authoritative guide. Each spec includes: database schemas, RLS policies, business rules, UI screens. Include API endpoints and Edge Functions **where justified by the workflow** — not every module needs scheduled jobs or webhooks in Phase 2 Core.

---

## Appendix A — Role Map

Roles from `app_role` enum: `owner`, `org_admin`, `facility_admin`, `nurse`, `caregiver`, `dietary`, `maintenance_role`, `family`, `broker`.

Shorthand used below: **admin** = owner, org_admin, facility_admin. **clinical** = admin + nurse + caregiver.

### Module 3 Advanced — Care Planning

| Action | Permitted roles | Notes |
|--------|----------------|-------|
| Create/score assessment (Katz ADL) | admin, nurse, caregiver | Caregivers observe ADLs daily — they can initiate Katz |
| Create/score assessment (Morse Fall, Braden, PHQ-9) | admin, nurse | Clinical judgment required; not caregiver-initiated |
| View assessment results | admin, nurse, caregiver | Read-only for caregiver |
| View assessment results (family) | family | Simplified summary only, via family care plan view |
| Create/edit care plan items | admin, nurse | Caregivers read-only |
| Approve care plan (draft → active) | facility_admin, nurse | Requires approval authority |
| Version care plan (create new version) | admin, nurse | Previous version archived |
| View care plan | admin, nurse, caregiver, family | Family sees simplified view |
| Complete care plan task | caregiver, nurse | Task queue in caregiver shell |
| Trigger quarterly review | admin, nurse | Manual or system-flagged |

### Module 6 Advanced — Medication Management

| Action | Permitted roles | Notes |
|--------|----------------|-------|
| Capture verbal order | nurse | Only licensed staff take verbal orders |
| View unsigned verbal orders | admin, nurse | Alert at 24hr and 48hr |
| Record medication error | admin, nurse, caregiver | Any clinical witness can report |
| Review/classify medication error | admin, nurse | Nurse reviews for trending |
| View medication error dashboard | admin, nurse | Trending data; admin oversight |
| Perform controlled substance count | nurse, caregiver | Requires TWO signatures (outgoing + incoming shift) |
| Resolve count discrepancy | facility_admin, nurse | Facility admin for investigation |
| Respond to PRN follow-up prompt | caregiver, nurse | Whoever administered the PRN |
| View medication profile (admin) | admin, nurse | Full medication list + history |

### Module 9 — Infection Control

| Action | Permitted roles | Notes |
|--------|----------------|-------|
| Create infection surveillance record | admin, nurse | Caregiver flags symptoms via condition_changes |
| View infection surveillance | admin, nurse | Caregiver sees alerts only |
| Activate outbreak | facility_admin, nurse | Triggers checklist generation |
| Manage outbreak checklist | admin, nurse | Caregiver follows assigned items |
| Complete outbreak checklist item | admin, nurse, caregiver | Floor staff execute checklist steps |
| Enter staff illness record | admin, nurse | Self-report via caregiver for own record |
| View vitals trending | admin, nurse, caregiver | Caregiver sees own assigned residents |
| Configure vital sign alert thresholds | admin, nurse | Per-resident baselines |

### Module 8 — Compliance Engine

| Action | Permitted roles | Notes |
|--------|----------------|-------|
| Activate survey visit mode | owner, facility_admin | High-privilege action; logged |
| Use survey visit mode (retrieve records) | owner, facility_admin, nurse | Nurse assists with chart pulls |
| Create/manage deficiencies | owner, facility_admin | Administrative function |
| Create/edit plans of correction | owner, facility_admin | Regulatory submission |
| View compliance dashboard | owner, org_admin, facility_admin, nurse | Read-only for nurse |
| Manage policy documents | owner, facility_admin | Version control + publish |
| Acknowledge policy | all staff roles | Required within defined timeframe |
| View policy library | all staff roles | Read-only |

---

## Appendix B — Cross-Module Event Triggers

These workflow handoffs must be consistent across specs. Each trigger defines a source event and the action it produces in the target module.

| Trigger Event | Source | Target | Action | Tier |
|---------------|--------|--------|--------|------|
| Fall incident created | 07 Incidents | 03 Care Planning | Flag Morse Fall reassessment as overdue for that resident | Core |
| Assessment score crosses risk threshold | 03 Care Planning | 03 Care Planning | Suggest care plan review; surface on admin dashboard | Core |
| Care plan `review_due_date` reached | 03 Care Planning | 08 Compliance | Appear as "overdue care plan review" on compliance dashboard | Core |
| Assessment `next_due_date` passed | 03 Care Planning | 08 Compliance | Appear as "overdue assessment" on compliance dashboard | Core |
| PRN eMAR record created | 06 Meds | 06 Meds | Schedule follow-up prompt at `T + prn_effectiveness_check_minutes` | Core |
| PRN effectiveness = 'ineffective' (2nd occurrence for same resident + med) | 06 Meds | 06 Meds | Escalate to nurse | Enhanced |
| Verbal order created | 06 Meds | 06 Meds | Start 48-hour countdown; alert at 24hr and 48hr if unsigned | Core |
| Controlled substance count discrepancy | 06 Meds | 06 Meds | Level 3 alert to facility_admin + nurse | Core |
| Vital sign exceeds resident threshold | 09 Infection | 09 Infection | Alert to nurse on duty (mobile) | Core |
| 2+ infection records, same unit, same type, within 72hr | 09 Infection | 09 Infection | Trigger outbreak detection alert | Core |
| Outbreak activated | 09 Infection | 09 Infection | Generate management checklist; notify facility_admin | Core |
| Active infection count changes | 09 Infection | 08 Compliance | Update compliance dashboard infection tile | Core |
| Staff certification expiring within 30 days | 11 Staff (Phase 1) | 08 Compliance | Appear on compliance dashboard | Core |
| Open incident follow-up past due date | 07 Incidents (Phase 1) | 08 Compliance | Appear on compliance dashboard | Core |
| Medication error recorded | 06 Meds | 08 Compliance | Increment error count on compliance dashboard | Enhanced |

**Implementation note**: Triggers may be implemented as database triggers, Edge Function cron jobs, or application-level checks depending on latency requirements. Real-time alerts (vital signs, PRN follow-up) need push or polling. Dashboard aggregations can be computed on page load. Specs should declare the latency expectation, not the mechanism.

---

## Appendix C — Mobile Surface Expectations

Phase 1 established: admin shell = desktop-first, caregiver shell = mobile-first (OLED dark mode), family shell = mobile-friendly.

Phase 2 modules touch both shells. This table declares which surfaces **must** work at phone width (375px) vs. which are desktop-first.

### Module 3 — Care Planning Advanced

| Surface | Shell | Mobile? | Rationale |
|---------|-------|---------|-----------|
| Assessment entry form | Admin | Desktop-first | Complex multi-item scoring forms; nurse at station |
| Assessment results view | Admin | Desktop-first | Data-dense tables |
| Care plan editing | Admin | Desktop-first | Multi-field forms with versioning |
| Care plan read view | Caregiver | **Mobile** | Caregiver references plan on floor |
| Care plan task queue | Caregiver | **Mobile** | Primary caregiver workflow — tap to complete |
| Care plan summary | Family | **Mobile** | Family checks from phone |

### Module 6 — Medication Management Advanced

| Surface | Shell | Mobile? | Rationale |
|---------|-------|---------|-----------|
| PRN follow-up prompt | Caregiver | **Mobile** | Prompt appears during shift; caregiver on floor |
| Controlled substance count | Caregiver | **Mobile** | Performed at med cart during shift handoff |
| Verbal order capture | Admin | Desktop-first | Nurse at station taking phone call |
| Medication error entry | Admin | Desktop-first | Structured form with classification |
| Medication error dashboard | Admin | Desktop-first | Trending charts and tables |
| Medication profile view | Admin | Desktop-first | Data-dense medication list |

### Module 9 — Infection Control

| Surface | Shell | Mobile? | Rationale |
|---------|-------|---------|-----------|
| Vitals alert notification | Caregiver | **Mobile** | Real-time alert during shift |
| Infection surveillance entry | Admin | Desktop-first | Nurse documents at station |
| Outbreak checklist | Caregiver | **Mobile** | Floor staff follow steps on device |
| Staff illness screening | Caregiver | **Mobile** | Pre-shift self-check from personal device |
| Vitals trending view | Admin | Desktop-first | Charts and timelines |

### Module 8 — Compliance Engine

| Surface | Shell | Mobile? | Rationale |
|---------|-------|---------|-----------|
| Compliance dashboard | Admin | Desktop-first | Data-dense executive view |
| Survey visit mode | Admin | Desktop-first | Admin at desk with surveyor |
| Deficiency tracking | Admin | Desktop-first | Administrative workflow |
| Policy acknowledgment | Both | **Mobile** | Staff sign off from any device |
| Policy library (read) | Both | **Mobile** | Staff reference on floor |
