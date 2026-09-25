# GOAL: Homewood test window, open now and force-wipe on Sept 30 (COL-849)

Brian is testing every floor tablet and front-door kiosk feature on production at Homewood Lodge, using the real iPads, real staff PINs and Homewood's real residents. Everything the test creates must be removed on the evening of Sept 30, before the 05:30 ET Oct 1 Timeclock job. Ship two hosted-SQL scripts, a runbook and a local proof:

- The open script turns Smart Rounding on at Homewood for the test and keeps outside alerts to Brian only.
- The wipe script deletes every row the test window created, including rows in tables that block deletes by design.
- Then it restores Homewood to its pre-go-live state.

Work autonomously. Do not stop until every completion criterion below is met. Do not ask for permission on routine implementation decisions inside the locked stack.

---

## Paths

- Repository and build target: `/Users/brianlewis/Circle of Life/Circle-of-Life`
- This briefing and the test plan: `HANDOFFS/2026-09-25__homewood-test-window/` (`GOAL.md`, `TEST-PLAN.md`)
- Floor and kiosk spec: `docs/specs/40-floor-tablet-and-kiosk.md` (shipped with COL-677, PR #814)
- Existing Homewood scripts to follow as the pattern: `scripts/floor/homewood-pause-cadence.sql`, `scripts/floor/homewood-clear-pre-go-live.sql`
- Branch: `blewis/col-849-homewood-test-window-full-floor-and-kiosk-testing-on`, cut from `origin/main`. The local `main` is behind, so run `git fetch origin` first.

---

## Facts from production (read on 2026-09-25, do not re-derive by writing to production)

| Fact | Value |
|---|---|
| Organization | `00000000-0000-0000-0000-000000000001` |
| Homewood facility | `00000000-0000-0000-0002-000000000003`, 43 residents, 17 staff rows |
| Window start | `2026-09-25 20:24:02.307103+00` (4:24 PM ET). At that moment Homewood's `timeclock_facility_settings.timeclock_enabled` was set to `true` on production. The row did not exist before then. |
| Window end | The wipe runs on the evening of 2026-09-30 ET. The test cadence must stop generating checks at `2026-10-01 00:00:00+00` (8:00 PM ET Sept 30). |
| Oct 1 go-live job | `cron.job` named `col695-homewood-timeclock-on`, schedule `30 9 1 10 *`. It upserts `timeclock_enabled = true` for Homewood on 2026-10-01 and then unschedules itself. The wipe must leave it scheduled and untouched. |
| Cadence | `facility_cadence_versions` for Homewood: version 1 superseded; version 2 `active` (COL-695 pause, no windows until go-live); version 3 `scheduled`, `effective_from 2026-10-01 10:00:00+00`, windows copied from version 1 with the 22:00 and 02:00 windows disabled (COL-735). |
| Activity before the window | In the 7 days before the window, Homewood had 0 incidents, 0 observation logs, 0 visitor log entries and 0 shift handoffs, plus 1,011 generated `resident_observation_tasks` and 12 `exec_alerts`. None of the pre-window rows may be deleted or changed. |
| Timeclock state at window start | 0 `timeclock_credentials`, 0 `timeclock_devices`, 0 `floor_unlocks`. Brian is issuing PINs and enrolling HL-KIOSK-01 and HL-FLOOR-01 to 03 inside the window. |
| Delete guards (non-internal triggers that fire on DELETE) | `time_punches`: `tr_time_punches_append_only`, `tr_payroll_source_revision`. `time_punch_corrections`: `tr_time_punch_corrections_append_only`, `tr_payroll_source_revision`. `resident_observation_logs`: `tr_rounding_logs_immutable`. `rounding_completion_receipts`: `tr_rounding_completion_receipts_immutable`. `resident_observation_tasks`: `tr_rounding_task_write_guard`. `floor_unlocks`: `tr_floor_unlocks_guard`, `tr_payroll_source_revision`. |
| Audit triggers | `tr_exec_alerts_audit`, `tr_incidents_audit`, `tr_observation_escalation_dispatches_audit`, `tr_resident_observation_escalations_audit`, `tr_resident_observation_logs_audit`, `tr_resident_observation_tasks_audit`, `tr_shift_handoffs_audit`, `visitor_log_entries_audit_trigger`. They stay enabled during the wipe, so the audit trail records the deletion. |

---

## First action

1. `git fetch origin` and cut the branch from `origin/main`.
2. Read `docs/specs/40-floor-tablet-and-kiosk.md`, the two existing `scripts/floor/homewood-*.sql` scripts, and `HANDOFFS/2026-09-25__homewood-test-window/TEST-PLAN.md`.
3. Build the write inventory. This is every table any floor or kiosk flow in the TEST-PLAN can insert into or update, found from:
   - the code: `src/app/(floor)`, `src/app/kiosk`, `/api/floor/*`, `/api/kiosk/*`, the timeclock, visitor, rounding and care-event libraries, and the `observation-task-generator` Edge Function;
   - the database: every function they call, every trigger those writes fire, every table those triggers write, and every foreign key into those tables.

   Include derived rows: payroll source revisions, escalations, dispatches and deliveries, exec alerts and their per-user state, notifications, integrity flags, exceptions, care events and their child tables, incident photos and storage objects, handoff notes and sync rejections.

Output the inventory as a table (table, how the test writes it, window scope column, delete order, guard triggers) before writing either script.

---

## Completion criteria: the goal is met when ALL of these pass

1. The write inventory table is visible in the transcript, and every table in it is covered by the wipe script or explicitly listed as kept with a reason.
2. `scripts/floor/homewood-test-window-open.sql` exists with a dry-run SELECT section and an apply transaction. It:
   - sets Timeclock on (idempotent);
   - activates a Smart Rounding test cadence at Homewood through the same cadence version mechanism `homewood-pause-cadence.sql` uses, with version 3's windows, effective from when it is applied and generating nothing after `2026-10-01 00:00:00+00`, while version 3 stays scheduled for `2026-10-01 10:00:00+00`;
   - makes sure no SMS, email or push notification from Homewood observation escalations, operation escalations or exec alerts reaches anyone other than Brian (`blewis@lewisinsurance.com`) during the window;
   - records the exact prior notification configuration where the wipe can restore it.
3. `scripts/floor/homewood-test-window-wipe.sql` exists with:
   - a dry-run section printing per-table counts of window rows and of pre-window rows (the latter must stay untouched);
   - one apply transaction that disables only the listed guard triggers by name, deletes every window row at Homewood in foreign-key order, re-enables those triggers, and asserts inside the transaction that each is enabled (`tgenabled = 'O'`), raising and rolling back if not;
   - restores the cadence to version 2 active and version 3 scheduled, as before the window;
   - restores the notification configuration exactly;
   - sets Homewood `timeclock_enabled = false`;
   - resets `timeclock_credentials.failed_attempts` and `locked_until` and the device failure and throttle columns;
   - keeps `timeclock_devices`, `timeclock_credentials`, `staff` and user rows;
   - leaves `col695-homewood-timeclock-on` scheduled;
   - ends with a verification SELECT that shows 0 window rows in every inventory table.
4. The window is scoped by facility plus the window start, never by facility alone. Rows without a facility column are reached only through their parent rows. Uploaded files (for example incident photos in Storage) are deleted with their rows.
5. A local proof on a local Supabase stack runs in the transcript and prints `[LOCAL PROOF]` with a per-table before and after table:
   - `supabase start`, all migrations applied;
   - a seeded Homewood-like facility with pre-window rows in every inventory table;
   - the open script, then test activity driven through the real functions (punch, visitor sign-in and sign-out, floor unlock and switch, chart a check, a missed check that escalates, a Something happened report with a photo, a handoff);
   - then the wipe.

   The table must show 100% of window rows removed, 0 pre-window rows removed, every guard trigger enabled, cadence and notification settings equal to their pre-open values, and the cron job untouched.
6. A pgTAP file `supabase/tests/review_homewood_test_window.sql` encodes the checks from criterion 5 and passes.
7. `npm run typecheck`, `npm run lint`, `npm run test` and `npm run migrations:check` exit 0 with output visible in the transcript.
8. `docs/operations/homewood-test-window.md` exists. It contains:
   - the runbook: when and how Brian runs each script, a backup check before the wipe, and making sure every iPad's unsent queue is empty before the wipe;
   - the full `TEST-PLAN.md` checklist;
   - a note to tell Charlene that test alerts in Haven are expected until Sept 30.
9. The work is committed on the branch, a PR is open against `main` that links COL-849, and the PR is not merged.
10. `[GOAL COMPLETE]` is output in the final turn.

If any criterion fails, the goal is not met. Continue working.

---

## Binding rules: never violate

- Never run either script, or any write, against production `manfqmasfqppukpobpld`. Read-only SELECTs on production are allowed for discovery. Brian runs the scripts.
- Never touch staging `iwcnajanvjvynolltflw` or Front Office `wecsjfiituxlityaacba`.
- No new migrations unless the local proof shows a script cannot be done without one. If one is needed, claim its number with `npm run migrations:next` and explain why in the PR.
- Disable guard triggers only by name, only inside the wipe transaction, and never with `session_replication_role`, so audit triggers keep firing.
- Never delete or change a pre-window row, a row at another facility, or a Homewood resident, staff, user, device or credential row.
- Never print secrets, service-role keys, PINs or PIN hashes.
- Do not touch the COL-677 worktree or PR #814's branch.
- Follow the repo's SQL style in the existing `scripts/floor/*.sql`. No `any` types in any TypeScript touched.
- American spelling; no em dashes in docs or comments.

## Autonomy

Decide on your own:

- the scope column per table;
- the delete order;
- how to store and restore the prior notification configuration (prefer an existing settings or audit mechanism over a new table);
- the local seed data;
- the pgTAP structure;
- the runbook wording.

Surface and pause only for:

- a table the flows write that cannot be tied to the window by any column or parent;
- a cadence or notification mechanism that cannot be reversed exactly;
- any payroll export, timesheet approval or outside submission that already read Homewood punches from the window on production.

Do not pause for style choices, test fixture details or naming.

## Commit cadence

Commit at the end of each unit:

```
COL-849 unit N: {name}

- {what shipped, one line each}
```

Units: 1 write inventory, 2 open script, 3 wipe script, 4 local proof and pgTAP, 5 runbook and PR. Never commit a failing check.

## Progress reporting

After each unit, output:

```
[SPRINT N COMPLETE]

Shipped:
- {bullets}

Verified:
- {bullets}

Next: {unit N+1}
```

On a blocker:

```
[BLOCKED: unit N]

Blocker: {description}
Tried: {what you attempted}
Need: {specific decision}
```

## Quality bar

This is the one time Haven deliberately deletes append-only clinical and payroll rows. Brian must be able to read the dry run and know exactly what will go, and the verification must prove nothing real went with it. If at any point a delete depends on "probably test data" rather than a provable window scope, stop and surface it. That signal matters more than finishing on time.

## Final completion gate

1. Run the full local proof again from `supabase start` and print `[LOCAL PROOF]`.
2. Run the pgTAP file.
3. `npm run typecheck`, `npm run lint`, `npm run test`, `npm run migrations:check`.
4. Read both scripts top to bottom against the inventory table and the criteria. Mark each of criteria 1 to 9 PASS or FAIL in the transcript.
5. Open the PR.

When all pass, output:

```
[GOAL COMPLETE]

COL-849: Homewood test window scripts, runbook and local proof on branch blewis/col-849-homewood-test-window-full-floor-and-kiosk-testing-on, PR {number}.
Brian runs scripts/floor/homewood-test-window-open.sql now and scripts/floor/homewood-test-window-wipe.sql on the evening of Sept 30 (dry run first).
```

Then stop.
