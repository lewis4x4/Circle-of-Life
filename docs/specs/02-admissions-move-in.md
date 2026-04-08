# 02 — Admissions and Move-In (Phase 4)

**Module:** Admissions and Move-In — structured workflow from clearance through bed assignment to move-in  
**Dependencies:** [`00-foundation.md`](00-foundation.md), [`03-resident-profile.md`](03-resident-profile.md) (`residents`, `beds`, `resident_status`), [`16-billing.md`](16-billing.md) (`rate_schedules`), [`01-referral-inquiry.md`](01-referral-inquiry.md) (optional `referral_leads` linkage)  
**Migrations:** `077_admissions_move_in_schema.sql`, `078_admissions_move_in_rls_audit.sql`  
**Canonical routes:** [`FRONTEND-CONTRACT.md`](FRONTEND-CONTRACT.md) — `/admin/admissions`, `/admin/admissions/new`, `/admin/admissions/[id]`

---

## Implementation note (repo migrations vs spec SQL)

Applied migrations use **`haven.organization_id()`**, **`haven.app_role()`**, **`haven.accessible_facility_ids()`**, and `public.haven_set_updated_at` / `haven_capture_audit_log` per [`004_haven_rls_helpers.sql`](../../supabase/migrations/004_haven_rls_helpers.sql) and [`006_audit_triggers.sql`](../../supabase/migrations/006_audit_triggers.sql).

---

## Purpose

- Track **pre-admission workflow** for a **resident** already on file (`inquiry` / `pending_admission`): financial clearance, physician orders, **bed reservation**, and **target move-in date**.
- Optionally link to a **referral lead** for attribution.
- Store **quoted rate terms** tied to a **`rate_schedules`** row (private vs semi-private quote snapshot).

---

## Scope tiers

### Core (ship first)

- Tables: **`admission_cases`**, **`admission_case_rate_terms`**.
- Status machine: `pending_clearance` → `bed_reserved` → `move_in` → terminal success; `cancelled` aborts.
- Admin UI: facility-scoped list, create case, read-only detail (status transitions in a follow-up segment unless shipped in the same gate bundle).

### Enhanced (defer)

- Automatic bed `bed_status` transitions; resident `status` / `admission_date` sync when case reaches `move_in`.
- E-signature for rate packages.

### Non-goals (v1)

- Full document management for physician orders (store timestamps + summary text only).

---

## ENUM TYPES

```sql
CREATE TYPE admission_case_status AS ENUM (
  'pending_clearance',
  'bed_reserved',
  'move_in',
  'cancelled'
);

CREATE TYPE admission_accommodation_quote AS ENUM (
  'private',
  'semi_private'
);
```

---

## DATABASE SCHEMA (Core)

See migrations **`077`** (DDL) and **`078`** (RLS, audit, `updated_at` on `admission_cases`).

- **`admission_cases`:** `organization_id`, `facility_id`, `resident_id`, optional `referral_lead_id`, optional `bed_id` → `beds`, `status`, clearance and physician order fields, soft delete.
- **`admission_case_rate_terms`:** child rows with `rate_schedule_id`, `accommodation_type`, quoted cents, optional `effective_date`.

---

## RLS (normative)

- **SELECT / INSERT / UPDATE:** Same facility scope as `referral_leads` — `organization_id = haven.organization_id()`, `facility_id ∈ haven.accessible_facility_ids()`, `deleted_at IS NULL` for reads; roles **`owner`**, **`org_admin`**, **`facility_admin`**, **`nurse`** for writes unless policy tightened later.
- **Child table:** Policies require parent `admission_cases` row visible and in scope.
- **No authenticated DELETE** on cases — soft-delete via `deleted_at` in application layers.

---

## UI routes

- **`/admin/admissions`** — pipeline table for selected facility.
- **`/admin/admissions/new`** — create case (resident required; optional lead, bed, date).
- **`/admin/admissions/[id]`** — detail (Core: read-only fields).

---

## Definition of done (Core segment)

- Migrations apply cleanly (`npm run migrations:check`, `npm run migrations:verify:pg` when available).
- Types updated in `src/types/database.ts`.
- Admin routes listed in `FRONTEND-CONTRACT.md`; `npm run check:admin-shell` passes.
- `npm run segment:gates -- --segment "<id>" --ui` **PASS** when routes ship.

## COL Alignment Notes

**Form 1823 is a first-class regulatory object:** Florida ALF regulations (FL §429.26) require a completed AHCA Form 1823 (Physician's Report) from the resident's physician before or at admission. COL tracks this with a dedicated audit form (`Form 1823 Audit Form.xlsx`) and has facility-specific Form 1823 templates (`1823-OR.docx`, `1823-RO.docx`, `1823-HW.docx`, `1823-PT.docx`, `1823-GC.docx`). The admission workflow must include a Form 1823 document checklist item with completion tracking. A resident should not be marked `admission_complete` without a received Form 1823.

**Facility-specific admission agreements:** COL has different admission agreements for each facility (OR, RO, HW, GC variants confirmed in HR-Forms/New Hire & New Admission). The `admission_cases` model must support facility-specific agreement templates. A single generic agreement is not sufficient.

**Representative Payee / SSA-787:** COL manages Social Security Representative Payee arrangements for residents who cannot manage their own benefits (SSA Form 787 confirmed in Plantation admissions folder). Add `representative_payee_name`, `representative_payee_relationship`, `ssa_rep_payee_active` boolean, and `ssa_787_on_file` boolean to the resident financial profile (either in `admission_cases` or `residents` table). This is a legal/financial custodianship relationship that must be tracked.

**DCF coordination at admission:** For Medicaid residents, COL coordinates with the Department of Children and Families (DCF) for eligibility verification. Add a `medicaid_application_status` field and `dcf_eligibility_verified_at` timestamp to the admission workflow. The `DCF Eligibility Review.pdf` form documents this step.

**Pre-Admission Questionnaire:** COL uses a `Pre-Admission Questionnaire.pdf` for initial screening before formal admission. This form's data points (medical history, care needs, payer source, family contact) should map to the Module 01 lead profile and carry forward into the admission case on conversion.

**Advance Directives tracking:** COL provides `Advance Direct. & DNRO info. for Resid_Family.pdf` at admission. The admission checklist must include: advance directive on file (yes/no), DNRO (Do Not Resuscitate Order) status (yes/no/not applicable), healthcare proxy designation. These must be surfaced prominently in the eMAR and incident reporting workflows.
