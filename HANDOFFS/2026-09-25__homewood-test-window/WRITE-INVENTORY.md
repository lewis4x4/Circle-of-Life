# COL-849 write inventory: what the Homewood test window can create

Built 2026-09-25 from the code (`src/app/(floor)`, `src/app/kiosk`, `/api/floor/*`, `/api/kiosk/*`, `src/lib/{timeclock,floor,care-events,pwa}`, the `observation-task-generator`, `observation-escalation-engine`, `care-event-dispatcher`, `watchlist-signal-engine` and `risk-nightly-scorer` Edge Functions) and from the database (every function those paths call, every non-internal trigger on the tables they write, every table those triggers write, every foreign key into those tables), on a native replay of migrations 001 to 549. Trigger names were checked against production (`manfqmasfqppukpobpld`, read only).

Terms: **HW** is `facility_id = '00000000-0000-0000-0002-000000000003'`. **ws** is the window start `2026-09-25 20:24:02.307103+00`. Every scope column below is stamped by the server (`now()` or `clock_timestamp()` defaults, or `v_now` inside a definer function); no writer passes a client time into it. Rows without a facility column are reached only through their parent rows.

## Deleted by the wipe (children first)

The numbers are the wipe's delete order (`col849_counts.ord` in `scripts/floor/homewood-test-window-wipe.sql`).

