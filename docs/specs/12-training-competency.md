# 12 — Training & Competency Management (Phase 6)

**Module:** Skills demonstrations, evaluator sign-off, structured skills JSON, mandatory FL training tracking, external program integration (Baya), in-service sign-in logging  
**Dependencies:** [`11-staff-management.md`](11-staff-management.md) (`staff`, `staff_certifications` patterns)  
**Migrations:** `086_competency_demonstrations_schema.sql`, `087_competency_demonstrations_rls_audit.sql`, `086b_training_programs.sql`, `086c_inservice_logs.sql`  
**Canonical routes:** [`FRONTEND-CONTRACT.md`](FRONTEND-CONTRACT.md) — `/admin/training`

---

## Implementation note (repo migrations vs spec SQL)

Migrations use **`haven.organization_id()`**, **`haven.accessible_facility_ids()`**, **`haven.app_role()`**, and `public.haven_set_updated_at` / `haven_capture_audit_log`.

---

## COL Operational Context

Circle of Life operates five ALF facilities (Oakridge, Rising Oaks, Homewood Lodge, Plantation, Grande Cypress) across three Florida counties. COL uses **Baya** as an external medication management training partner — Baya conducts medication safety training, issues competency certifications, and maintains sign-off records for CNAs and caregivers who administer medications. Haven must model Baya as a named external program with certificate ingestion, not assume all training is delivered in-house.

Florida ALF regulations (FAC 59A-36.011 and FAC 59A-36.022) mandate specific training categories for all staff at hire and annually. These must be tracked per-staff-member with completion dates, hours, and verifying signatures. COL currently tracks this via paper sign-in sheets (`Orientation & Training Sign-In.pdf`, in-service training sign-in logs) and Baya-issued competency certificates.

### Track D — D20 org-wide hub (2026-04-09)

When the admin shell facility control is **All facilities**, `/admin/training` lists the **latest 50** `competency_demonstrations` rows scoped by **RLS** (`haven.accessible_facility_ids()`), with **facility name** on each row. **New demonstration** still requires a **single** facility selected (existing `/admin/training/new` behavior). This is **not** the scheduled `training_compliance_snapshots` Enhanced feature.

### Track D — D21 demonstrations CSV (2026-04-09)

**Download demonstrations CSV** on `/admin/training` exports up to **500** rows (same RLS scope as the hub: single facility or **All facilities**), with facility name, staff name, status, dates, notes, and pipe-separated certificate **storage paths** from `attachments` JSON. **No** new DDL.

---

## Florida Mandatory Training Requirements (Seed Data)

The following training types are required by FL AHCA and must be seeded as `training_program` records at org initialization:

| Code | Name | Frequency | Hours | Regulatory Cite |
|------|------|-----------|-------|-----------------|
| `fl_cpr_first_aid` | CPR & First Aid | Every 2 years | 6 | FAC 59A-36.011(2) |
| `fl_alzheimers` | Alzheimer's & Dementia Care | At hire + annual | 4 | §429.52 |
| `fl_hipaa` | HIPAA & Privacy | At hire | 2 | 45 CFR §164 |
| `fl_abuse_neglect` | Abuse, Neglect & Exploitation Prevention | At hire + annual | 2 | §430.80 |
| `fl_food_safety` | Food Safety / Food Handler | At hire (dietary staff) | 2 | FAC 64E-11 |
| `fl_chw` | Community Health Worker | At hire (applicable roles) | 8 | §381.0101 |
| `fl_elopement` | Elopement Prevention & Response | At hire + annual | 1 | FAC 59A-36.019 |
| `fl_emergency_mgmt` | Emergency Management & Evacuation | Annual | 2 | §429.41(1)(a) |
| `baya_medication` | Baya Medication Safety Program | At hire + annual (med-admin roles) | 8 | FAC 59A-36.022 |
| `col_orientation` | COL New Employee Orientation | At hire (all staff) | varies | Internal |

---

## Purpose (Core)

