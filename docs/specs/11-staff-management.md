# 11 — Staff Management & Scheduling

**Dependencies:** 00-foundation
**Build Week:** 9-10

---

## DATABASE SCHEMA

```sql
-- ============================================================
-- STAFF (extends user_profiles with operational employment data)
-- ============================================================
CREATE TABLE staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),        -- linked to auth account (NULL if staff doesn't use the system yet)
  facility_id uuid NOT NULL REFERENCES facilities(id),  -- home facility
  organization_id uuid NOT NULL REFERENCES organizations(id),

  -- Personal
  first_name text NOT NULL,
  last_name text NOT NULL,
  preferred_name text,
  date_of_birth date,
  ssn_last_four text,
  phone text,
  phone_alt text,
  email text,
  address_line_1 text,
  address_line_2 text,
  city text,
  state text,
  zip text,
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_relationship text,

  -- Employment
  staff_role staff_role NOT NULL,
  employment_status employment_status NOT NULL DEFAULT 'active',
  hire_date date NOT NULL,
  termination_date date,
  termination_reason text,
  hourly_rate integer,                            -- cents
  overtime_rate integer,                          -- cents (typically 1.5x)
  is_full_time boolean NOT NULL DEFAULT true,
  is_float_pool boolean NOT NULL DEFAULT false,   -- authorized to work at multiple facilities
  max_hours_per_week integer DEFAULT 40,

  -- Photo
  photo_url text,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_staff_facility ON staff(facility_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_staff_org ON staff(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_staff_role ON staff(facility_id, staff_role) WHERE deleted_at IS NULL AND employment_status = 'active';
CREATE INDEX idx_staff_user ON staff(user_id) WHERE deleted_at IS NULL AND user_id IS NOT NULL;
CREATE INDEX idx_staff_status ON staff(facility_id, employment_status) WHERE deleted_at IS NULL;

-- ============================================================
-- STAFF CERTIFICATIONS
-- ============================================================
CREATE TABLE staff_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  certification_type text NOT NULL,              -- "cna", "lpn", "rn", "cpr_first_aid", "hiv_aids", "alf_core_training", "alzheimers_dementia", "food_handler", "medication_assistance", "fire_safety", "abuse_neglect_recognition", "resident_rights", "infection_control"
  certification_name text NOT NULL,
  issuing_authority text,
  certificate_number text,
  issue_date date NOT NULL,
  expiration_date date,                          -- NULL = no expiration
  status certification_status NOT NULL DEFAULT 'active',
  document_id uuid REFERENCES resident_documents(id), -- reusing document storage
  storage_path text,                             -- direct path to cert file
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_staff_certs ON staff_certifications(staff_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_staff_certs_type ON staff_certifications(staff_id, certification_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_staff_certs_expiration ON staff_certifications(expiration_date) WHERE deleted_at IS NULL AND status = 'active' AND expiration_date IS NOT NULL;
CREATE INDEX idx_staff_certs_facility ON staff_certifications(facility_id) WHERE deleted_at IS NULL;

-- ============================================================
-- SCHEDULES (container for a week's schedule)
-- ============================================================
CREATE TABLE schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  week_start_date date NOT NULL,                 -- always a Monday
  status schedule_status NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  published_by uuid REFERENCES auth.users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_schedules_facility ON schedules(facility_id, week_start_date DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_schedules_unique ON schedules(facility_id, week_start_date) WHERE deleted_at IS NULL;

-- ============================================================
-- SHIFT ASSIGNMENTS (individual staff-to-shift assignments)
-- ============================================================
CREATE TABLE shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES schedules(id),
  staff_id uuid NOT NULL REFERENCES staff(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  shift_date date NOT NULL,
  shift_type shift_type NOT NULL,
  custom_start_time time,                        -- for shift_type = 'custom'
  custom_end_time time,
  unit_id uuid REFERENCES units(id),             -- assigned unit/wing (if facility uses unit-based assignment)
  status shift_assignment_status NOT NULL DEFAULT 'assigned',

  -- Resident assignments for this shift
  assigned_resident_ids uuid[],                  -- specific residents this staff member is responsible for

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_shift_assignments_schedule ON shift_assignments(schedule_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_shift_assignments_staff ON shift_assignments(staff_id, shift_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_shift_assignments_facility_date ON shift_assignments(facility_id, shift_date, shift_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_shift_assignments_status ON shift_assignments(facility_id, shift_date, status) WHERE deleted_at IS NULL;

-- ============================================================
-- TIME RECORDS (clock in/out)
-- ============================================================
CREATE TABLE time_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id),
  shift_assignment_id uuid REFERENCES shift_assignments(id),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  clock_in timestamptz NOT NULL,
  clock_out timestamptz,
  clock_in_method text NOT NULL,                 -- "mobile_gps", "time_clock", "manual_entry"
  clock_out_method text,
  clock_in_latitude numeric(10,7),
  clock_in_longitude numeric(10,7),
  clock_out_latitude numeric(10,7),
  clock_out_longitude numeric(10,7),

  scheduled_hours numeric(5,2),
  actual_hours numeric(5,2),                     -- calculated from clock_in/clock_out
  regular_hours numeric(5,2),
  overtime_hours numeric(5,2),
  break_minutes integer DEFAULT 0,

  approved boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  discrepancy_notes text,                        -- if actual differs significantly from scheduled

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  deleted_at timestamptz
);

CREATE INDEX idx_time_records_staff ON time_records(staff_id, clock_in DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_time_records_facility ON time_records(facility_id, clock_in DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_time_records_unapproved ON time_records(facility_id) WHERE deleted_at IS NULL AND approved = false AND clock_out IS NOT NULL;

-- ============================================================
-- SHIFT SWAP REQUESTS
-- ============================================================
CREATE TABLE shift_swap_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requesting_staff_id uuid NOT NULL REFERENCES staff(id),
  requesting_assignment_id uuid NOT NULL REFERENCES shift_assignments(id),
  covering_staff_id uuid REFERENCES staff(id),   -- NULL until someone picks it up
  covering_assignment_id uuid REFERENCES shift_assignments(id),  -- the covering staff's original assignment (if swapping)
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),

  swap_type text NOT NULL,                       -- "swap" (trade shifts) or "giveaway" (just need coverage)
  reason text,
  status text NOT NULL DEFAULT 'pending',        -- "pending", "claimed", "approved", "denied", "cancelled"
  claimed_at timestamptz,
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  denied_reason text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_swap_requests_facility ON shift_swap_requests(facility_id) WHERE deleted_at IS NULL AND status = 'pending';
CREATE INDEX idx_swap_requests_staff ON shift_swap_requests(requesting_staff_id) WHERE deleted_at IS NULL;

-- ============================================================
-- STAFFING RATIO SNAPSHOTS (real-time compliance tracking)
-- ============================================================
CREATE TABLE staffing_ratio_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  shift shift_type NOT NULL,

  residents_present integer NOT NULL,
  staff_on_duty integer NOT NULL,
  ratio numeric(5,2) NOT NULL,                   -- residents per staff member
  required_ratio numeric(5,2) NOT NULL,          -- per Florida reg for this shift type
  is_compliant boolean NOT NULL,
  staff_detail jsonb NOT NULL DEFAULT '[]',      -- [{"staff_id": "uuid", "name": "...", "role": "cna"}]

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_staffing_snapshots ON staffing_ratio_snapshots(facility_id, snapshot_at DESC);
CREATE INDEX idx_staffing_noncompliant ON staffing_ratio_snapshots(facility_id) WHERE is_compliant = false;
```

