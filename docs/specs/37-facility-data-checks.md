# 37 — Facility data checks: Board Check, Staff Check, Data Health

Status: FULL
Linear: COL-361
Migration: `406_facility_data_checks.sql`
Database probe: `supabase/tests/review_facility_data_checks.sql`

## Purpose

A facility's physical census board is the source of truth for who sleeps in which bed. Haven is not. Homewood Lodge reads 36 licensed beds, 25 active census and 11 ready to assign after COL-367 (migration 388), while the September 7 Stand Up workbook reported a census of 34. Staff records carry people who left with live sign-in, and more than one row for the same administrator.

The correction itself is human work done inside Haven through the flows that already exist. What is missing is a way to **prove** the correction happened and to repeat it at the next facility. This spec defines three surfaces:

- **Board Check** — a bed by bed walk that ends in a recorded, live-verified match.
- **Staff Check** — an identity by identity pass that ends every active identity as keep, deactivate or duplicate.
- **Data Health** — a read-only panel that shows the anomalies still present.

Nothing here is Homewood specific. Homewood is named only in the runbook.

## Decisions

These are settled. Do not reopen them in a later segment without an owner decision.

1. **No agent or bulk path writes production data.** This spec ships code and a runbook. Every correction goes through an existing Haven flow — admit, discharge, room move, bed hold, maintenance/offline, staff offboard, facility grant. No bulk update, merge or delete action for residents, beds, staff or grants is added anywhere.
2. **Board Check is bed by bed.** One session per facility walk. Every non-deleted bed in the facility gets exactly one current result from: `match`, `board_empty_haven_occupied`, `board_occupied_haven_empty`, `different_occupant`, `bed_not_on_board`.
3. **Board residents not in Haven** are recorded as a fix item reading `Add resident` against the bed. The administrator types no name into the check. The name enters Haven through the admit flow, using the admission paperwork, which is where PHI already lives.
4. **Re-check after fixes.** A fix item closes only when the bed's current Haven state, read live at query time, satisfies the rule below. The state function recomputes it. Nobody ticks it closed.
5. **Staff Check is identity by identity.** Every staff record and every user profile with live access to the facility gets one result from: `keep`, `deactivate`, `duplicate_of`. A duplicate is deactivated through the same COL-349 offboard flow and its facility grants are listed for reassignment in the existing grant UI. No data is merged between identities.
6. **Duplicate candidates are suggested, never resolved automatically.** Same normalized email, same auth user id on more than one staff row, or same normalized full name inside one organization. Normalization is lowercase, trimmed, whitespace collapsed, diacritics removed.
7. **Sessions and results are append only.** A newer result row for the same bed or identity in the same session supersedes the older one. Nothing is updated or deleted; a database trigger enforces it.
8. **Who can run a check.** Board Check: the roles that can admit and discharge — `owner`, `org_admin`, `facility_admin`, `nurse`. Staff Check: the roles that can deactivate staff — `owner`, `org_admin`, `facility_admin`. Both on granted facilities only.
9. **PHI stays inside Haven.** Resident names appear on the Board Check screen for granted users because they already appear on the roster. The session tables store bed ids, resident ids and result codes, never names. No names reach logs, Sentry, fixtures, evidence, commits, Linear or pull request bodies.
10. **The Board Check never replaces the physical fire census board.** It reconciles Haven against it.

## Discovery facts this spec is built on

| Question | Answer in this repository |
|---|---|
| Physical bed identity | `rooms.room_number` + `beds.bed_label`; unique per facility and per room respectively |
| Resident to bed | `residents.bed_id → beds.id`. `beds.status` follows it through `tr_residents_sync_bed_occupancy` (migration 388) |
| Holding a bed | `haven.resident_status_holds_bed(status)` = `active`, `hospital_hold`, `loa` |
| `beds.current_resident_id` | Present since migration 002, **not maintained** by 388. Never read it |
| Identity deactivated | `user_profiles.is_active = false` or `deleted_at IS NOT NULL` (set by RPC `restrict_user_access_review`, migration 327) |
| Staff deactivated | `staff.employment_status IN ('terminated','suspended')` or `deleted_at IS NOT NULL` |
| Auth user id | `user_profiles.id` **is** the auth user id. `staff.user_id` also references `auth.users` |
| Stand Up census | `stand_up_reports.values ->> 'current_total_census'` for the facility, latest `week_start` |
| Audit pattern | `public.haven_capture_audit_log()` AFTER trigger into the immutable `audit_log` |
| Append-only pattern | BEFORE UPDATE OR DELETE trigger raising `42501`, as `haven.stand_up_immutable()` does |

## Data model

Four tables in `public`, all with `organization_id` denormalized for RLS, all append only.

- `board_check_sessions` — one per facility walk. `facility_id`, `started_by`, `started_at`, `closed_by`, `closed_at`.
- `board_check_results` — one row per mark. `session_id`, `bed_id`, `result`, `haven_resident_id_at_mark`, `haven_resident_status_at_mark`, `recorded_by`, `recorded_at`. The snapshot columns record what Haven said at the moment the administrator marked the bed; they are what `different_occupant` compares against later.
- `staff_check_sessions` — mirrors `board_check_sessions`.
- `staff_check_results` — `session_id`, `subject_user_profile_id`, `subject_staff_id` (at least one present), `result`, `duplicate_of_user_profile_id`, `duplicate_of_staff_id`, `recorded_by`, `recorded_at`. A `duplicate_of` result must name a target; the other two results must not.

At most one open session per facility per check type, enforced by a partial unique index where `closed_at IS NULL`.

Indexes: `(session_id, bed_id, recorded_at desc)` and `(session_id, subject_user_profile_id, subject_staff_id, recorded_at desc)` so the latest-result lookup is a single index scan.