- **`training_programs`:** Catalog of all training programs the org delivers or requires — both internal (orientation, in-service) and external (Baya, FL-mandated courses). Tracks program name, delivery type (internal/external/hybrid), required roles, frequency, hours, and regulatory citation. Seeded with Florida mandatory requirements at org creation.
- **`competency_demonstrations`:** Record **observed** competency checks: evaluator user, staff subject, **skills_json** checklist results, **attachments** metadata pointing at org storage paths. The binary upload flows (certificate PDFs, sign-in sheets) are **Enhanced** — Core stores metadata only.
- **`staff_training_completions`:** Per-staff completion log. Links staff → training_program → completion date, expiration date, hours, delivery method, verifying evaluator. Supports Baya external certificates (program = `baya_medication`, delivery_method = `external`, certificate_number stored).
- **`inservice_log_sessions`:** In-service training attendance tracking. One session = one training event (date, topic, trainer, facility). Multiple staff sign in via `inservice_log_attendees`. Matches COL's paper `Orientation & Training Sign-In.pdf` pattern — digitalizes the sign-in sheet.
- **`training_compliance_snapshots`:** Point-in-time snapshot of training compliance per staff member per required program. Generated on schedule (weekly) and on-demand. Used by compliance engine (Module 08) to surface training deficiency risk ahead of AHCA surveys.

**Non-goals (Core):** Full LMS course delivery; video/SCORM hosting; automated training assignment by role; Supabase Storage upload UI (metadata only in Core).

---

## Scope Tiers

### Core

- Four tables + enums (see schema below).
- RLS aligned with `staff_certifications` pattern.
- Admin hub: training programs catalog, staff completion log, compliance dashboard (who is overdue).
- Baya external certificate ingestion: manual entry with certificate number + date.
- In-service session log with multi-staff attendee list.
- Florida mandatory training seed data applied at org initialization.

### Enhanced (defer)

- Supabase Storage bucket upload + signed URLs for certificate PDFs.
- Automated training assignment engine by staff role.
- Recurring due-date calculation and proactive reminder Edge Function.
- Baya API integration (if Baya exposes one) for automatic completion sync.
- LMS integration (external course catalog).
- COL orientation checklist with 7-day / 30-day / 90-day gate milestones.

---

## Schema (Core)

