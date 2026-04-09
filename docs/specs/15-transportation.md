# 15 — Transportation & Appointments (Phase 6)

**Module:** Fleet inventory, periodic vehicle inspections, driver credential tracking, resident transportation scheduling, mileage reimbursement logging  
**Dependencies:** [`11-staff-management.md`](11-staff-management.md) (`staff`, `facilities`), [`03-resident-profile.md`](03-resident-profile.md) (`residents`)  
**Migration:** `090_transportation.sql`  
**Canonical routes:** [`FRONTEND-CONTRACT.md`](FRONTEND-CONTRACT.md) — `/admin/transportation`

---

## Implementation note (repo migrations vs spec SQL)

Migration uses **`haven.organization_id()`**, **`haven.accessible_facility_ids()`**, **`haven.app_role()`**, and `public.haven_set_updated_at` / `haven_capture_audit_log`.

---

## COL Operational Context

Circle of Life operates transportation services across five facilities for resident medical appointments, recreational outings, and essential errands. COL currently tracks employee mileage via a spreadsheet (`Darren - Mileage Report 2025.xlsx` — 182 KB, per-employee monthly mileage log). This is the only confirmed transportation record in the wiki; it establishes that COL uses personal vehicle mileage reimbursement at minimum, and may also operate facility-owned vehicles.

Transportation involves two distinct workflows at COL:
1. **Staff mileage reimbursement** — Staff using personal vehicles for facility business log miles for reimbursement. This is confirmed by the mileage report.
2. **Resident transportation** — ALF residents require transport to/from medical appointments. Drivers must hold valid FL licenses, have background checks on file, and vehicles must pass periodic inspections per AHCA facility standards.

**Data gap:** COL's fleet composition (number of vehicles, types, VINs) is unknown. This must be collected from COL before seed data can be loaded. See Section: Document Gaps below.

---

## Purpose (Core)

- **`fleet_vehicles`:** Facility-scoped inventory of organization-owned or leased vehicles (vans, shuttles, cars). Tracks VIN, make/model/year, plate, seating capacity, wheelchair accessibility, insurance policy expiration, and registration expiration. Alerts feed the Module 11 / Module 24 dashboard for expiring credentials.
- **`vehicle_inspection_logs`:** Point-in-time inspection results tied to a vehicle. Documents odometer, inspector, pass/fail result, and deficiencies noted. Frequency: pre-trip (daily driver check-out) and periodic (monthly/quarterly). Supports AHCA survey documentation.
- **`driver_credentials`:** Staff-linked driver credential records — FL driver's license expiration, CDL status if applicable, annual MVR (motor vehicle record) pull status, background check linkage. Supplements `staff_certifications` in Module 11 for transport-specific compliance.
- **`mileage_logs`:** Staff personal vehicle mileage reimbursement tracking. Per-trip log: staff, date, purpose, origin, destination, miles, reimbursement rate, reimbursement amount. Digitalizes COL's current mileage spreadsheet. Integrates with Module 13 payroll export for reimbursement processing.
- **`resident_transport_requests`:** (Core — scheduling side only, no route optimization.) Resident appointment transport requests: resident, requested date/time, destination (facility name + address), transport type (facility van / staff personal vehicle / third-party), escort required, wheelchair, notes. Status workflow: requested → scheduled → completed / cancelled.

**Non-goals (Core):** Route optimization; GPS telematics; automated MVR pull; DVIR (Driver Vehicle Inspection Report) mobile capture app; third-party transport billing integration.

---

## Scope Tiers

### Core

- Five tables + enums.
- Fleet management: vehicle list, inspection log entry, driver credential tracking.
- Mileage log: per-trip entry by staff, manager approval, export-ready for payroll.
- Resident transport request: create request, assign vehicle/driver, mark complete.
- Expiry alerts for: vehicle insurance, vehicle registration, driver license.

### Enhanced (defer)

