# 15 — Transportation & Appointments (Phase 6)

**Module:** Fleet inventory, periodic inspections, and driver credential tracking  
**Dependencies:** [`11-staff-management.md`](11-staff-management.md) (`staff`, `facilities`)  
**Migration:** `090_transportation.sql`  
**Canonical routes:** [`FRONTEND-CONTRACT.md`](FRONTEND-CONTRACT.md) — `/admin/transportation`

---

## Implementation note (repo migrations vs spec SQL)

Migration uses **`haven.organization_id()`**, **`haven.accessible_facility_ids()`**, **`haven.app_role()`**, and `public.haven_set_updated_at` / `haven_capture_audit_log`.

---

## Purpose (Core)

- **`fleet_vehicles`:** Facility-scoped vans/shuttles with identifiers, capacity, insurance/registration dates.
- **`vehicle_inspection_logs`:** Point-in-time inspection results tied to a vehicle (odometer, pass/fail, notes).
- **`driver_credentials`:** Staff-linked license and medical-card expirations for compliance snapshots.

**Non-goals (Core):** Route optimization, resident ride scheduling UI, telematics integrations.

---

## Scope tiers

### Core

- Three tables + enums; facility RLS; admin hub lists + minimal “add” flows.

### Enhanced (defer)

- Trip/appointment scheduling; MVR pull; DVIR mobile capture.

---

## RLS (normative)

- **SELECT:** Roles with facility access: `owner`, `org_admin`, `facility_admin`, `nurse`, `caregiver`, `maintenance_role`, `dietary` (transport may serve activities/clinical outings).
- **INSERT/UPDATE:** `owner`, `org_admin`, `facility_admin`, `nurse`, `maintenance_role`.

---

## Definition of done

- Migration `090` applies; types updated; segment gates **PASS** when UI ships.