```sql
-- ── Enums ──────────────────────────────────────────────────────────────────
CREATE TYPE training_delivery_method AS ENUM (
  'in_person',   -- on-site class or demonstration
  'external',    -- Baya, third-party vendor, state-sponsored
  'online',      -- digital course (Enhanced)
  'hybrid'
);

CREATE TYPE training_frequency AS ENUM (
  'at_hire',
  'annual',
  'biennial',    -- every 2 years (e.g., CPR)
  'as_needed',
  'one_time'
);

CREATE TYPE competency_status AS ENUM (
  'scheduled',
  'in_progress',
  'passed',
  'failed',
  'waived'       -- documented waiver with reason
);

-- ── training_programs ──────────────────────────────────────────────────────
-- Seeded at org creation with FL mandatory requirements.
-- Org admins may add internal programs.
CREATE TABLE training_programs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id),
  code                text NOT NULL,                   -- e.g., 'baya_medication', 'fl_cpr_first_aid'
  name                text NOT NULL,
  description         text,
  delivery_method     training_delivery_method NOT NULL DEFAULT 'in_person',
  frequency           training_frequency NOT NULL,
  required_hours      numeric(5,2),
  applies_to_roles    text[] NOT NULL DEFAULT '{}',    -- app_role values; empty = all roles
  regulatory_cite     text,                            -- "FAC 59A-36.022", "§429.52", etc.
  external_provider   text,                            -- "Baya", "Red Cross", etc.
  is_mandatory        boolean NOT NULL DEFAULT false,
  is_fl_required      boolean NOT NULL DEFAULT false,  -- true = seeded from FL regs, cannot delete
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  UNIQUE (organization_id, code)
);

ALTER TABLE training_programs ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON training_programs
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER audit_log AFTER INSERT OR UPDATE OR DELETE ON training_programs
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ── staff_training_completions ─────────────────────────────────────────────
CREATE TABLE staff_training_completions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id),
  facility_id         uuid NOT NULL REFERENCES facilities(id),
  staff_id            uuid NOT NULL REFERENCES staff(id),
  training_program_id uuid NOT NULL REFERENCES training_programs(id),
  completed_at        date NOT NULL,
  expires_at          date,                            -- null = one-time / no expiry
  hours_completed     numeric(5,2),
  delivery_method     training_delivery_method NOT NULL,
  external_provider   text,                            -- "Baya" when delivery = external
  certificate_number  text,                            -- Baya certificate #, Red Cross #, etc.
  evaluator_user_id   uuid REFERENCES user_profiles(user_id),
  notes               text,
  attachment_path     text,                            -- storage path; binary upload = Enhanced
  created_by          uuid NOT NULL REFERENCES user_profiles(user_id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

CREATE INDEX idx_staff_training_staff ON staff_training_completions(staff_id, training_program_id);
CREATE INDEX idx_staff_training_facility ON staff_training_completions(facility_id, completed_at DESC);
CREATE INDEX idx_staff_training_expiry ON staff_training_completions(expires_at) WHERE deleted_at IS NULL;

ALTER TABLE staff_training_completions ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON staff_training_completions
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER audit_log AFTER INSERT OR UPDATE OR DELETE ON staff_training_completions
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ── competency_demonstrations ─────────────────────────────────────────────
CREATE TABLE competency_demonstrations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id),
  facility_id         uuid NOT NULL REFERENCES facilities(id),
  staff_id            uuid NOT NULL REFERENCES staff(id),
  training_program_id uuid REFERENCES training_programs(id),  -- optional link to program
  evaluator_user_id   uuid NOT NULL REFERENCES user_profiles(user_id),
  demonstrated_at     timestamptz NOT NULL,
  status              competency_status NOT NULL DEFAULT 'in_progress',
  skills_json         jsonb NOT NULL DEFAULT '{}',
  -- skills_json structure:
  -- { "items": [{ "skill": "5-rights medication check", "result": "pass"|"fail"|"na", "notes": "" }] }
  overall_score       numeric(5,2),                   -- percentage, if applicable
  notes               text,
  attachment_paths    text[] NOT NULL DEFAULT '{}',   -- signed cert paths (Enhanced)
  created_by          uuid NOT NULL REFERENCES user_profiles(user_id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

CREATE INDEX idx_competency_staff ON competency_demonstrations(staff_id, status);
CREATE INDEX idx_competency_facility ON competency_demonstrations(facility_id, demonstrated_at DESC);

ALTER TABLE competency_demonstrations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON competency_demonstrations
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER audit_log AFTER INSERT OR UPDATE OR DELETE ON competency_demonstrations
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ── inservice_log_sessions ────────────────────────────────────────────────
-- Digitalizes COL's paper Orientation & Training Sign-In forms.
CREATE TABLE inservice_log_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id),
  facility_id         uuid NOT NULL REFERENCES facilities(id),
  training_program_id uuid REFERENCES training_programs(id),
  session_date        date NOT NULL,
  topic               text NOT NULL,
  trainer_name        text NOT NULL,
  trainer_user_id     uuid REFERENCES user_profiles(user_id),
  hours               numeric(4,2) NOT NULL,
  location            text,
  notes               text,
  created_by          uuid NOT NULL REFERENCES user_profiles(user_id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

CREATE TABLE inservice_log_attendees (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES inservice_log_sessions(id),
  staff_id    uuid NOT NULL REFERENCES staff(id),
  signed_in   boolean NOT NULL DEFAULT true,
  notes       text,
  UNIQUE (session_id, staff_id)
);

ALTER TABLE inservice_log_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inservice_log_attendees ENABLE ROW LEVEL SECURITY;
```

---

## RLS Policies