## Read model

Three `security invoker` functions plus two `security definer` close functions, all `SET search_path = public`.

### `public.board_check_state(p_session_id uuid)`

One row per non-deleted bed in the session's facility, in room order then bed label:

`bed_id, room_number, bed_label, room_sort_order, haven_resident_id, haven_resident_status, latest_result, latest_recorded_at, latest_recorded_by, marked_resident_id, unmarked, fix_open`

`haven_resident_id` is the resident whose `bed_id` is this bed, is not soft deleted, and whose status holds a bed. `unmarked` is true when the bed has no result in this session.

### `public.staff_check_state(p_session_id uuid)`

One row per identity with live access to the session's facility — a `staff` row at the facility, or a `user_profiles` row with an unrevoked `user_facility_access` grant to it — deduplicated by the `staff.user_id` link:

`subject_user_profile_id, subject_staff_id, display_name, role_label, facility_grant_count, last_sign_in_at, is_active, duplicate_candidate_count, duplicate_candidate_user_profile_ids, duplicate_candidate_staff_ids, latest_result, duplicate_of_user_profile_id, duplicate_of_staff_id, unmarked, fix_open`

### `public.facility_data_health(p_facility_id uuid)`

One row of live counts, described under Data Health below.

### `public.close_board_check_session(p_session_id uuid)` / `public.close_staff_check_session(p_session_id uuid)`

`security definer`, repeating the same role and facility-grant check the RLS policies apply, because a definer function does not get one for free. Each sets `closed_at`/`closed_by` only when the state function returns zero `unmarked` and zero `fix_open` rows. Otherwise it raises `P0001` naming both counts, so the screen can say what is left rather than "cannot close".

## Fix open rules

Computed live inside the state function, never stored.

| Result | Open while |
|---|---|
| `match` | never |
| `board_empty_haven_occupied` | a resident holding a bed still holds this bed |
| `board_occupied_haven_empty` | no resident holds this bed |
| `different_occupant` | the resident holding the bed is still the one recorded in `haven_resident_id_at_mark` |
| `bed_not_on_board` | `beds.status` is `available` or `occupied` |
| `keep` | never |
| `deactivate` | the subject is still active (staff `employment_status` active and not deleted, or profile `is_active` and not deleted) |
| `duplicate_of` | the subject is still active, by the same test |

`bed_not_on_board` resolves one of two ways: the operator moves the bed to `maintenance` or `offline`, or the board turns out to have been wrong and a newer result supersedes the mark. Both are real; neither is a checkbox.

## Flows

**Board Check.** Start a session from the facility's residents area. Tier 1 is a progress line and a dense table grouped by room. One tap on a segmented control records a result row. Tier 2 lists only beds with an open fix, each with the button into the flow that resolves it. Tier 3 is the session history: every result ever recorded, with actor and time, superseded rows included. `Close check` is disabled until zero unmarked and zero open. A closed session renders read only.

**Staff Check.** Same three tiers under staff administration. The result control is `Keep`, `Deactivate`, `Duplicate of…`; the last opens a picker limited to the suggested candidates plus a search within the organization. Tier 2 offers `Open deactivate` into the COL-349 flow and, for a duplicate, the list of that identity's facility grants with a link to the grant UI.

**Data Health.** Read-only tier 1 panel on the facility overview. No session, no writes.

## Data Health checks

Counts only, each with a link to the list that explains it:

1. Beds whose `status` is `occupied` with no resident holding them. Should be `0` after migration 388.
2. Residents `active`, `hospital_hold` or `loa` with no `bed_id`.
3. Beds held by more than one resident.
4. Roster census (`active + hospital_hold + loa`) beside the most recent Stand Up `current_total_census` for the facility, rendered as two plain numbers with the Stand Up week: `Roster 25 · Stand Up Sep 7: 34`. **No color.** The two numbers legitimately differ — the Stand Up is a point-in-time operator report, the roster is now — and coloring one of them would assert which is wrong.
5. Staff inactive in HR status whose linked profile can still sign in.
6. Active profiles in the organization with no live facility grant.
7. Duplicate identity candidates, by the three rules above.
8. Last closed Board Check and Staff Check dates, or `Never`.

## Closure rules

A session closes only through its close function. There are no UPDATE or DELETE policies on any of the four tables, and a BEFORE UPDATE OR DELETE trigger raises `42501` on the two result tables, so a result cannot be edited even by a table owner path. The session tables allow UPDATE only through the definer close function, which is `REVOKE`d from `PUBLIC` and granted to `authenticated`.

A closed Board Check session with zero open items is the evidence that Haven's roster matched the board at that time. It is not a claim about any later moment.

## Forbidden

- A fix item closed by a checkbox instead of live state.
- A session closable with unmarked beds or identities.
- Any action that moves records between identities.
- A resident name typed into a check result.
- Color on the roster versus Stand Up census comparison.
- A Homewood-specific code path.

## TBD

- **Board Check against a facility whose beds are not modeled room by room.** Every COL facility has `rooms` and `beds` rows today. A facility onboarded without them would show an empty walk. No repository fact says what should happen; the runbook says to check the bed list before the walk.
- **Staff at a facility with no `user_profiles` row and no `staff` row.** Such a person is invisible to both Haven and this check. Out of scope here.
- **Stand Up census when a facility has never filed one.** The panel shows the roster number and `Stand Up: none filed`. Whether a facility with no Stand Up should be flagged is an operations decision, not a repository fact.
- **Reassigning a duplicate's facility grants.** The check lists the grants and links to the existing grant UI. Whether the grant UI should gain a "move all grants" action is a separate decision, and this spec deliberately does not add one.
- **Re-opening a closed session.** Not supported. A second walk is a second session. Whether the history view should chain sessions is unspecified.