**Shipped (Track D14):** **`/admin/transportation/calendar`** — week strip (Sunday-start) with per-day trip counts and selectable-day agenda for **`resident_transport_requests`** (same RLS scope as hub); prev/next week, “This week”. Full month grid / external sync remain deferred.

**Shipped (Track D15):** **`/admin/transportation/mileage-approvals`** — queue of **`mileage_logs`** with **`approved_at` IS NULL**; **owner / org_admin / facility_admin / nurse** can set **`approved_at`** / **`approved_by`**; **undo** when **`payroll_export_id`** is still null. Module 13 payroll file generation remains separate.

**Shipped (Track D24):** **`/admin/transportation`** — **Download transport CSV** queries up to **500** **`resident_transport_requests`** rows for the **selected facility** (**`residents(first_name, last_name)`** join), RFC-style CSV of scheduling fields and staff/vehicle UUIDs. **No** new DDL.

- MVR (motor vehicle record) annual pull workflow with automated reminder.
- DVIR mobile capture (pre/post trip inspection form on mobile).
- Mileage reimbursement auto-calculation from IRS rate or custom org rate.
- Third-party transport (ambulette, Uber Health, LogistiCare) request integration.
- Route optimization for multi-resident outings.

---

## Schema (Core)

```sql
-- ── Enums ──────────────────────────────────────────────────────────────────

CREATE TYPE vehicle_type AS ENUM (
  'van',
  'minivan',
  'wheelchair_van',  -- ADA-accessible, lift-equipped
  'sedan',
  'suv',
  'bus'
);

CREATE TYPE inspection_frequency AS ENUM (
  'pre_trip',    -- daily driver walkthrough
  'monthly',
  'quarterly',
  'annual'
);

CREATE TYPE inspection_result AS ENUM (
  'pass',
  'pass_with_deficiencies',  -- vehicle can operate but items noted
  'fail'                     -- vehicle out of service until repaired
);

CREATE TYPE transport_type AS ENUM (
  'facility_vehicle',
  'staff_personal_vehicle',
  'third_party'
);

CREATE TYPE transport_request_status AS ENUM (
  'requested',
  'scheduled',
  'in_progress',
  'completed',
  'cancelled'
);

-- ── fleet_vehicles ─────────────────────────────────────────────────────────
CREATE TABLE fleet_vehicles (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL REFERENCES organizations(id),
  facility_id                 uuid NOT NULL REFERENCES facilities(id),
  vehicle_type                vehicle_type NOT NULL,
  make                        text NOT NULL,
  model                       text NOT NULL,
  year                        smallint NOT NULL,
  vin                         text,
  license_plate               text,
  license_state               text DEFAULT 'FL',
  seating_capacity            smallint NOT NULL,
  wheelchair_accessible       boolean NOT NULL DEFAULT false,
  lift_equipped               boolean NOT NULL DEFAULT false,
  insurance_policy_number     text,
  insurance_carrier           text,
  insurance_expires_at        date,
  registration_expires_at     date,
  last_inspection_at          date,
  odometer_at_last_inspection integer,
  active                      boolean NOT NULL DEFAULT true,
  notes                       text,
  created_by                  uuid NOT NULL REFERENCES user_profiles(user_id),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  deleted_at                  timestamptz
);

CREATE INDEX idx_fleet_facility ON fleet_vehicles(facility_id, active);

ALTER TABLE fleet_vehicles ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON fleet_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER audit_log AFTER INSERT OR UPDATE OR DELETE ON fleet_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ── vehicle_inspection_logs ────────────────────────────────────────────────
CREATE TABLE vehicle_inspection_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id),
  vehicle_id          uuid NOT NULL REFERENCES fleet_vehicles(id),
  facility_id         uuid NOT NULL REFERENCES facilities(id),
  inspected_by        uuid NOT NULL REFERENCES user_profiles(user_id),
  inspected_at        timestamptz NOT NULL DEFAULT now(),
  frequency_type      inspection_frequency NOT NULL,
  odometer            integer,
  result              inspection_result NOT NULL,
  deficiencies        text[] NOT NULL DEFAULT '{}',   -- list of noted items
  corrective_actions  text,
  out_of_service      boolean NOT NULL DEFAULT false, -- true when result = fail
  returned_to_service_at timestamptz,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inspection_vehicle ON vehicle_inspection_logs(vehicle_id, inspected_at DESC);

ALTER TABLE vehicle_inspection_logs ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON vehicle_inspection_logs
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER audit_log AFTER INSERT OR UPDATE OR DELETE ON vehicle_inspection_logs
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ── driver_credentials ─────────────────────────────────────────────────────
-- Transport-specific credential tracking per driving staff member.
CREATE TABLE driver_credentials (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id),
  facility_id           uuid NOT NULL REFERENCES facilities(id),
  staff_id              uuid NOT NULL REFERENCES staff(id),
  license_number        text NOT NULL,
  license_state         text NOT NULL DEFAULT 'FL',
  license_class         text NOT NULL DEFAULT 'D',  -- D (non-commercial), CDL-B, CDL-C
  license_expires_at    date NOT NULL,
  cdl                   boolean NOT NULL DEFAULT false,
  endorsements          text[] NOT NULL DEFAULT '{}',  -- 'P' (passenger), 'S' (school bus)
  mvr_last_pulled_at    date,
  mvr_result            text,  -- 'clear', 'minor_violations', 'disqualifying'
  background_check_date date,
  background_check_clear boolean,
  authorized_vehicles   uuid[] NOT NULL DEFAULT '{}',  -- specific vehicle IDs or empty = all
  notes                 text,
  created_by            uuid NOT NULL REFERENCES user_profiles(user_id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  UNIQUE (organization_id, staff_id)  -- one credential record per staff member per org
);

ALTER TABLE driver_credentials ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON driver_credentials
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER audit_log AFTER INSERT OR UPDATE OR DELETE ON driver_credentials
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ── mileage_logs ──────────────────────────────────────────────────────────
-- Digitalizes COL's staff personal vehicle mileage reimbursement spreadsheet.
CREATE TABLE mileage_logs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organizations(id),
  facility_id             uuid NOT NULL REFERENCES facilities(id),
  staff_id                uuid NOT NULL REFERENCES staff(id),
  trip_date               date NOT NULL,
  purpose                 text NOT NULL,        -- "Resident medical appointment", "Supply run", etc.
  origin                  text NOT NULL,
  destination             text NOT NULL,
  round_trip              boolean NOT NULL DEFAULT false,
  miles                   numeric(7,1) NOT NULL,
  reimbursement_rate_cents integer NOT NULL,    -- cents per mile; default from org settings
  reimbursement_amount_cents integer NOT NULL,  -- = miles * rate (stored, not computed at query time)
  resident_id             uuid REFERENCES residents(id),  -- null if not resident-related
  transport_request_id    uuid,                 -- populated if linked to a resident_transport_request
  approved_by             uuid REFERENCES user_profiles(user_id),
  approved_at             timestamptz,
  payroll_export_id       uuid,                 -- linked to Module 13 payroll export batch when processed
  notes                   text,
  created_by              uuid NOT NULL REFERENCES user_profiles(user_id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz
);

CREATE INDEX idx_mileage_staff ON mileage_logs(staff_id, trip_date DESC);
CREATE INDEX idx_mileage_facility ON mileage_logs(facility_id, trip_date DESC);
CREATE INDEX idx_mileage_unprocessed ON mileage_logs(facility_id) WHERE payroll_export_id IS NULL AND approved_at IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE mileage_logs ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON mileage_logs
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER audit_log AFTER INSERT OR UPDATE OR DELETE ON mileage_logs
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();

-- ── resident_transport_requests ────────────────────────────────────────────
CREATE TABLE resident_transport_requests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organizations(id),
  facility_id             uuid NOT NULL REFERENCES facilities(id),
  resident_id             uuid NOT NULL REFERENCES residents(id),
  requested_by            uuid NOT NULL REFERENCES user_profiles(user_id),
  transport_type          transport_type NOT NULL DEFAULT 'facility_vehicle',
  appointment_date        date NOT NULL,
  appointment_time        time,
  destination_name        text NOT NULL,
  destination_address     text,
  purpose                 text NOT NULL,   -- "Physician appointment", "Lab work", "Recreational outing"
  wheelchair_required     boolean NOT NULL DEFAULT false,
  escort_required         boolean NOT NULL DEFAULT false,
  escort_staff_id         uuid REFERENCES staff(id),
  vehicle_id              uuid REFERENCES fleet_vehicles(id),
  driver_staff_id         uuid REFERENCES staff(id),
  pickup_time             time,
  return_time             time,
  status                  transport_request_status NOT NULL DEFAULT 'requested',
  cancellation_reason     text,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz
);

CREATE INDEX idx_transport_resident ON resident_transport_requests(resident_id, appointment_date DESC);
CREATE INDEX idx_transport_facility ON resident_transport_requests(facility_id, appointment_date);

ALTER TABLE resident_transport_requests ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON resident_transport_requests
  FOR EACH ROW EXECUTE FUNCTION public.haven_set_updated_at();
CREATE TRIGGER audit_log AFTER INSERT OR UPDATE OR DELETE ON resident_transport_requests
  FOR EACH ROW EXECUTE FUNCTION public.haven_capture_audit_log();
```

