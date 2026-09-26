# Module 40: Shared Floor Tablets and Front-Door Kiosk (COL-677)

Med techs share iPads on the floor for Smart Rounding, Something happened reports, tasks and handoff. A floor tablet belongs to the building, not a person: it lists only the staff clocked in right now at the front-door kiosk, and each person unlocks it by tapping their name and entering the same 6-digit PIN they punch with. The front-door kiosk is the same iPad model in a locked enclosure: staff clock in and out there, and visitors, healthcare providers, vendors and inspectors sign the AHCA visitor log there.

Mission alignment: pass. Every entry made on a shared tablet is attributed to the person who unlocked it, the unlock ledger is append-only, nothing clinical stays on the device after it locks, and nothing here touches medication administration, which stays in the eMAR software.

**Linear:** COL-677 (parent). Children: COL-690 identity and unlock, COL-691 floor app, COL-692 kiosk, COL-693 rounding owner from punches, COL-694 verification, COL-695 Homewood setup (operating work; this build ships its scripts). Related: COL-352 and spec 37 (timeclock), COL-353 and spec 38 (visitor log), COL-450 and COL-169 (delivered by COL-692), COL-634 (Homewood backlog), COL-19 (devices). Superseded: COL-668 (canceled; its PR #728 is not merged into this work).
**Design contract:** `docs/designs/floor-tablet-kiosk/DESIGN.md`, reference renders in `docs/designs/floor-tablet-kiosk/reference/`, prototype canvas "Haven Floor Tablet and Kiosk Prototype" (https://claude.ai/artifact/YFqHhqWW3sUbs5vHjYGGwr, Brian's account).
**Migrations:** claim numbers with `npm run migrations:next`. Head on `main` was `473` on 2026-09-23 and open PR #728 claims `476`; never hardcode a number from this spec.
Migration numbers for this build are 494 (floor tablets and kiosk) and 495 (rounding owner from punches). Numbers move quickly on this repo: this branch moved twice (481, then 483) because other branches were applied to production first. Numbers applied to production before their files reached main are listed in ALLOWED_GAPS in scripts/check-migration-order.mjs until those files merge. Recheck `npm run migrations:next` before merging.
**Routes:** `/floor/setup`, `/floor/lock`, `/floor`, `/floor/rounds`, `/floor/residents`, `/floor/residents/[id]`, `/floor/check/[taskId]`, `/floor/report`, `/floor/report/[careEventId]`, `/floor/handoff`; `/kiosk`, `/kiosk/setup`, `/kiosk/staff`, `/kiosk/sign-in/[kind]`, `/kiosk/leaving`; `/kiosk/timeclock` redirects to `/kiosk/staff`. API under `/api/floor/*` and `/api/kiosk/visitor/*`.

---

## 1. Decisions (settled, do not reopen)

| Topic | Decision |
|---|---|
| What the tablets do | Smart Rounding, Something happened, assigned tasks, resident context, handoff. Never medication administration, eMAR, controlled counts or med passes. |
| Homewood devices | Four iPads (A16): HL-FLOOR-01 and HL-FLOOR-02 for the two med techs on shift, HL-FLOOR-03 as a spare with the same setup, HL-KIOSK-01 at the front door. No kitchen tablet. |
| Identity on a floor tablet | Tap your name on the on-shift roster, then your timeclock PIN (6 digits). No username, password or iPad passcode. |
| Roster source | Timeclock punches: `haven.timeclock_state(staff_id, now())` is `in` or on meal at the device's facility. The schedule is never the roster. |
| Roster roles | Per device `roster_roles`, falling back to the facility setting `floor_roster_roles` (default `med_tech`, `facility_admin`). Runtime configuration, not code. |
| PIN and lockouts | The existing `timeclock_credentials.pin_hash`. Same lockouts as the kiosk: 5 misses locks that credential for 15 minutes; 20 misses on one device in 10 minutes throttles the device for 5 minutes. One implementation shared with `haven.timeclock_resolve`, not a copy. |
| Session | On a verified unlock the server mints a Supabase session for the staff member's auth user: service-role `auth.admin.generateLink({ type: 'magiclink', email })`, then `verifyOtp({ type: 'email', token_hash })` in the SSR client so the session cookies land on the route response. No email is sent. Tokens never touch `localStorage`. |
| Lock | Screen hidden (`visibilitychange`), idle `floor_idle_lock_minutes` (facility setting, default 3), the Switch button, a 60-second heartbeat that finds the person off the clock or the device revoked, and a 12-hour hard cap. Lock ends the unlock row, runs `signOut({ scope: 'local' })`, clears the query cache and returns to `/floor/lock`. |
| Not on the roster | "Not listed? Use employee number" accepts employee number plus PIN and records the unlock with `on_clock = false`; the timesheet shows an `unlock_without_punch` exception for the manager. Covers a kiosk that was offline. |
| Offline entries | Rounding and care-event queue items carry the `unlock_id` they were captured under. A device-token replay path writes them as their owner even after someone else unlocks the tablet. |
| Tablet home | `med_tech` lands on `/floor`. `/med-tech` leaves the `med_tech` navigation; the route stays for admins until a later retirement. |
| One clock | Where `timeclock_enabled` is on, `/caregiver/clock` shows "Clock in at the front door" and writes nothing to `time_records`. |
| Kiosk entries | Staff, Visiting a resident, Healthcare provider, Vendor or contractor, Inspector or official, and Leaving. No resident picker at the door: the visitor types the name and the front desk matches it. Sign-out lists names only after 3 letters. |
| Inspector | Signs in at the kiosk as `surveyor_regulator`; the administrator's Home shows a banner while that visit is open. |
| Rounding owner | When a shift has no `shift_assignments`, unowned upcoming checks go to on-clock staff by the existing stable hash. Already-assigned checks never reshuffle. |
| Look | The prototype is the visual contract. `DESIGN.md` lists the only allowed departures (house fonts, no monospace or all-caps labels, semantic tokens). |

## 2. What exists and is reused (discovery, 2026-09-23)

- **Timeclock (spec 37, migration 408):** `timeclock_devices`, `timeclock_enrollment_codes`, `timeclock_credentials`, `time_punches`, `time_punch_corrections`, `timeclock_sync_rejections`, `timeclock_facility_settings`, `timeclock_organization_settings`; `public.timeclock_create_enrollment_code`, `timeclock_enroll_device`, `timeclock_identify`, `timeclock_record_punch`, `timeclock_list_devices`, `timeclock_revoke_device`, `timeclock_set_credentials`, `timeclock_credential_status`, `timeclock_unlock_credential`; `haven.timeclock_resolve`, `timeclock_state`, `timeclock_assigned_to_facility`, `timeclock_audit`, `timeclock_note_device_failure`. Kiosk code: `src/app/kiosk/timeclock/page.tsx`, `src/components/timeclock/TimeclockKiosk.tsx`, `src/lib/timeclock/{kiosk-contract,kiosk-store,server,compute}.ts`, `/api/kiosk/timeclock/{enroll,identify,punch}`. Device header constant `KIOSK_DEVICE_HEADER`.
- **Visitor log (spec 38, migrations 294 and 412):** `visitor_log_entries` (no client UPDATE or DELETE policy; keep it that way), `public.visitor_log`, `visitor_log_open`, `visitor_sign_out`, `visitor_sign_out_all_open`, `visitor_void`, `haven.visitor_audit`, `haven.visitor_left_open_threshold`. `visitor_type` values include `family_friend`, `healthcare_provider`, `vendor_contractor`, `surveyor_regulator`.
- **Smart Rounding:** `resident_observation_tasks`, `resident_observation_logs`, `resident_observation_assignments`, `haven.complete_rounding_task_core` (lets `med_tech` and admins complete unassigned checks), `public.resolve_observation_task_assignees` (migration 423: `resident_split`, then `shift_roster`, else `none_scheduled`), `public.record_observation_staffing_gap`, Edge Function `observation-task-generator` (every 15 minutes), `src/components/rounding/RoundingTaskCard.tsx`, `src/hooks/useRoundingOfflineSync.ts`, `src/lib/pwa/rounding-sync.ts` (queue items carry `ownerUserId` and replay only for that signed-in owner).
- **Something happened (spec 07A):** `src/lib/care-events/tiles.ts` (eight tiles and their questions), `src/components/care-events/CareEventReportFlow.tsx`, `src/lib/offline/care-event-queue.ts` (IndexedDB, `ownerUserId`), `/caregiver/report`.
- **Roles:** `src/lib/auth/app-role.ts`, `src/lib/auth/dashboard-routing.ts` (`med_tech` route `/med-tech`), migration 468 role consolidation, `src/proxy.ts` shell gating.
- **Production at Homewood on 2026-09-23:** 34 active residents; 20 staff (3 administrator, 3 assistant administrator, 14 floor); the 14 floor accounts carry `app_metadata.app_role = caregiver` and have no `user_profiles` row; timeclock flag off, 0 devices, 0 credentials; 807 checks in 7 days, 0 assigned, 634 missed, 1,902 open escalations.

## 3. Data model

All new objects follow the timeclock rules: RLS on, `organization_id` first in every policy, facility scope through `haven.accessible_facility_ids()`, definer functions with `SET search_path = public, extensions`, metadata-only audit rows through `haven.timeclock_audit`, text plus CHECK instead of new enums.

```sql
alter table public.timeclock_devices
  add column device_kind text not null default 'kiosk' check (device_kind in ('kiosk','floor')),
  add column roster_roles text[] null;                 -- null: use the facility default

alter table public.timeclock_enrollment_codes
  add column device_kind text not null default 'kiosk' check (device_kind in ('kiosk','floor'));

alter table public.timeclock_facility_settings
  add column floor_idle_lock_minutes integer not null default 3 check (floor_idle_lock_minutes between 1 and 30),
  add column floor_roster_roles text[] not null default array['med_tech','facility_admin'];

create table public.floor_unlocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  facility_id uuid not null references public.facilities(id),
  device_id uuid not null references public.timeclock_devices(id),
  staff_id uuid not null references public.staff(id),
  user_id uuid not null references public.user_profiles(id),
  method text not null check (method in ('roster','employee_number')),
  on_clock boolean not null,
  started_at timestamptz not null default clock_timestamp(),
  ended_at timestamptz null,
  end_reason text null check (end_reason in ('sleep','idle','switch','clocked_out','device_revoked','max_age','new_unlock')),
  check ((ended_at is null) = (end_reason is null))
);
create index on public.floor_unlocks (device_id, started_at desc);
create index on public.floor_unlocks (facility_id, staff_id, started_at desc);

alter table public.visitor_log_entries
  add column kiosk_device_id uuid null references public.timeclock_devices(id),
  add column visitor_company text null check (visitor_company is null or char_length(btrim(visitor_company)) between 1 and 120),
  add column visiting_name_text text null check (visiting_name_text is null or char_length(btrim(visiting_name_text)) between 1 and 120),
  add column kiosk_client_entry_id uuid null;
-- sign_out_method gains 'kiosk_self'; unique (kiosk_device_id, kiosk_client_entry_id) makes kiosk sign-in idempotent.
```

`floor_unlocks` is insert plus one end: a guard trigger refuses every UPDATE except setting `ended_at` and `end_reason` from null, and refuses every DELETE for every role. Managers read it for their facilities; staff read their own rows; no client writes.

Functions (definer unless noted):

- `timeclock_create_enrollment_code(p_facility_id, p_device_kind default 'kiosk')` and `timeclock_enroll_device` carry the kind onto the device. `timeclock_list_devices` returns `device_kind`.
- `floor_roster(p_device_token text) returns jsonb`: device valid, not revoked, `device_kind = 'floor'`, facility `timeclock_enabled`. Returns `[{staff_id, display_name ("Ashley W."), initials, role_label, clocked_in_at, last_on_this_device}]` for active or on-leave staff with a login whose app role is in the device's roster roles, assigned to the facility, and on the clock. Ordered by last unlock on this device, then clock-in time. Returns nobody else.
- `floor_verify_unlock(p_device_token text, p_staff_id uuid, p_employee_number text, p_pin text) returns jsonb`: exactly one of staff id or employee number. Verifies the PIN through the shared lockout and throttle code. Refuses staff without a login and `user_profiles` row (`no_login`) or outside the roster roles (`not_allowed`). Ends any open unlock on the device with `new_unlock`, inserts the new row, and returns `{ok, unlock_id, user_id, email, on_clock, idle_lock_minutes}` or `{ok:false, error}` with `error` in `not_recognized | locked | device_throttled | device_unknown | not_allowed | no_login | facility_off`.
- `floor_heartbeat(p_device_token text, p_unlock_id uuid) returns jsonb`: `{active, reason}`; inactive when the unlock is ended, the device is revoked, the unlock is older than 12 hours, or a roster unlock's staff member is off the clock (ends the row with the matching reason).
- `floor_end_unlock(p_device_token text, p_unlock_id uuid, p_reason text)`.
- `floor_unlock_for_replay(p_device_token text, p_unlock_id uuid, p_owner_user_id uuid, p_captured_at timestamptz) returns jsonb` (service role only): the unlock belongs to that owner and device and `p_captured_at` falls between `started_at` and `coalesce(ended_at, now())`.
- `visitor_kiosk_sign_in(p_device_token, p_client_entry_id, p_visitor_type, p_visitor_name, p_visitor_phone, p_visitor_company, p_visiting_name_text, p_purpose, p_symptoms_reported)`: device kind `kiosk`; idempotent on the client entry id; `symptoms_reported = true` sets `screening_passed = false`; company or agency required for `healthcare_provider`, `vendor_contractor`, `surveyor_regulator`.
- `visitor_kiosk_open_matches(p_device_token, p_prefix)`: open entries at the device's facility whose visitor name starts with the prefix, only when the prefix has 3 or more letters, at most 5 rows, returning entry id, first name plus last initial, type label and time in.
- `visitor_kiosk_sign_out(p_device_token, p_entry_id)`: same guarded path as `visitor_sign_out`, `sign_out_method = 'kiosk_self'`.
- `visitor_match_resident(p_entry_id, p_resident_id)` for front-desk staff: sets `resident_id` and `visiting_type = 'resident'` on a kiosk entry whose resident was typed.

## 4. API contracts

All routes answer `Cache-Control: no-store`, read the device token from `KIOSK_DEVICE_HEADER`, call the database through the service-role client, map database errors through `kioskErrorResponse`, and never render raw error text.

| Route | Body | Returns |
|---|---|---|
| `POST /api/floor/enroll` | `{code, label}` | device token for IndexedDB (reuses the kiosk enroll path with kind check) |
| `GET /api/floor/roster` | | roster rows |
| `POST /api/floor/unlock` | `{staff_id, pin}` or `{employee_number, pin}` | `{unlock_id, idle_lock_minutes, display_name}` plus session cookies |
| `POST /api/floor/lock` | `{unlock_id, reason}` | 204; ends the unlock and signs out locally |
| `GET /api/floor/heartbeat?unlock_id=` | | `{active, reason}` |
| `POST /api/floor/replay` | queued item with `unlock_id`, owner, capture time | per item `{status}`; writes as the owner through the existing rounding and care-event service paths |
| `POST /api/kiosk/visitor/sign-in` | kiosk form | `{entry_id, checked_in_at}` |
| `GET /api/kiosk/visitor/open?prefix=` | | up to 5 matches |
| `POST /api/kiosk/visitor/sign-out` | `{entry_id}` | `{checked_out_at}` |

Replay: read how `src/lib/pwa/rounding-sync.ts` and `src/lib/offline/care-event-queue.ts` replay today and how `haven.assert_rounding_service_actor` validates a service actor. Device replay authenticates with `floor_unlock_for_replay` instead of a live session and then calls the same core functions as the owner. It never widens what the owner could have written while signed in.

## 5. Security rules

- The device token is the only secret on the tablet; it lives in IndexedDB inside the home-screen web app, stored server side only as a SHA-256 hash. Revoking a device stops roster, unlock, heartbeat and replay on the next call.
- A floor session is an ordinary Haven session for that person: RLS, role gates and audit behave exactly as if they had signed in on a PC.
- `/floor/*` and `/kiosk/*` send `Cache-Control: no-store`; the floor query cache is memory only and cleared on lock; only the rounding and care-event offline queues persist, and they clear on sync.
- Rate limits live in the database (lockouts and throttles), as spec 37 established.
- No resident name renders anywhere on `/kiosk`, and the kiosk never lists open visits before 3 letters.

## 6. Floor app

Route group `src/app/(floor)/floor/` outside the admin shell, forced dark like `MedTechShell`, gated in `src/proxy.ts`: `/floor/setup` and `/floor/lock` need a device token and no session; everything else needs a session whose role is in the device's roster roles. Manifest `public/floor.webmanifest` (`display: standalone`, `start_url: /floor`, `orientation: any`) with an apple-touch-icon and `apple-mobile-web-app-capable`; enrollment calls `navigator.storage.persist()`.

Screens (layout, sizes and copy in `DESIGN.md`; reference renders in parentheses):

1. **Lock, "Who's on shift?"** (`01`): roster tiles, last person first, amber "n unsent" badge from the local queue, "Not listed? Use employee number", lock rules line.
2. **PIN** (`02`, `02b`): selected person, 6 dots, custom keypad (no system keyboard), Unlock appears at 6 digits; errors in operator words ("That PIN did not match. 3 tries left.", "Locked for 15 minutes. Ask the administrator.").
3. **Now, Tier 1** (`03`): due and overdue checks for the facility in time order, then the signed-in person's assigned tasks; each row is room, resident, check, due time, status, one Done action; counts line; residents rail with status dots (alert, watch, hold, stable derived from open escalations, watchlist and `resident_status`); "Something happened"; my-shift strip (clock-in, rounds charted, reports filed, handoff read, handoff time).
4. **Resident, Tier 2** (`04`): header with status; recent checks (what is over or due and the next check, then the last 24 hours charted, newest first, at most 8, with who charted each; checks before midnight say "Yesterday"); watch and follow-ups (visitors signed in for this resident now, active watches, open escalations, the newest handoff note about them from the last 7 days); know-before-you-go-in (the same instruction fields the caregiver resident hub shows, led by any safety field not recorded yet: allergies not reviewed, diet, fall risk, assistive device, code status, shown as a warning and never as "none"; COL-865); actions Chart this check, Something happened, Full record (Tier 3, existing resident timeline). The Residents list shows, for a resident with nothing flagged, when they were last checked or "No check in 24 hours", and "Visitor here". The lock screen asks for the roster every 15 seconds and again when the tablet wakes or is touched. The facility's check choices are kept on the tablet (floor IndexedDB, building configuration only) so the first check after an unlock can be charted offline.
5. **Chart a check** (`05`): the rounding completion payload as chips: quick status (`awake, asleep, calm, agitated, confused, distressed, not_found, refused`), location (from `observation_vocab`), what they are doing (`observation_vocab` state) and meals, mood and medications chips (`meal_intake`, `mood_state`, `med_response`, at least one; `haven.require_observation_capture` refuses a Smart Rounding check without location, state and a chip, and the payload carries `captureSurface: "floor"` so the route and the device replay both write it through `complete_rounding_task_review` with the flat answers), helped with (`toileting_assisted, hydration_offered, repositioned`), anything wrong (`pain_concern, breathing_concern, skin_concern_observed, fall_hazard_observed, refused_assistance`), late reason required when over, note optional. Save goes through the existing completion path and the offline queue.
6. **Something happened** (`06`, `07`, `07b`): who (recent residents plus search), what (the eight tiles from `tiles.ts`), one question per screen, receipt. Same data and level engine as `/caregiver/report`; `/floor/report` renders it in the tablet layout.
7. **Rounds** and **Handoff** tabs: the existing rounding queue and shift handoff data in the same shell (no reference render; follow the Now and Resident patterns).

Every data surface renders exactly one of `idle | loading | error | success-empty | success-populated` with operator copy.

## 7. Front-door kiosk

Routes under `src/app/kiosk/` (no session), forced light. `/kiosk/setup` enrolls a kiosk-kind device; `/kiosk` is home (`10`); `/kiosk/staff` opens on a name picker (migration 552, `timeclock_kiosk_roster`: credentialed, current staff of the kiosk's building, name only, cached on the tablet for offline use, refreshed every 5 minutes): tap your name, enter your PIN (`timeclock_identify` / `timeclock_record_punch` with `p_staff_id`; the offline queue stores `staffId`, and the PIN stays in page memory exactly as on the number path). "Use employee number" opens the original punch flow (`11`, `11b`); both continue into `12` and `13`, keeping the one-valid-action rule. Only the name path shows tries left; the clock-in confirmation says the name is now on the floor tablets; `/kiosk/sign-in/visitor`, `/provider`, `/vendor`, `/inspector` share one form layout (`14`, `14b`, `15`) with the fields per type below; confirmation (`16`); `/kiosk/leaving` (`17`, `17b`). Any kiosk screen returns home after 30 seconds without input; confirmations return home after 5 seconds.

| Entry | Fields | `visitor_type` |
|---|---|---|
| Visiting a resident | name, phone (optional), resident you are seeing (picked, or typed behind "Not listed?"; required), feeling sick today | `family_friend` |
| Healthcare provider | name, agency or practice (required), resident you are seeing (picked or typed, optional), feeling sick today | `healthcare_provider` |
| Vendor or contractor | name, company (required), purpose | `vendor_contractor` |
| Inspector or official | name, agency (required) | `surveyor_regulator` |

"Yes" to feeling sick records the entry with `screening_passed = false` and shows "Please see the front desk before you go in." The administrator Home gets a banner while a `surveyor_regulator` visit is open at that facility. The resident field is a type-ahead (`visitor_kiosk_resident_matches`, migration 551): nothing before 3 letters, at most 6 current residents of the kiosk's building as first name, last initial and room; a pick is stored as `resident_id` with `visiting_type = 'resident'`. "Not listed? Type their name" records `visiting_name_text` instead, and the staff visitor log shows that typed name with a Match resident action (`visitor_match_resident`).

## 8. Smart Rounding owner from punches

`resolve_observation_task_assignees` gains a third source `on_clock` after `resident_split` and `shift_roster`: staff whose `haven.timeclock_state` is on the clock at that facility and whose role can record observations, chosen by the existing stable hash so a re-run picks the same person. Each `observation-task-generator` run also assigns still-unowned checks that are not yet due to on-clock staff. Already-assigned checks never change owner. `record_observation_staffing_gap` counts on-clock staff as staffed. Any med tech on shift can still complete any check (unchanged).

## 9. Homewood setup (scripts shipped by the build, run by Brian)

Hosted-SQL scripts under `scripts/floor/`, each with a dry-run SELECT section that prints counts first and a transaction that applies. The build never runs them against `manfqmasfqppukpobpld`.

1. `homewood-pause-cadence.sql`: no Smart Rounding cadence in force at Homewood until Oct 1 day shift start, through the existing cadence version mechanism.
2. `homewood-clear-pre-go-live.sql`: excuse checks due before go-live that are missed or upcoming, and close open escalations with reason `before go-live`.
3. `fix-stale-app-roles.sql`: the 14 Homewood `caregiver` claim accounts get `user_profiles` rows and `med_tech`; the one `nurse` and one `dietary` account org-wide follow migration 468's mapping; uses the same claim path migration 468 used.

Also update `docs/operations/timeclock-kiosk-lockdown.md` for both device kinds (floor web clip `/floor`, no iPad passcode, Auto-Lock 5 minutes; kiosk web clip `/kiosk`, Auto-Lock never) and `docs/homewood/timeclock-cutover.md` for the floor roster dependency.

## 10. Acceptance

1. A synthetic med tech punched in on a kiosk-kind device appears on a floor-kind device's roster, unlocks with PIN, lands on `/floor`, and is locked on the next heartbeat after punching out.
2. pgTAP (`supabase/tests/review_floor_tablet_kiosk.sql`): the roster never lists an off-clock person, another facility's staff, a terminated person or a role outside the roster roles; 5 bad PINs lock the credential; 20 bad PINs throttle the device; a revoked or foreign device token is refused; `floor_unlocks` refuses updates other than the single end and refuses deletes; replay refuses another person's unlock id, another device, and a capture time outside the unlock.
3. Playwright project `floor-kiosk` (iPad 1180x820 and 820x1180): lock, unlock, chart a check, file a fall report, Switch; the second person sees only their own session and the charted check carries the first person's name.
4. An offline check charted by A replays after B unlocks the same tablet and is attributed to A.
5. Kiosk: visitor sign-in completes in under 30 seconds in Playwright; the row shows in the staff visitor log and the AHCA print pack; `/kiosk` renders no resident name; sign-out shows nothing before 3 letters; an inspector sign-in raises the Home banner.
6. Rounding: with no `shift_assignments`, a check due after a med tech clocks in is assigned to an on-clock med tech within one generator run, a missed check names that person, and a re-run changes no assigned owner.
7. `med_tech` lands on `/floor`; `/caregiver/clock` writes nothing where timeclock is on.
8. Design fidelity gate in `DESIGN.md` passes for every reference render.
9. `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, `npm run migrations:check` exit 0; `npm run migrations:verify:pg` replays clean.

## 11. Out of scope

Medication administration and eMAR; controlled counts; badge readers (a USB-C keyboard-wedge reader already works with the kiosk field later); biometrics; scheduling (WhenToWork stays); a kitchen tablet; a native iOS app; ADP submission (COL-357).

## 12. Open items that do not block this build

- D1 to D7 for care-event routing at Homewood (COL-456 to COL-462, Jessica): the report flow ships with the existing defaults.
- COL-428 pay rules: only the payroll export waits on them.
