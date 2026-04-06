# 10 — Quality Metrics (Phase 5)

**Module:** Quality Metrics — CMS-oriented measure definitions, periodic results, and PBJ staffing export batch tracking  
**Dependencies:** [`00-foundation.md`](00-foundation.md) (`organizations`, `facilities`), [`03-resident-profile.md`](03-resident-profile.md) (facility context)  
**Migrations:** `081_quality_metrics_schema.sql`, `082_quality_metrics_rls_audit.sql`  
**Canonical routes:** [`FRONTEND-CONTRACT.md`](FRONTEND-CONTRACT.md) — `/admin/quality`, `/admin/quality/measures/new`

---

## Implementation note (repo migrations vs spec SQL)

Applied migrations use **`haven.organization_id()`**, **`haven.app_role()`**, **`haven.accessible_facility_ids()`**, and `public.haven_set_updated_at` / `haven_capture_audit_log` per [`004_haven_rls_helpers.sql`](../../supabase/migrations/004_haven_rls_helpers.sql) and [`006_audit_triggers.sql`](../../supabase/migrations/006_audit_triggers.sql).

---

## Purpose

- Maintain an **org-scoped catalog** of **quality measures** (`measure_key`, optional **CMS** tagging) separate from executive KPI snapshots.
- Store **time-bounded results** per **facility** (`quality_measure_results`) for reporting and trend lines.
- Track **Payroll-Based Journal (PBJ)** **export batches** per facility and period (`pbj_export_batches`) — file bytes live in object storage; this table stores **metadata and status** only.

---

## Scope tiers

### Core (ship first)

- Tables: **`quality_measures`**, **`quality_measure_results`**, **`pbj_export_batches`**.
- **View:** `quality_latest_facility_measures` — latest non-deleted result row per `(facility_id, quality_measure_id)` by `period_end`.
- **Admin UI:** facility-scoped hub; create **measure** (org admin); list results and PBJ batches (read-only rows until Enhanced import).

### Enhanced (defer)

- Deterministic **rollups** from `time_records` / `staff` into measure results; CMS file **import** parsers.
- Scheduled PBJ generation job.

### Non-goals (v1)

- Replacing **Module 24** executive snapshots; optional cross-links only.
- Public CMS submission from Haven — export metadata only.

---

## DATABASE (Core)

See migrations **`081`** (DDL + view) and **`082`** (RLS + triggers).

- **`quality_measures`:** `organization_id`, `measure_key`, `name`, `description`, `domain`, `unit`, optional `cms_tag`, soft delete; unique active `(organization_id, measure_key)`.
- **`quality_measure_results`:** `facility_id`, `quality_measure_id`, `period_start` / `period_end`, `value_numeric` / `value_text`, `source`.
- **`pbj_export_batches`:** `facility_id`, period, `status` enum, `storage_path`, `row_count`, `error_message`.

---

## RLS (normative)

- **`quality_measures`:** SELECT for users whose `haven.organization_id()` matches; INSERT/UPDATE for **`owner`** and **`org_admin`** (catalog stewardship).
- **`quality_measure_results`** and **`pbj_export_batches`:** SELECT/INSERT/UPDATE for **`owner`**, **`org_admin`**, **`facility_admin`**, **`nurse`** with `facility_id ∈ haven.accessible_facility_ids()` (aligned with clinical admin patterns).

---

## Definition of done (Core segment)

- Migrations apply; types updated; routes listed; `npm run segment:gates -- --segment "<id>" --ui` **PASS** when UI ships.