---

## RLS Policies

```sql
-- fleet_vehicles
CREATE POLICY "Facility staff see vehicles"
  ON fleet_vehicles FOR SELECT
  USING (organization_id = haven.organization_id()
    AND facility_id = ANY(haven.accessible_facility_ids()));

CREATE POLICY "Admins and maintenance manage vehicles"
  ON fleet_vehicles FOR ALL
  USING (organization_id = haven.organization_id()
    AND facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin','maintenance_role'));

-- driver_credentials
CREATE POLICY "Facility staff see driver credentials"
  ON driver_credentials FOR SELECT
  USING (organization_id = haven.organization_id()
    AND facility_id = ANY(haven.accessible_facility_ids()));

CREATE POLICY "Admins manage driver credentials"
  ON driver_credentials FOR ALL
  USING (organization_id = haven.organization_id()
    AND facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin'));

-- mileage_logs
CREATE POLICY "Staff see own mileage logs"
  ON mileage_logs FOR SELECT
  USING (organization_id = haven.organization_id()
    AND (
      facility_id = ANY(haven.accessible_facility_ids())
      OR (SELECT user_id FROM staff WHERE id = mileage_logs.staff_id) = auth.uid()
    ));

CREATE POLICY "Staff insert own mileage"
  ON mileage_logs FOR INSERT
  WITH CHECK (organization_id = haven.organization_id()
    AND (SELECT user_id FROM staff WHERE id = mileage_logs.staff_id) = auth.uid());

CREATE POLICY "Admins manage all mileage"
  ON mileage_logs FOR ALL
  USING (organization_id = haven.organization_id()
    AND facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin'));

-- resident_transport_requests
CREATE POLICY "Facility staff see transport requests"
  ON resident_transport_requests FOR SELECT
  USING (organization_id = haven.organization_id()
    AND facility_id = ANY(haven.accessible_facility_ids()));

CREATE POLICY "Clinical staff manage transport requests"
  ON resident_transport_requests FOR ALL
  USING (organization_id = haven.organization_id()
    AND facility_id = ANY(haven.accessible_facility_ids())
    AND haven.app_role() IN ('owner','org_admin','facility_admin','nurse','caregiver'));
```

