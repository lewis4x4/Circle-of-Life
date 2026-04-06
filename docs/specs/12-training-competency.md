# 12 — Training & Competency Management (Phase 6)

**Module:** Skills demonstrations, evaluator sign-off, structured skills JSON, attachment metadata  
**Dependencies:** [`11-staff-management.md`](11-staff-management.md) (`staff`, `staff_certifications` patterns)  
**Migrations:** `086_competency_demonstrations_schema.sql`, `087_competency_demonstrations_rls_audit.sql`  
**Canonical routes:** [`FRONTEND-CONTRACT.md`](FRONTEND-CONTRACT.md) — `/admin/training`

---

## Implementation note (repo migrations vs spec SQL)

Migrations use **`haven.organization_id()`**, **`haven.accessible_facility_ids()`**, **`haven.app_role()`**, and `public.haven_set_updated_at` / `haven_capture_audit_log`.

---

## Purpose (Core)

- **`competency_demonstrations`:** Record **observed** competency checks (evaluator user, staff subject, **skills_json** checklist results, **attachments** metadata pointing at org storage paths — binary upload flows are **Enhanced**).

**Non-goals (Core):** Full LMS; automated training assignment; Supabase Storage upload UI (metadata only here).

---

## Scope tiers

### Core

- One table + status enum; RLS aligned with **`staff_certifications`** (admin manage; nurse read; staff read self).

### Enhanced (defer)

- Storage bucket upload + signed URLs; training course catalog; recurring due dates.

---

## RLS (normative)

- **SELECT:** Same visibility as `staff_certifications` — facility-scoped admins/nurse; staff may **SELECT** rows where they are the **`staff`** subject (`staff.user_id = auth.uid()`).
- **INSERT/UPDATE:** `owner`, `org_admin`, `facility_admin` in facility scope.

---

## Definition of done

- Migrations apply; types updated; segment gates **PASS** with training route in `DESIGN_REVIEW_ROUTES` when UI ships.
