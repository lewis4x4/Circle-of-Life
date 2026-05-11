# Haven v2 Gap Implementation Plan

Prepared: 2026-05-11  
Source of truth: `docs/specs/handoff-evidence/HAVEN_ENGINEER_HANDOFF_v2.md` plus Supabase column-definition CSV exports.  
Decision: treat the original greenfield handoff as obsolete. Haven already has a broad schema; this plan only adds targeted gaps.

## Non-negotiable corrections from reconciliation

1. **Use `user_profiles`, not `users(id)`** for business/user ownership FKs.
2. **Do not rebuild existing modules.** Reuse existing tables for residents, rates, rooms/beds/units, observations, activities, family portal, compliance, staff, notifications, permissions, and admissions.
3. **Do not run handoff SQL verbatim.** Several snippets need adjustment:
   - `resident_observation_plans.resident_id` and `resident_observation_plan_rules.resident_id` are `NOT NULL`; facility-default rounds must be templates or applied per resident.
   - `resident_observation_interval_type` is `continuous | fixed_minutes | per_shift | daypart`, not `fixed_times`.
   - `notification_routes.severity_min` uses `incident_severity` (`level_1`–`level_4`), not `low | medium | high | critical`.
   - `role_permissions.permission_level` supports active permissions only; do not seed `none` rows.
   - `rate_schedules` inserts must include non-null care surcharge fields.
4. **Keep blocked items blocked.** Do not build GoDaddy encrypted email API until capability is verified. Do not build Quickmar import parser without sample export/Drive contract. Do not assert BoldSign legal/compliance completion until the attorney sanity check and secrets/templates are available.

## Slice plan

### Slice 1 — Foundation status + Medicaid provider support

Status: **complete** — committed/pushed as `dcdeb8d`, deployed to Supabase remote as migration `217`, and Netlify production deployed the commit.

Goal: add inspector-grade resident status history and a facility-level Medicaid provider/rate catalog without disturbing existing billing tables.

Includes:
- `resident_billable_status` view.
- `resident_status_history` table, RLS, audit, update trigger, insert/update trigger from `residents.status`.
- `resident_payers.medicaid_rate_unit`.
- `facility_medicaid_providers` table, RLS, audit, updated-at trigger.
- `resident_payers.facility_medicaid_provider_id`.

Done when:
- Migration replays.
- Root build passes.
- Migration is pushed and, if Supabase CLI is authenticated, applied to remote.

### Slice 2 — Physical plant + posted-rate seeds

Status: **complete** — committed/pushed as `af881b9`, deployed to Supabase remote as migration `218`, and Netlify production deployed the commit.

Live facility verification: remote public data dump on 2026-05-11 showed five active COL facilities under organization `00000000-0000-0000-0000-000000000001`: Oakridge ALF, Rising Oaks ALF, Homewood Lodge ALF, Plantation ALF, Grande Cypress ALF. The 6th facility is `Oakridge Demo ALF` under demo organization `11111111-1111-1111-1111-111111111111` and is soft-deleted, so no facility deletion was performed.

Goal: seed COL rooms/beds/units/rate schedules using existing `units -> rooms -> beds` and `rate_schedules`.

Includes:
- Verify/record 6th facility decision before data changes.
- Idempotent seed for Homewood 20 rooms / 36 beds.
- Idempotent seed for Plantation wings/rooms/beds after facility IDs are confirmed.
- Idempotent posted-rate schedules with all required non-null care surcharge columns.

Resolved blocker:
- Facility names/IDs verified from live database; seed is constrained to the verified COL organization/facility names and does not touch demo rows.

### Slice 3 — Rounds vocabulary + per-resident observation templates

Status: **complete** — committed/pushed as `448cd4d`, deployed to Supabase remote as migration `219`, and Netlify production deployed the commit.

Goal: make rounds/observations operational without creating parallel round tables.

Includes:
- `observation_vocab` table for dropdown-controlled location/state/activity values.
- Seed org-wide COL observation vocabulary.
- Use `resident_observation_templates` for facility/wing defaults.
- Add helper to apply Plantation wing cadence per resident using current enum values.

Explicit correction:
- Do not insert `resident_id = NULL` into observation plans/rules.

### Slice 4 — Operational logs

Status: **complete** — committed/pushed as `c16c8d8`, deployed to Supabase remote as migration `220`, and Netlify production deployed the commit. Gate artifact: `test-results/agent-gates/2026-05-11T18-06-18-445Z-COL-V2-S4.json`.

Goal: add the missing daily execution logs that are not covered by existing modules.

Includes:
- `meal_logs` and `snack_logs`.
- `maintenance_tickets` and `maintenance_task_completions` if existing operations tasks cannot satisfy ad hoc ticketing.
- `drill_log` for fire/elopement/tornado drill evidence.
- RLS, indexes, audit triggers.

### Slice 5 — Staff compliance and notification routing

Status: **complete** — committed/pushed as `3e7bb36`, deployed to Supabase remote as migration `221`, and Netlify production deployed the commit. Gate artifact: `test-results/agent-gates/2026-05-11T18-29-12-843Z-COL-V2-S5.json`.

Goal: close COL-specific staff compliance and alert-routing gaps using existing staff and notification systems.

Includes:
- Staff application-stage fields.
- Compliance-failure fields.
- `staff_attestations`.
- COL compliance-rule seeds adjusted to actual table/column names.
- COL notification route seeds mapped to actual `incident_severity` and `staff_role` enum values.
- Role-permission seed using only active permission levels.

### Slice 6 — Resident contracts + BoldSign schema

Status: **complete locally** — migration `222` added and gate artifact generated at `test-results/agent-gates/2026-05-11T18-39-02-561Z-COL-V2-S6.json`. Remote deploy/commit occurs with the Slice 6 commit.

Goal: establish the legal/e-signature contract record separate from vendor contracts.

Includes:
- `resident_contracts` table, RLS, indexes, audit.
- Storage path fields for signed PDFs/audit trail.
- Provider default `boldsign`; legacy `docusign` only retained for manual/historical compatibility if needed.

### Slice 7 — BoldSign Edge Functions

Goal: implement send + webhook functions after schema is live.

Includes:
- `boldsign-send-contract` Edge Function.
- `boldsign-webhook` Edge Function.
- HMAC verification after exact BoldSign header/payload contract is confirmed.
- Template mapping via Supabase secrets.

Blocked until:
- BoldSign API key/template IDs/webhook secret exist.
- Webhook signature documentation is verified against BoldSign docs.

### Slice 8 — Admissions Medicaid Kanban

Goal: add COL-specific Medicaid substage tracking while preserving the current `admission_case_status` enum.

Includes:
- `admission_cases.medicaid_pipeline_stage`.
- UI/API updates for the admissions/onboarding board.

### Slice 9 — UI enablement pass

Goal: make the new data understandable and usable.

Includes:
- Shared COL label helpers: `hospital_hold` → “Bed Hold — Hospital”, `loa` → “Bed Hold — Vacation/Family”, `semi_private` → “Companion”.
- Medicaid provider/rate-unit UI.
- Rooms/beds availability board enhancements.
- Rounds vocabulary UI.
- Meal/snack log UI.
- Maintenance/drill UI.
- Staff attestations/compliance UI.
- Notification-route admin UI.

## Deployment discipline

For each slice:
1. Implement only the slice.
2. Run migration checks and build.
3. Review diffs for schema safety and v2 alignment.
4. Commit with Lore trailers.
5. Push.
6. Apply Supabase migrations / deploy Edge Functions only after local verification.
7. Move to next slice.