---

## Business Rules

1. **Failed vehicle inspection = out of service.** When `result = fail`, `out_of_service` must be `true`. The vehicle cannot be assigned to transport requests while `out_of_service = true` (enforced at API level — assignment query filters `WHERE out_of_service = false`).

2. **Driver license expiry blocks assignment.** A driver cannot be assigned to a `resident_transport_request` if their `driver_credentials.license_expires_at` is in the past (API-level validation).

3. **Mileage reimbursement requires approval before payroll.** `mileage_logs` rows are only included in payroll export batches (Module 13) when `approved_at IS NOT NULL`. Staff submit; manager approves.

4. **Reimbursement rate sourced from org transport settings.** The `reimbursement_rate_cents` is populated at insert from `organization_transport_settings.mileage_reimbursement_rate_cents` (migration **`114`**; editable by `owner` / `org_admin` on `/admin/transportation/settings`). If unset, application fallback matches prior IRS-like default (`DEFAULT_MILEAGE_RATE_CENTS`). Stored on the row at time of entry — not recalculated retroactively.

5. **Wheelchair requirement must match vehicle.** If `resident_transport_requests.wheelchair_required = true`, the assigned `vehicle_id` must reference a vehicle where `wheelchair_accessible = true`. API validates on assignment.

6. **Transport request → mileage log link.** When a trip uses a staff personal vehicle (`transport_type = staff_personal_vehicle`), completing the request should prompt (not require) creation of a linked `mileage_logs` record.

