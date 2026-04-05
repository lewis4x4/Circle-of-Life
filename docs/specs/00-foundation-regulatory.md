# 00 — Foundation Regulatory & Jurisdiction Addendum (Phase 3.5)

**Segment:** `platform-regulatory-jurisdiction`  
**Migration:** `052_*`  
**Parent:** Extends concepts in [`00-foundation.md`](00-foundation.md). Apply after foundation patches `050`–`051` when ready.

---

## Purpose

Add **jurisdiction-aware** facility attributes and **staffing ratio rule** linkage so downstream modules (incidents, compliance, infection, scheduling) can key regulatory timers, surveys, and ratio enforcement without ad-hoc columns.

---

## Scope (DDL intent — implement in `052_*`)

### `facilities` columns (additive)

| Column | Type | Notes |
|--------|------|--------|
| `license_authority` | text | e.g. state AHCA, CMS |
| `alf_license_type` | text | License class / program |
| `cms_certification_number` | text | CCN when applicable |
| `medicaid_provider_id` | text | State Medicaid provider id |

### Ratio rules

- **`ratio_rule_sets`:** id, `organization_id`, name, rules `jsonb` (or normalized child table in full spec), `effective_daterange`, `deleted_at`.
- **`facilities.facility_ratio_rule_set_id`** → `ratio_rule_sets(id)` nullable.

### Scheduling

- **`shift_classification`** enum on `shift_assignments` (e.g. `regular`, `on_call`, `agency`) — align with `notification_routes` / on-call work in incident segment `058`.

---

## RLS

- Mirror org/facility scoping from `00-foundation.md`: `ratio_rule_sets` and facility columns visible per existing facility access.

---

## Acceptance (segment)

1. Migration `052_*` is additive; no destructive changes to existing `facilities` rows.
2. `npm run migrations:check` passes.
3. Document **GUC-based `facility_ids` session variable** pattern here or in `platform-search.md` for high-volume table policies (performance).

---

## Non-goals (this placeholder)

- Full AHCA rule engine — Compliance Module 08 owns deficiency taxonomy; this addendum only stores **facility identity** and **ratio set** hooks.
