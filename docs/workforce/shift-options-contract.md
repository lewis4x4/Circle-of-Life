# Facility and role shift options — COL-804

Brian's latest 2026-09-24 instruction is authoritative: each facility owns role-specific clickable shifts and hours; they must work across scheduling, kiosk, rounding, timecards, payroll and other consumers. Homewood's supplied cook blocks (06:00–13:00 and 16:00–18:00) and colors are facility choices, not universal facts. Sign-in troubleshooting was explicitly excluded by Brian.

## Shared model

- `facility_schedule_presets`: stable ID, organization/facility, `label`, six-digit hex `color`, `allowed_staff_roles staff_role[]`, explicit `rounding_coverage` (default false), `sort_order`, `active`, `blocks` JSON array of `{start: "HH:mm", end: "HH:mm"}`, `version`, legacy `roster_shift_type`, optional imported `source_shift_definition_id`, audit fields and soft deletion.
- Blocks start on the schedule cell's local calendar date. Earlier finish means next day. Validate distinct endpoints and non-overlap, including overnight spill; add planned hours per block, excluding gaps. No default hours for a new facility. Import only each existing facility's actual configured choices.
- Assignment snapshot columns: `schedule_preset_id`, `schedule_preset_name`, `schedule_preset_color`, `schedule_preset_version`, `schedule_role_snapshot`, `schedule_time_zone`, `schedule_starts_at`, `schedule_ends_at`, `schedule_group_id`, `schedule_block_index`, `schedule_block_count`, `schedule_rounding_coverage`, verified `schedule_copied_from_assignment_id`. Actual local times remain in existing `custom_start_time` / `custom_end_time`. Existing published rows are not rewritten.
- New assignment blocks are stamped server-side from the chosen preset/version and actual facility time zone. Preset edits affect new selections, never silently rewrite saved or published assignments. Copying a week uses its saved labels/colors/blocks and preserves metadata by block identity/index.
- Preset eligibility uses the staff job role, never an app-role grant. Current schedule leadership roles remain owner, org_admin, facility_admin and manager (assistant administrator). Facility membership, current identity and clinical capabilities stay independently enforced.

## SQL contracts

- `schedule_preset_save(p_facility_id, p_preset_id, p_expected_version, p_label, p_color, p_sort_order, p_blocks, p_allowed_staff_roles, p_active, p_deleted, p_rounding_coverage default false)` returns the saved preset; new rows use version 0.
- Existing grid-save RPC retains its signature; each cell additionally accepts `preset_id` and `expected_preset_version`, or one-off `custom_blocks` using the same block format and explicit `custom_rounding_coverage`. Empty custom arrays reject; Off is explicit. Definition/custom/Off compatibility remains. Multiple rows are editable together only when they form an intact managed group.
- `schedule_assignment_intervals(p_facility_id uuid, p_from timestamptz, p_to timestamptz, p_staff_id uuid default null)` returns published, active, assigned/confirmed blocks intersecting `[p_from,p_to)`, scoped by existing RLS. Columns: `assignment_id, schedule_id, staff_id, facility_id, service_date, starts_at, ends_at, time_zone, preset_id, preset_version, label, color, staff_role, group_id, block_index, block_count, legacy_shift_type, status, is_legacy, rounding_coverage`. No patient lists in this public planned-context projection.
- `resolve_observation_task_assignees_for_instant(p_facility_id uuid, p_at timestamptz, p_resident_ids uuid[])` resolves task owners for each due instant through the existing clinical authority and clock/handoff rules, using actual saved published assignment intervals instead of enum equality. Keep old RPC compatibility while updating known generators/callers.

## Domain separation

Clinical cadence versions still govern resident check frequency, grace, escalation and complete 24-hour clinical windows. Overlapping cook/admin/care work options cannot replace that clinical policy. Staff-work labels and eligibility use the new shared assignment intervals; clinical events keep their clinical classification and can carry separate work context. Names/colors never grant permission to perform rounds.

