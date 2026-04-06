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

### Enhanced (defer)

- Worker that materializes lines from approved `time_records`; CSV download; provider-specific serializers.

---

## RLS (normative)

- **SELECT/INSERT/UPDATE** (soft delete): `owner`, `org_admin`, `facility_admin` with **`facility_id ∈ haven.accessible_facility_ids()`**.

---

## Definition of done

- Migration `088` applies; types updated; segment gates **PASS** when UI ships.