```sql
-- training_programs
CREATE POLICY "Org members read training programs"
  ON training_programs FOR SELECT
  USING (organization_id = haven.organization_id());

CREATE POLICY "Admins manage training programs"
  ON training_programs FOR ALL
  USING (organization_id = haven.organization_id()
    AND haven.app_role() IN ('owner','org_admin','facility_admin'));

-- staff_training_completions
CREATE POLICY "Facility staff see completions in accessible facilities"
  ON staff_training_completions FOR SELECT
  USING (organization_id = haven.organization_id()
    AND (facility_id = ANY(haven.accessible_facility_ids())
      OR (SELECT user_id FROM staff WHERE id = staff_training_completions.staff_id) = auth.uid()));

CREATE POLICY "Admins and nurses manage completions"
  ON staff_training_completions FOR ALL
  USING (organization_id = haven.organization_id()
    AND facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin','nurse'));

-- competency_demonstrations (same pattern as staff_certifications)
CREATE POLICY "Facility-scoped roles see demos"
  ON competency_demonstrations FOR SELECT
  USING (organization_id = haven.organization_id()
    AND (facility_id = ANY(haven.accessible_facility_ids())
      OR (SELECT user_id FROM staff WHERE id = competency_demonstrations.staff_id) = auth.uid()));

CREATE POLICY "Admins and nurses manage demos"
  ON competency_demonstrations FOR ALL
  USING (organization_id = haven.organization_id()
    AND facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin','nurse'));

-- inservice_log_sessions
CREATE POLICY "Facility staff see in-service sessions"
  ON inservice_log_sessions FOR SELECT
  USING (organization_id = haven.organization_id()
    AND facility_id = ANY(haven.accessible_facility_ids()));

CREATE POLICY "Admins manage in-service sessions"
  ON inservice_log_sessions FOR ALL
  USING (organization_id = haven.organization_id()
    AND facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin'));
```

---

## Business Rules

1. **Baya Medication Training is mandatory for all medication-administering staff.** Program code `baya_medication`, `delivery_method = external`, `external_provider = 'Baya'`. When a staff member's Baya certificate expires, the compliance snapshot flags them as non-compliant for medication administration duties.

2. **FL mandatory training cannot be deleted.** Programs where `is_fl_required = true` are read-only after seed. Org admins may update hours or description but not delete.

3. **Certificate numbers are required for external programs.** When `delivery_method = external`, `certificate_number` is required (enforced at API level).

4. **Expiry calculation:** `expires_at` is set at completion: `completed_at + frequency interval`. For `biennial` → +2 years; `annual` → +1 year; `at_hire` and `one_time` → null.

5. **In-service attendee completion:** Creating an `inservice_log_attendees` row auto-creates a `staff_training_completions` record for that staff/program/date via Edge Function (or trigger).

---

## UI Screens (Core)

### `/admin/training` — Training Hub
- Tab 1: **Programs catalog** — list of all training_programs with mandatory/FL-required badges.
- Tab 2: **Staff compliance** — per-staff grid showing all mandatory programs vs. completion status. Red = overdue, Yellow = expiring within 60 days, Green = current.
- Tab 3: **In-service log** — list of sessions; "New Session" opens form to create session + add attendees from staff picker.
- Tab 4: **Competency demos** — list of evaluations with status filter.

### Staff profile integration
- `/admin/staff/:id` must surface the Training tab: list of completions + competency demos for that staff member.
- Baya certificate input: certificate_number + expiry date fields when program is `baya_medication`.

---

## Definition of Done

- Migrations `086`, `086b`, `086c`, `087` apply cleanly; TypeScript types updated.
- Florida mandatory training programs seeded via `001_col_seed.sql` or dedicated training seed migration.
- Segment gates **PASS** with training route in `DESIGN_REVIEW_ROUTES` when UI ships.
- Baya certificate entry works: staff admin can log a Baya completion with certificate number.
- Compliance snapshot query returns correct overdue/expiring counts per facility.