| # | Table | How the test writes it | Window scope | Guard triggers disabled for the delete |
|---|---|---|---|---|
| 1 | `observation_escalation_deliveries` | `record_observation_escalation_rung` queues a row per recipient and channel; the engine claims them and records outcomes | HW and `created_at >= ws` | none |
| 2 | `observation_escalation_dispatches` | `record_observation_escalation_rung` (one per task and rung) | HW and `created_at >= ws` | none |
| 3 | `resident_observation_escalations` | `record_observation_escalation_rung` for the non-nudge rungs | HW and `created_at >= ws` | none |
| 4 | `watchlist_signal_notifications` | `haven.notify_watchlist_acute` (watchlist engine, hourly) | HW and `created_at >= ws` | none |
| 5 | `watchlist_signal_dispositions` | `haven.record_watchlist_disposition` trigger on every signal insert and status change | HW and `created_at >= ws` | none |
| 6 | `resident_monitoring_order_notifications` | `haven.notify_monitoring_order_created` when an order is placed | HW and `created_at >= ws` | none |
| 7 | `care_event_deliveries` | `submit_care_event` step 0 and `care_event_escalation_tick` later steps; the dispatcher updates them | HW and `created_at >= ws` | none |
| 8 | `exec_alert_user_state` | an administrator acknowledges, snoozes or dismisses a test alert | parent `exec_alerts` row in set 10 | none |
| 9 | `exec_actions` | an administrator opens an action on a test alert | parent `exec_alerts` row in set 10 | none |
| 10 | `exec_alerts` | four producers only: rung alerts (`record_observation_escalation_rung`, title ends `: observation window at <facility>`), staffing gaps (`record_observation_staffing_gap`, title `Nobody is scheduled for the ... at <facility> on ...`), care events (`submit_care_event`, `deep_link_path = /admin/care-events/<care event in set 28>`), Smart Rounding notices (`claim_smart_rounding_notifications`, category `smart_rounding`, `id` = a watchlist instance in set 20, a monitoring order in set 19, or the order of a notice in set 6) | HW and `created_at >= ws` and one of the four producers | none |
| 11 | `resident_watch_events` | `auto_trigger_watch_protocol` on a new incident; task and log links | HW and `created_at >= ws` | none |
| 12 | `resident_observation_exceptions` | `haven.complete_rounding_task_core` (anything-wrong chips) | HW and `created_at >= ws` | none |
| 13 | `resident_observation_integrity_flags` | `complete_rounding_task_review` (late entries, patterns) | HW and `created_at >= ws` | none |
| 14 | `rounding_completion_receipts` | `complete_rounding_task_review` | HW and `created_at >= ws` | `tr_rounding_completion_receipts_immutable` |
| 15 | `resident_observation_assignments` | `record_cadence_observation_tasks`, `assign_unowned_observation_tasks`, `claim_observation_task`, `generate_monitoring_order_tasks` | HW and `created_at >= ws` | none |
| 16, 17 | `resident_observation_tasks`, `resident_observation_logs` (one statement: they reference each other) | the generator under the test cadence and for monitoring orders; lapse and rung updates; charting inserts the log and completes the task | HW and `created_at >= ws` | `tr_rounding_task_write_guard`, `tr_rounding_logs_immutable` |
| 18 | `resident_monitoring_order_events` | `haven.record_monitoring_order_event` trigger on the order | `monitoring_order_id` in set 19 | none |
| 19 | `resident_monitoring_orders` | `haven.bridge_watch_instance_to_monitoring_order`: a test fall's watch instance places an order | HW and `created_at >= ws` and `source_watch_instance_id` in set 27 | none |
| 20 | `watchlist_signal_instances` | `evaluate_watchlist_signals` (watchlist engine) from window observations and care events | HW and `created_at >= ws` | none |
| 21 | `incident_photos` | `attach_care_event_file` after the upload to bucket `incident-photos` | `incident_id` in set 29 or `care_event_id` in set 28 | none |
| 22 | `incident_followups` | `submit_care_event`, witness tasks | `incident_id` in set 29 | none |
| 23 | `regulatory_reporting_obligations` | `care_event_create_ahca_obligations` | `incident_id` in set 29 | none |
| 24, 25 | `incident_rca`, `incident_root_causes` | an administrator works the test incident | `incident_id` in set 29 | none |
| 26 | `care_plan_review_alerts` | `care_plan_alert_on_incident` (falls, wandering, skin) and `care_plan_alert_on_condition_change` | `trigger_source_id` in set 29 or set 31 | none |
| 27 | `resident_watch_instances` | `auto_trigger_watch_protocol` trigger on a new incident | `triggered_by_type` in (`incident_fall`, `incident_elopement`, `incident_wandering`) and `triggered_by_id` in set 29 | none |
| 28 | `care_events` | `submit_care_event` (online, `/api/care-events/submit`, `floor_replay_submit_care_event`); note, file and acknowledge updates | HW and `created_at >= ws` | none |
| 29 | `incidents` | `submit_care_event` at level 2 and above | `id` = `care_events.incident_id` of set 28 | none |
| 30, 31 | `behavioral_logs`, `condition_changes` | `submit_care_event` for the behavior and condition tiles | `id` = `care_events.behavioral_log_id` / `condition_change_id` of set 28 | none |
| 32 | `shift_handoff_notes` | Handoff tab (`src/lib/floor/handoff-notes.ts`, direct insert and read receipt) | HW and `created_at >= ws` and `source_kind IS NULL` (admission notes carry a `source_kind` and are kept) | none |
| 33 | `shift_handoffs` | caregiver handoff surface | HW and `created_at >= ws` | none |
| 34 | `visitor_log_entries` | `visitor_kiosk_sign_in`, `visitor_kiosk_sign_out`, `visitor_match_resident` | HW and `created_at >= ws` and `kiosk_device_id IS NOT NULL` (staff-typed entries are kept) | none |
| 35 | `med_passes` | `haven.med_tech_shift_open_from_clock` on a kiosk clock-in | `shift_id` in set 38 | none |
| 36, 37 | `shift_tape_events`, `med_tech_shift_residents` | the same clock-in and clock-out triggers | `shift_id` in set 38 | none |
| 38 | `med_tech_shifts` | `tr_time_punches_med_tech_shift` on each punch; `assign_unowned_observation_tasks` | HW and `created_at >= ws` | none |
| 39 | `time_punch_corrections` | an administrator corrects a test punch on the timesheet | HW and `corrected_at >= ws` | `tr_time_punch_corrections_append_only` |
| 40 | `time_punches` | `timeclock_record_punch` (kiosk online and offline replay) | HW and `created_at >= ws` | `tr_time_punches_append_only` |
| 41 | `timeclock_sync_rejections` | `timeclock_record_punch` for a refused offline punch | HW and `created_at >= ws` | `tr_timeclock_sync_rejections_append_only` (not in the GOAL list; it is the same append-only guard and blocks the delete) |
| 42 | `floor_unlocks` | `floor_verify_unlock`, `floor_end_unlock`, `floor_heartbeat` | HW and `started_at >= ws` | `tr_floor_unlocks_guard` |
| Storage | bucket `incident-photos` | fall report photo upload (`src/lib/care-events/attachments.ts`, path `<org>/<facility>/<care event>/<uuid>.<ext>`) | objects under `<org>/<HW>/` with `created_at >= ws` | removed through the Storage API by `scripts/floor/homewood-test-window-photos.mjs` before the SQL wipe; the SQL wipe refuses while any remain |

