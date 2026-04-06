# 14 — Dietary & Nutrition Management (Phase 6)

**Module:** Structured diet orders with **IDDSI** food/fluid levels, allergy and texture constraints, documentation hooks for aspiration review vs medications  
**Dependencies:** [`009_residents.sql`](../../supabase/migrations/009_residents.sql) (`residents`), [`06-medication-management.md`](06-medication-management.md) (cross-check automation is **Enhanced**)  
**Migration:** `089_dietary_nutrition.sql`  
**Canonical routes:** [`FRONTEND-CONTRACT.md`](FRONTEND-CONTRACT.md) — `/admin/dietary`

---

## Implementation note (repo migrations vs spec SQL)

Migration uses **`haven.organization_id()`**, **`haven.accessible_facility_ids()`**, **`haven.app_role()`**, and `public.haven_set_updated_at` / `haven_capture_audit_log`.

---

## Purpose (Core)

- **`diet_orders`:** One active clinical row per workflow (status tracks lifecycle); **IDDSSI** columns for **food texture** and **fluid** viscosity; **`allergy_constraints`** / **`texture_constraints`** as `text[]`; **`medication_texture_review_notes`** for human-documented aspiration / med form cross-check.

**Non-goals (Core):** Automated rule engine against `resident_medications` / EMAR; kitchen production tallies; nutrient analysis.

---

## Scope tiers

### Core

- Single table + enums; RLS (staff + **family read** for linked residents); admin hub list + create draft.

### Enhanced (defer)

- Job to flag solid-dose meds vs fluid level; recipe/menu integration; tray tickets.

---

## RLS (normative)

- **SELECT:** Facility-scoped clinical roles + **family** with **`family_resident_links`** to the resident.
- **INSERT/UPDATE:** `owner`, `org_admin`, `facility_admin`, `nurse`, `dietary`.

---

## Definition of done

- Migration applies; types updated; segment gates **PASS** when UI ships.
