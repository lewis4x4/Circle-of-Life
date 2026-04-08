# 05 — Discharge and Transition (Phase 4)

**Module:** Discharge and Transition — planning dates, hospice context, and medication reconciliation before handoff  
**Dependencies:** [`00-foundation.md`](00-foundation.md), [`03-resident-profile.md`](03-resident-profile.md) (`residents` discharge columns), [`06-medication-management.md`](06-medication-management.md) (medications as clinical context; reconciliation stores a snapshot)  
**Migrations:** `079_discharge_transition_schema.sql`, `080_discharge_transition_rls_audit.sql`  
**Canonical routes:** [`FRONTEND-CONTRACT.md`](FRONTEND-CONTRACT.md) — `/admin/discharge`, `/admin/discharge/new`, `/admin/discharge/[id]`

---

## Implementation note (repo migrations vs spec SQL)

Applied migrations use **`haven.organization_id()`**, **`haven.app_role()`**, **`haven.accessible_facility_ids()`**, and `public.haven_set_updated_at` / `haven_capture_audit_log` per [`004_haven_rls_helpers.sql`](../../supabase/migrations/004_haven_rls_helpers.sql) and [`006_audit_triggers.sql`](../../supabase/migrations/006_audit_triggers.sql).

---

## Purpose

- Surface **planned discharge** on the resident via **`discharge_target_date`** and document **hospice** involvement with **`hospice_status`**.
- Capture **medication reconciliation** at transition with **pharmacist attestation** fields and optional **JSON snapshot** of meds (not a substitute for eMAR history; audit uses `haven_capture_audit_log` on the reconciliation table).

---

## Scope tiers

### Core (ship first)

- **Residents (additive columns):** `discharge_target_date`, `hospice_status`.
- **Table:** `discharge_med_reconciliation` with status workflow and pharmacist fields.
- **Admin UI:** facility-scoped list, create reconciliation (draft), read-only detail.

### Enhanced (defer)

- **FHIR R4 transition summary** export via dedicated Edge Function or Route Handler; enqueue/compliance review — **do not** block Core on cloud deploy.

### Non-goals (v1)

- Replacing MAR printouts or pharmacy system of record.
- Automatic CMS discharge reporting.

---

## ENUM TYPES

```sql
CREATE TYPE hospice_status AS ENUM (
  'none',
  'pending',
  'active',
  'ended'
);

CREATE TYPE discharge_med_reconciliation_status AS ENUM (
  'draft',
  'pharmacist_review',
  'complete',
  'cancelled'
);
```

---

## DATABASE (Core)

- **`residents`:** `discharge_target_date date`, `hospice_status hospice_status NOT NULL DEFAULT 'none'`.
- **`discharge_med_reconciliation`:** org/facility/resident FKs; `status`; `pharmacist_reviewed_at`, `pharmacist_reviewed_by`, `pharmacist_npi`, `pharmacist_notes`; `nurse_reconciliation_notes`; `med_snapshot_json`; soft delete; audit on table.

---

## RLS (normative)

- **`discharge_med_reconciliation`:** SELECT/INSERT/UPDATE consistent with other clinical facility tables — `organization_id = haven.organization_id()`, `facility_id ∈ haven.accessible_facility_ids()`, roles **`owner`**, **`org_admin`**, **`facility_admin`**, **`nurse`** for writes (aligned with admission/referral patterns).
- **Residents:** existing `clinical_staff_update_residents` continues to govern new columns; no separate policy in `080` unless a migration tightens column-level rules (out of Core scope).

---

## Definition of done (Core segment)

- Migrations apply; types updated; routes in `FRONTEND-CONTRACT.md`; `npm run segment:gates -- --segment "<id>" --ui` **PASS** when UI ships.

## COL Alignment Notes

**DCF discharge notice required for Medicaid residents:** COL uses `DCF Form 2506` (Medicaid Beneficiary Discharge Notice) when discharging Medicaid residents. This is a regulatory requirement — the notice must be provided to the resident, family/representative, and DCF within specified timeframes. The discharge workflow must include a DCF 2506 generation step that is triggered when `payer_source = Medicaid`.

**Admit & Discharge Log:** COL tracks all admissions and discharges in `Admit & Discharge Log.xlsx`. The discharge module should generate entries compatible with this log format and provide an export for census continuity during the transition from paper to Haven.

**Discharge planning procedures not fully documented:** COL's formal discharge planning process (who initiates, what forms, family notification timeline, physician involvement) is not fully documented in the wiki. Before finalizing Module 05 UI, collect COL's discharge planning SOP from the administrator.

**Resident rights notification at discharge:** FL §429.28 requires specific notification of resident rights at discharge. The discharge checklist must include: resident notified of rights, 30-day notice provided (except emergency discharge), grievance procedure explained. The discharge workflow should not allow `discharge_complete` status without these checklist items confirmed.