Found by the local proof, not by reading the code: `care_plan_alert_on_condition_change` (a trigger on `condition_changes`), `haven.bridge_watch_instance_to_monitoring_order` (a test fall places a real monitoring order, which then generates checks and notices), and `triggered_by_type` values of `incident_fall` and friends rather than `incident`. Each is now in the sets above, and the proof asserts that the only Homewood rows left inside the window afterwards are the ones it deliberately made through other producers.

`tr_payroll_source_revision` (on `time_punches`, `time_punch_corrections`, `timeclock_sync_rejections`, `floor_unlocks`) fires on DELETE but does not block it: it bumps `haven.payroll_packet_source_revisions` so any payroll preview built from these punches is marked stale. It stays enabled on purpose.

## Written by the open script and undone by the wipe

| Table | What the open script does | What the wipe does |
|---|---|---|
| `timeclock_facility_settings` | `timeclock_enabled = true` (idempotent upsert) | `timeclock_enabled = false`; other columns as snapshotted |
| `facility_cadence_versions`, `facility_cadence_windows` | test version (windows copied from version 3) in force now through `haven.apply_observation_config_activation`, `effective_to = 2026-10-01 00:00+00`; an end version (no windows) scheduled at the same instant | deletes both versions and the test windows; version 2 back to `active` with the snapshotted columns; version 3 untouched and still `scheduled` |
| `facility_config_template_bindings` | the activation re-points the Homewood binding | restored to the snapshot |
| `notification_routes` | one Homewood route, `COL-849 test window: Brian only`, `user_targets = [Brian]` | deleted |
| delivery fence (`haven.col849_test_window_notification_fence` and one trigger each on `observation_escalation_deliveries`, `care_event_deliveries`, `watchlist_signal_notifications`, `resident_monitoring_order_notifications`) | a queued push, SMS, voice or email row at Homewood for anyone but Brian is written as `skipped` with `skip_reason = 'col849_test_window'`; in-app rows are untouched; the fence switches itself off at the Oct 1 go-live instant even if the wipe never runs | dropped |
| `incident_sequences` | test incidents consume Homewood numbers | `last_number` back to the snapshot when no kept Homewood incident was numbered in the window |
| `timeclock_credentials` | wrong PINs raise `failed_attempts` and `locked_until` | reset to 0 and null at Homewood; rows kept |
| `timeclock_devices` | failures and throttles | `failure_count`, `failure_window_started_at`, `throttled_until` and the three `visitor_*` twins reset; rows kept |

The snapshot of every one of these, plus all organization routes, escalation versions and rungs, care-event escalation policies and the cron job, is written once by the open script as an `audit_log` row (`table_name = 'homewood_test_window'`). The wipe restores from it and fails (rolls back) unless the result equals it.

## Kept, with the reason

| Table | Why it is kept |
|---|---|
| `audit_log` | immutable by design; the audit triggers stay on during the wipe so the trail records both the test and its removal |
| `auth.users`, `auth.sessions`, `auth.refresh_tokens`, `auth.one_time_tokens` | floor unlock mints an ordinary Supabase session for a real user; user rows must stay, sessions expire on their own |
| `timeclock_devices`, `timeclock_credentials`, `timeclock_enrollment_codes` | the four iPads and the PINs are the Oct 1 setup; enrollment codes are the single-use record of how the kept devices were enrolled |
| `staff`, `user_profiles`, `residents`, `user_facility_access` | never deleted or changed |
| `notification_subscriptions` | Brian's own push subscription, if he adds one, is his to keep |
| `haven.payroll_packet_source_revisions` | a counter; the bump is correct |
| `exec_alerts` at Homewood from other producers (for example the risk scorer), `risk_owner_alert_deliveries` | not produced by the floor or kiosk flows; the dry run counts them |
| `visitor_log_entries` typed by staff, `shift_handoff_notes` with a `source_kind`, `incidents` not raised by a care event | not produced by the floor or kiosk flows; the dry run counts them |
| `payroll_packets`, `payroll_packet_events` | not written by the flows; the wipe stops if any Homewood packet was created in the window, because it could have read test punches |

## Tables outside the set that can point at set rows

`emar_records`, `prn_events` and `witness_signatures` (to `med_passes`, `med_tech_shifts`), `insurance_claims` and `medication_errors` (to `incidents`), `resident_monitoring_orders` placed some other way (to `resident_watch_instances`), tasks of a kept order, `admission_arrival_reversals` (to `shift_handoff_notes`). None of these is part of the test plan. The wipe counts them in the dry run and stops before deleting anything if one exists, because deleting would need a decision about a record outside the test.
