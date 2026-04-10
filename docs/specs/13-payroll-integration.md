# 13 — Payroll Integration (Phase 6)

**Module:** Export batches and line items for external payroll vendors (CSV/API adapters in Enhanced)  
**Dependencies:** [`11-staff-management.md`](11-staff-management.md) (`staff`, `time_records`)  
**Migration:** `088_payroll_integration.sql`  
**Canonical routes:** [`FRONTEND-CONTRACT.md`](FRONTEND-CONTRACT.md) — `/admin/payroll`

---

## Implementation note (repo migrations vs spec SQL)

Migration uses **`haven.organization_id()`**, **`haven.accessible_facility_ids()`**, **`haven.app_role()`**, and `public.haven_set_updated_at` / `haven_capture_audit_log`.

---

## Purpose (Core)

- **`payroll_export_batches`:** One logical export run per **facility** and **pay period** (dates + provider key + status).
- **`payroll_export_lines`:** Immutable-leaning rows tied to a batch, optional **`time_record_id`**, structured **`payload`**, and a globally unique **`idempotency_key`** so re-queued jobs cannot double-insert the same logical line.

**Non-goals (Core):** Vendor API connectors; ACH; tax filing; GL payroll accrual (see Module 17).

---

## Scope tiers

### Core

- Two tables + batch status enum; RLS for owner / org_admin / facility_admin; admin list + create draft batch.
- Batch detail route: import approved `mileage_logs` (trip date within batch period, `approved_at` set, `payroll_export_id` null) into `payroll_export_lines` with `line_kind` = `mileage_reimbursement`, global idempotency key `mileage:{mileage_log_id}`; sets `mileage_logs.payroll_export_id` to the batch id.
- Batch detail **Download CSV** (client-side): columns `idempotency_key`, staff name, `line_kind`, `amount_cents`, `payload_json` for vendor handoff.

### Enhanced (defer)

**Shipped (Track D26):** **`/admin/payroll`** — **Download batches CSV** queries up to **500** **`payroll_export_batches`** rows for the **selected facility** (metadata: period, provider, status, notes, audit columns). Batch **line** CSV remains on **`/admin/payroll/[id]`** (D18). **No** new DDL.

**Shipped (Track D73):** Same hub — **status** filter (**All** / **draft** / **queued** / **exported** / **failed** / **voided**) on the **50** loaded batches; **Showing N of M**; **Download batches CSV** applies **`.eq("status", …)`** when not **All** (up to **500**); filename **`_<status>`** when filtered.

**Shipped (Track D58):** **`/admin/payroll/[id]`** (draft batches) — **Import approved `time_records`** into **`payroll_export_lines`** with **`line_kind`** = **`time_record_hours`**, **`time_record_id`** set, **`amount_cents`** null (vendor applies rates), **`payload`** = clock times + hour fields; idempotency **`time_record:{time_record_id}`**; **`clock_in`** filtered to pay period using **`America/New_York`** wall bounds (`src/lib/payroll/pay-period-bounds.ts`). Skips rows already present on any non-deleted export line with that idempotency key.

**Shipped (Track D59):** Same route — second download **`Download CSV (flat)`**: columns **`hours`** (from **`time_record_hours`** payload: **`actual_hours`** else **`regular_hours` + `overtime_hours`**) and **`miles`** (from **`mileage_reimbursement`** payload), plus idempotency, staff name, **`line_kind`**, **`amount_cents`**. Implemented in **`src/lib/payroll/payroll-export-csv.ts`**.

**Shipped (Track D64):** Same route — third download **`Download CSV (vendor handoff)`**: **`period_start`**, **`period_end`**, idempotency, staff names, **`line_kind`**, **`hours`**, **`miles`**, **`amount_usd`** (two decimal places from **`amount_cents`**). **`buildPayrollLinesCsvVendorHandoff`**. ADP/Gusto **exact** proprietary templates remain defer.

**Shipped (Track D69):** Same route — fourth download **`Download CSV (hours split)`**: same period + idempotency + staff + **`line_kind`** + **`miles`** + **`amount_usd`** as vendor handoff shape, but **`regular_hours`**, **`overtime_hours`**, and **`total_hours`** (payload-derived; **`total_hours`** matches flat/single-hours logic) for **`time_record_hours`** lines. **`buildPayrollLinesCsvHoursSplit`**. Generic columns only — not vendor-proprietary layouts.

- Provider-specific proprietary column layouts (defer).

---

## RLS (normative)

- **SELECT/INSERT/UPDATE** (soft delete): `owner`, `org_admin`, `facility_admin` with **`facility_id ∈ haven.accessible_facility_ids()`**.

---

## Definition of done

- Migration `088` applies; types updated; segment gates **PASS** when UI ships.