---

## Org transport settings (implemented)

**Mileage reimbursement rate** lives in **`organization_transport_settings`** (PK `organization_id`), column **`mileage_reimbursement_rate_cents`** — see migration **`114_organization_transport_settings.sql`**. Admin UI: `/admin/transportation/settings`.

The following **additional** org/facility settings are still **to be modeled** when MVR cadence is productized:

```
-- Future: e.g. organizations.settings or a dedicated table
mvr_pull_frequency  text   -- 'annual', 'biennial'
```

---

## UI Screens (Core)

### `/admin/transportation/settings` — Mileage reimbursement rate
- **Owner / org_admin:** Edit per-organization **`mileage_reimbursement_rate_cents`** (stored in **`organization_transport_settings`**). Preview at sample mileages; read-only notice for other roles.

### `/admin/transportation` — Transportation Hub
- **Fleet tab:** Vehicle list with insurance/registration expiry badges (red if expired, yellow if <30 days). Add/edit vehicle form. "Log Inspection" action per vehicle.
- **Driver credentials tab:** Staff with driving authorization. License expiry status. "Add credential" form.
- **Mileage tab:** Log entries by staff/date range. Manager approval queue (pending approval filter). Export to CSV for payroll.
- **Transport requests tab:** Date-range view of resident transport requests. Assign vehicle + driver. Mark in-progress / complete.

---

## Document Gaps — Needed from COL

Before Core build begins, the following must be collected from COL:

- **Fleet inventory** — How many vehicles per facility? Make/model/year/VIN/plate. Whether wheelchair-accessible vans are in service. *(Currently unknown — not documented in wiki.)*
- **Transportation policy** — COL's formal policy governing resident transport (staff qualifications, insurance requirements, consent requirements for outings). *(Not in wiki — request from administrator.)*
- **Mileage reimbursement rate** — COL's current per-mile reimbursement rate and whether it matches IRS standard or custom rate. *(Darren mileage spreadsheet confirms the workflow exists; rate unknown.)*
- **Third-party transport usage** — Does COL use LogistiCare, ambulette companies, or Uber Health? Which facilities? This determines whether `transport_type = third_party` needs vendor-linking in Enhanced.

---

## Definition of Done

- Migration `090` applies cleanly; TypeScript types updated.
- Fleet management CRUD works: add vehicle, log inspection, mark out of service.
- Driver credential entry works with expiry tracking.
- Mileage log entry + manager approval + export works.
- Resident transport request lifecycle works: requested → scheduled → completed.
- Segment gates **PASS** with transportation route in `DESIGN_REVIEW_ROUTES` when UI ships.
