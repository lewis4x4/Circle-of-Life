# Track E — Cross-cutting verification sweep (E12)

Manual / scripted checks for facility scoping, audit columns, soft deletes, and RLS isolation. **Not a substitute** for `docs/specs/PHASE1-RLS-VALIDATION-RECORD.md` owner sign-off when multi-facility production data exists.

## 1. `facility_id` on resident-facing tables

- Review new Track E tables (`adl_assessments`, `form_1823_records`, `admission_document_checklist_items`, `staff_discipline_records`, `family_portal_resident_rights_entries`, `fl_statute_module_links`) — all include `organization_id`; clinical tables include `facility_id` where applicable.
- When adding routes, prefer `facility_id IN (SELECT haven.accessible_facility_ids())` in RLS-aligned queries.

## 2. `updated_by` spot-check

- Tables with `haven_set_updated_at` must expose `updated_by uuid` where the trigger assigns `auth.uid()`.
- Spot-check: `form_1823_records`, `admission_document_checklist_items`, `adl_assessments` (if trigger enabled).

## 3. Soft-delete grep (API)

- Search API handlers for hard `DELETE` / `.delete(` on clinical tables; prefer soft delete + `deleted_at` filters.

## 4. RLS isolation

- Re-run pilot matrix from `docs/specs/PHASE1-RLS-VALIDATION-RECORD.md` when a second facility is live or demo data spans entities.

## 5. Scripts

- `scripts/check-memory-care.mjs` — blocks reintroduction of disallowed “Memory Care” unit strings in `src/`.