---

## RLS POLICIES

```sql
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins see staff in accessible facilities" ON staff FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
CREATE POLICY "Staff see own record" ON staff FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND user_id = auth.uid());
CREATE POLICY "Admin can manage staff" ON staff FOR ALL
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin'));

ALTER TABLE staff_certifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins see certs" ON staff_certifications FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));
CREATE POLICY "Staff see own certs" ON staff_certifications FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND (SELECT user_id FROM staff WHERE id = staff_id) = auth.uid());

ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff see published schedules" ON schedules FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND facility_id IN (SELECT auth.accessible_facility_ids()) AND (status = 'published' OR auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')));

ALTER TABLE shift_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff see own assignments" ON shift_assignments FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND (staff_id IN (SELECT id FROM staff WHERE user_id = auth.uid()) OR auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse')));

ALTER TABLE time_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff see own time" ON time_records FOR SELECT
  USING (organization_id = auth.organization_id() AND deleted_at IS NULL AND (staff_id IN (SELECT id FROM staff WHERE user_id = auth.uid()) OR auth.app_role() IN ('owner', 'org_admin', 'facility_admin')));
CREATE POLICY "Staff clock in/out" ON time_records FOR INSERT
  WITH CHECK (organization_id = auth.organization_id() AND staff_id IN (SELECT id FROM staff WHERE user_id = auth.uid()));

ALTER TABLE staffing_ratio_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins see ratios" ON staffing_ratio_snapshots FOR SELECT
  USING (organization_id = auth.organization_id() AND facility_id IN (SELECT auth.accessible_facility_ids()) AND auth.app_role() IN ('owner', 'org_admin', 'facility_admin', 'nurse'));

-- Audit + updated_at triggers
CREATE TRIGGER audit_staff AFTER INSERT OR UPDATE OR DELETE ON staff FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_staff_certs AFTER INSERT OR UPDATE OR DELETE ON staff_certifications FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_shift_assignments AFTER INSERT OR UPDATE OR DELETE ON shift_assignments FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER audit_time_records AFTER INSERT OR UPDATE OR DELETE ON time_records FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON staff FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON staff_certifications FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON schedules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON shift_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON time_records FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## BUSINESS RULES

### Florida ALF Staffing Ratios
| Shift | Required Ratio | Hours |
|-------|---------------|-------|
| Day | 1 staff : 6 residents | 7:00 AM – 3:00 PM |
| Evening | 1 staff : 10 residents | 3:00 PM – 11:00 PM |
| Night | 1 staff : 20 residents | 11:00 PM – 7:00 AM |

**Rule:** Staffing ratio snapshot is calculated every 30 minutes. If `ratio > required_ratio`, generate immediate alert to facility_admin and on-shift nurse. Alert includes: current count, required count, shortfall, and suggested actions (call in PRN staff, contact float pool at sister facility, contact agency).

### Certification Expiration Alerts
| Days Until Expiration | Action |
|----------------------|--------|
| 90 days | Alert to staff member and facility_admin. Status: "active" |
| 60 days | Alert to staff member, facility_admin, and org_admin. Status: "active" |
| 30 days | Alert to all above + owner. Status: "pending_renewal" |
| 0 days (expired) | Status: "expired". Staff member restricted from performing duties requiring this certification. Alert all. |

**Florida-Required Certifications by Role:**

| Certification | CNA | LPN | RN | Activities | Dietary | All Staff |
|--------------|-----|-----|----|-----------:|--------:|----------:|
| CNA License | ✓ | | | | | |
| LPN License | | ✓ | | | | |
| RN License | | | ✓ | | | |
| CPR/First Aid | ✓ | ✓ | ✓ | ✓ | | |
| ALF Core Training | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| HIV/AIDS In-Service | | | | | | ✓ (annual) |
| Alzheimer's/Dementia | | | | | | ✓ (1hr annual) |
| Abuse/Neglect Recognition | | | | | | ✓ (annual) |
| Resident Rights | | | | | | ✓ (annual) |
| Food Handler | | | | | ✓ | |
| Medication Assistance | ✓ | N/A | N/A | | | |

### Overtime Rules
- Regular hours: ≤40 per week per staff member
- Overtime threshold: >40 hours/week = 1.5x rate
- WHEN a shift_assignment would push a staff member over 36 hours for the week → generate overtime warning to schedule creator
- WHEN a time_record shows actual hours exceeding 40 for the week → auto-calculate overtime_hours and flag for administrator review

### Schedule Validation Rules
Before a schedule can be published (status: 'draft' → 'published'):
1. Every shift at every facility must meet minimum staffing ratios
2. No staff member scheduled for >60 hours in the week
3. No staff member scheduled for back-to-back shifts without minimum 8 hours between
4. No staff member scheduled at two facilities for overlapping shifts
5. No staff member with expired required certifications assigned to shifts requiring those certifications
6. At least one nurse (LPN or RN) scheduled per shift (Florida requirement varies by facility size — configure per facility)

Validation failures block publishing and display specific violations.

### Geofence for Clock-In
- Each facility has a geofence boundary (configurable radius, default 200 meters from facility address)
- Mobile clock-in requires GPS coordinates within the geofence
- Clock-in outside geofence: blocked with message "You appear to be outside the facility. Contact your supervisor."
- Clock-out: no geofence requirement (staff may leave and clock out from parking lot)

---

## API ENDPOINTS

| Method | Route | Auth | Roles | Description |
|--------|-------|------|-------|-------------|
| GET | `/staff` | Required | Admin+ | List staff. Params: `facility_id`, `role`, `status`, `search` |
| GET | `/staff/:id` | Required | Admin+ or self | Get staff detail |
| POST | `/staff` | Required | facility_admin+ | Create staff record |
| PUT | `/staff/:id` | Required | facility_admin+ | Update staff record |
| GET | `/staff/:id/certifications` | Required | Admin+ or self | List certifications |
| POST | `/staff/:id/certifications` | Required | facility_admin+ | Add certification |
| PUT | `/staff-certifications/:id` | Required | facility_admin+ | Update certification |
| GET | `/certifications/expiring` | Required | facility_admin+ | List certs expiring within N days. Param: `days` (default 90) |
| GET | `/schedules` | Required | Staff | List schedules. Params: `facility_id`, `week_start` |
| POST | `/schedules` | Required | facility_admin, nurse | Create schedule draft |
| PUT | `/schedules/:id` | Required | facility_admin, nurse | Update schedule |
| POST | `/schedules/:id/publish` | Required | facility_admin | Publish schedule (runs validation) |
| GET | `/schedules/:id/assignments` | Required | Staff | List shift assignments for a schedule |
| POST | `/schedules/:id/assignments` | Required | facility_admin, nurse | Add shift assignment |
| PUT | `/shift-assignments/:id` | Required | facility_admin, nurse | Update assignment |
| DELETE | `/shift-assignments/:id` | Required | facility_admin, nurse | Remove assignment |
| POST | `/time-records/clock-in` | Required | Staff (self) | Clock in with GPS |
| POST | `/time-records/clock-out` | Required | Staff (self) | Clock out |
| GET | `/time-records` | Required | Admin+ or self | List time records. Params: `staff_id`, `date_from`, `date_to` |
| PUT | `/time-records/:id/approve` | Required | facility_admin | Approve time record |
| POST | `/shift-swap-requests` | Required | Staff (self) | Create swap request |
| GET | `/shift-swap-requests/open` | Required | Staff | List open swap requests at facility |
| PUT | `/shift-swap-requests/:id/claim` | Required | Staff | Claim an open swap |
| PUT | `/shift-swap-requests/:id/approve` | Required | facility_admin, nurse | Approve swap |
| GET | `/facilities/:id/staffing-ratio` | Required | Admin+ | Current staffing ratio |
| GET | `/facilities/:id/staffing-ratio/history` | Required | Admin+ | Staffing ratio history |

---

## EDGE FUNCTIONS

| Function | Trigger | Logic |
|----------|---------|-------|
| `staffing-ratio-snapshot` | Cron (every 30 min) | For each facility: count active residents present, count staff currently clocked in, calculate ratio, compare to required, store snapshot, generate alert if non-compliant. |
| `certification-expiration-check` | Cron (daily 6 AM ET) | Scan staff_certifications for upcoming expirations per the alert schedule. Generate appropriate alerts. Update status to 'pending_renewal' or 'expired'. |
| `overtime-projection` | Cron (Wednesday + Friday at noon ET) | For each staff member: calculate hours worked + scheduled remaining this week. Flag projected overtime to facility_admin. |
| `schedule-validation` | Called by POST /schedules/:id/publish | Run all validation rules. Return pass/fail with specific violations. |
| `shift-swap-notification` | INSERT on shift_swap_requests | Notify eligible staff at the same facility that a shift is available for swap/coverage. |

---

## UI SCREENS

Route and shell conventions follow `docs/specs/FRONTEND-CONTRACT.md`.

### Web (Admin Dashboard)

| Screen | Route | Description |
|--------|-------|-------------|
| Staff Directory | `/admin/staff` | Sortable table: name, role, status, hire date, certs expiring. Quick filters by role. |
| Staff Profile | `/admin/staff/:id` | Employment details, certification list with expiration indicators, schedule view, time record history, performance notes |
| Certification Dashboard | `/admin/certifications` | Grid: staff names × certification types. Green (current), Yellow (expiring in 90 days), Red (expired or missing). Drill down to renew. |
| Schedule Builder | `/admin/schedules?week=2026-04-06` | 7-day grid, shifts as rows, drag-drop staff assignment. Color coding: green (compliant), red (understaffed), yellow (overtime risk). Publish button with validation. |
| Time Records | `/admin/time-records` | Table: staff, date, clock in, clock out, hours, overtime, approved. Bulk approve button. |
| Staffing Dashboard | `/admin/staffing` | Real-time ratio display per shift, historical ratio chart, alert log |

### Mobile (Staff)

| Screen | Route | Description |
|--------|-------|-------------|
| My Schedule | `/caregiver/me/schedule` | Week view of my shifts across all facilities. Tap shift for details. |
| Clock In/Out | `/caregiver/me/clock` | Large clock-in button. Shows GPS status. Current shift info. Clock-out button. |
| Swap Board | `/caregiver/me/swaps` | Open swap requests at my facility. My pending requests. Claim button. |