Kiosk attendance stays an actual server-time punch ledger. Show resolved planned context after staff identification, retain unscheduled attendance and every existing credential/facility check. Split work requires actual out/in events; no automatic deduction or generated punches. Payroll uses corrected, reviewed actual time and confirmed pay rules; preset-only edits cannot change paid totals. Planned context must remain visibly separate from paid hours.

## Delivery ownership

- Root: preset management UI, schedule grid/grouping/cycle/print/CSV, integration/release evidence, canonical Linear updates.
- SQL lane: migration 513 once final allocation is rechecked; presets/RPCs/snapshot guards, SQL consumers, observation generator store/engine and SQL/Edge regressions. No hosted mutation until review.
- Shared app lane: assignment-context TypeScript contract/loader; Workforce/Staffing/People/My Schedule/huddle/reports/handoff/personal headers; rounding generation API per-due resolution and relevant tests.
- Attendance lane: kiosk/timecard/payroll planned-context presentation and source adapters, with invariance tests; no changes to pay-policy calculation or actual clock behavior.

No sequence-gap exceptions or timestamp migration shortcuts. Other numbered migrations must land in order before this release. Each lane reports exact fields/RPC deviations before implementing incompatible contracts. All lanes preserve concurrent edits.

## Whole-group shift swaps

A new group request stores every requested/offered block in server-created snapshots. Context hashes bind the facility, participants, type and full work blocks. Both staff confirmations and manager approval acknowledge the same current hash; legacy one-row requests cannot silently transfer a split group. Approval transfers every block atomically after role, membership, credential, overlap and rest checks. Stale or incomplete context must be cancelled and recreated. No staff job title or chosen shift grants clinical authority.

## Verification boundaries

Local browser fixtures use explicitly synthetic identities and in-memory persistence. They exercise the actual UI and interval helpers without hosted staff, payroll or clinical writes. Database replay and scoped authorization probes supply separate real SQL evidence. A technical release does not establish staff training, provider acceptance or a real payroll submission.

## Operator workflow

1. Select one facility and open Workforce → Schedule → Shift options.
2. Choose New shift option. Enter its label, color, display order, explicit start/finish blocks and eligible staff job roles. Add work blocks for split shifts; leave the gap between blocks unscheduled.
3. Enable resident check coverage only when this work option should supply rounding staff. Existing clinical authorization still applies. Save the option.
4. In a draft week, click a cell through that person’s eligible options, then Custom, then Off. The Custom editor has Set off even when its time fields are blank. Save the draft before publishing.
5. Edit or deactivate an option for future selections. Existing saved assignments keep their original work details. Review published work in My Schedule, kiosk context, attendance/payroll comparison, staffing and shift swaps.

Administrators and Assistant Administrators use the existing facility_admin/manager authority model; organization administrators and owners also manage choices. The separate Administrative Assistant login role is not automatically granted scheduling authority.

## Current verification evidence

- [Schedule preview](shift-options-evidence/schedule-DEMO.png), [option editor](shift-options-evidence/options-DEMO.png), [landscape print](shift-options-evidence/schedule-print-DEMO.png). All identities and settings in these captures are fictional.
- [Actual-component browser receipt](shift-options-evidence/browser-proof.json): five workflow groups passed, no page errors, no external requests, zero axe violations. Desktop, phone, printing, Custom-to-Off, role choices, saved split history, downstream planned context and full-group review were exercised.
- Focused application evidence: 121 changed Workforce tests, 89 integrated Stand Up/printing tests, 18 visitor-resolution tests and 11 observation-generator Edge tests passed. Full database replay and production evidence are recorded separately at release.
- A concurrent older split-shift release introduced migration 514. Its historical file is retained; forward migration 516 restores the shared configurable grid RPCs after it. Fixed universal color/hour helpers are superseded by the preset model. The original bundle budget is retained.

Mission alignment: pass. Facility-specific work choices remain editable and auditable, while resident policy, clinical permission, actual attendance and paid-time evidence stay independently enforced.
