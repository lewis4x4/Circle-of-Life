# Module 37: Timeclock (COL-352)

Haven takes over time and attendance at Homewood Lodge from the wall uPunch FN1000 clock and the uPunch Punch-to-Pay app. Staff clock in and out on a locked, facility bound tablet with a badge or employee number plus a six digit PIN. Managers review exceptions and approve corrections with a coded reason. Payroll gets a CSV. uPunch keeps running until a parallel run proves Haven matches it, so this module also ships the reconciliation screen and the cutover and tablet lockdown documents.

Mission alignment: pass. The ledger is append only, every manager change carries a reason on record, and nothing here decides pay; the ADP gate (COL-357) stays open.

**Linear:** COL-352 (this module), COL-357 (ADP submission, owns the payroll gate), COL-355 (access revocation on termination), COL-349 (offboard), COL-363 (staff profile edit surface).
**Migration:** `408_timeclock.sql` (404 to 406 landed on main from the Stand Up branches; 407 is reserved by COL-361). **Database probe:** `supabase/tests/review_timeclock.sql`.
**Routes:** `/kiosk/timeclock` (no session), `/admin/timeclock`, `/admin/timeclock/[staffId]`, `/admin/timeclock/compare`, staff profile `Timeclock access` section, facility settings `Timeclock` tab.

---

## 1. Decisions (settled, do not reopen)

| Topic | Decision |
|---|---|
| Punch identity | Badge number or employee number, then a 6 digit PIN. Badge readers are keyboard wedge devices that type into the focused input; no camera, NFC, or new dependency. |
| Credential storage | PIN stored only as a bcrypt hash (`crypt(value, gen_salt('bf', 10))`). Badge number stored only as an HMAC-SHA256 lookup key computed server side with `TIMECLOCK_BADGE_HMAC_SECRET`; the database never sees the badge number. |
| Punch types | `in`, `out`, `meal_start`, `meal_end`. The kiosk offers only the valid next action for the staff member's current state. |
| Punch time | Server time (`clock_timestamp()`) is the punch time when online. Device time is recorded alongside. A difference over 120 seconds flags `clock_skew`; it is never rejected. |
| Device binding | Owner or org_admin generates a one time 8 character enrollment code in admin, valid 15 minutes, bound to one facility. Enrollment returns a random device token stored as a SHA-256 hash in the database and in the tablet's IndexedDB. Every kiosk call carries the token. The kiosk has no user session. Revoking a device invalidates the token immediately. |
| Lockouts | 5 failed PIN attempts on one credential locks it for 15 minutes and writes an audit event. 20 failed attempts on one device within 10 minutes throttles that device for 5 minutes. |
| Offline | The kiosk queues punches in IndexedDB when the network is down, up to 24 hours, and replays them in order when back online. The server stores them with `captured_offline = true`, punch time = device time, flag `offline_capture`. The PIN for a queued punch lives only in page memory; a reload loses it and the punch is recorded as a sync rejection for the manager, not shown on the kiosk. |
| Workweek | Monday 00:00 to Sunday 23:59 America/New_York, the same week as Stand Up staffing (`stand_up_reports.week_start` is always a Monday). |
| Overtime | Minutes worked over 2,400 in that workweek. All durations are integer minutes. No rounding. |
| Meals | Unpaid. `meal_start` to `meal_end` is subtracted from worked time. |
| Pay period | Organization setting `timeclock_pay_period` (`weekly` or `biweekly`) plus `timeclock_pay_period_anchor` (a Monday). Null until set; the export button reads `Set the pay period to export` while null. |
| Corrections | Append only. Managers never edit a punch. They add a correction (`add_punch`, `void_punch`, `change_time`) or an acknowledgment (`acknowledge`) with a required coded reason and optional note. Reasons: `missed_punch`, `wrong_punch_type`, `device_outage`, `manager_verified_time`, `duplicate`. |
| Who manages | `owner`, `org_admin`, `facility_admin` for facilities they can access (the roles discovery (g) found on `staff`). Staff see only their own punches. |
| Rollout | Per facility flag `timeclock_enabled`, default false. Homewood Lodge is the only facility the cutover document addresses. No production rows are written by this build. |
| Out of scope | Photo capture, biometrics, geofencing, scheduling, PTO, ADP API submission (COL-357), Stand Up overtime prefill from timeclock (follow on), automatic access revocation on termination (COL-355). |

**TBD (record, do not decide here):** Workweek start, meal paid or unpaid, rounding, and pay period frequency must match ADP. TBD confirmation with Jessica Murphy and payroll before cutover.

---

## 2. Discovery facts the design rests on

- The staff entity is `public.staff` (migration 024). `staff.user_id` is nullable, so a person with no Haven login can hold timeclock credentials. Status is `employment_status` (`active`, `on_leave`, `terminated`, `suspended`) plus `deleted_at`. After COL-349 an offboarded person is `terminated` with `termination_date` set; the kiosk accepts only `active` and `on_leave` with `deleted_at IS NULL`.
- Facility membership for the kiosk is `staff.facility_id` (home) or a live `staff_facility_assignments` row (`end_date IS NULL AND deleted_at IS NULL`) for the device's facility.
- `time_records` (024) is the older interval model (clock_in/clock_out, numeric hours, mutable `approved` flag) that feeds `payroll_export_batches`. It is not a punch ledger. This module does not extend or write it. See §10 follow ons.
- No employee number, badge, or ADP file number column exists anywhere. `timeclock_credentials.employee_number` is the first.
- pgcrypto is in the `extensions` schema on hosted Supabase; definer functions here use `SET search_path = public, extensions` (the same path the local replay stub sets) and never `public.`-qualify an extension function.
- `audit_log` has no insert policy; definer functions insert directly with `new_data = jsonb_build_object('event', ...)` (migration 322 pattern). Rate limiting in the app is in-process only, so lockouts and throttles live in the database.
- Kiosk routes can be served without a session: `src/proxy.ts` matches an allowlist of shell prefixes that excludes `kiosk` and `api`; `scripts/check-admin-shell-routes.mjs` only walks `src/app/(admin)/`, so the kiosk page lives at `src/app/kiosk/timeclock/page.tsx`.
- Per-facility settings follow the COL-350 pattern: a dedicated table keyed by `(organization_id, facility_id)`, not a column on `facilities`.

---

## 3. Data model (timeclock migration)

All tables: RLS enabled, `organization_id` first in every policy, then `facility_id IN (SELECT haven.accessible_facility_ids())`. Manager roles are `('owner','org_admin','facility_admin')`.

### 3.1 Settings

```sql
create table public.timeclock_facility_settings (
  organization_id uuid not null references public.organizations(id),
  facility_id uuid not null references public.facilities(id),
  timeclock_enabled boolean not null default false,
  updated_by uuid null references public.user_profiles(id),
  updated_at timestamptz not null default now(),
  primary key (organization_id, facility_id)
);

create table public.timeclock_organization_settings (
  organization_id uuid primary key references public.organizations(id),
  timeclock_pay_period text null check (timeclock_pay_period in ('weekly','biweekly')),
  timeclock_pay_period_anchor date null check (timeclock_pay_period_anchor is null or extract(isodow from timeclock_pay_period_anchor) = 1),
  updated_by uuid null references public.user_profiles(id),
  updated_at timestamptz not null default now(),
  check ((timeclock_pay_period is null) = (timeclock_pay_period_anchor is null))
);
```

RLS: select for manager roles on accessible facilities (facility settings) or own organization (organization settings). Insert/update for `owner`, `org_admin` only. No delete.

### 3.2 Devices and enrollment

```sql
create table public.timeclock_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  facility_id uuid not null references public.facilities(id),
  label text not null check (char_length(label) between 1 and 60),
  token_hash text not null unique,
  enrolled_by uuid not null references public.user_profiles(id),
  enrolled_at timestamptz not null default now(),
  last_seen_at timestamptz null,
  revoked_at timestamptz null,
  revoked_by uuid null references public.user_profiles(id),
  failure_count integer not null default 0 check (failure_count >= 0),
  failure_window_started_at timestamptz null,
  throttled_until timestamptz null
);

create table public.timeclock_enrollment_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  facility_id uuid not null references public.facilities(id),
  code_hash text not null unique,
  created_by uuid not null references public.user_profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz null,
  used_by_device_id uuid null references public.timeclock_devices(id)
);
```

`token_hash` and `code_hash` are `encode(digest(value, 'sha256'), 'hex')`. Tokens are 32 random bytes; codes are 8 characters from an unambiguous alphabet (no `0/O`, `1/I/L`). Neither table is selectable by any client role; managers read devices through `timeclock_list_devices(p_facility_id)` which never returns `token_hash`.

### 3.3 Credentials

```sql
create table public.timeclock_credentials (
  organization_id uuid not null references public.organizations(id),
  staff_id uuid not null references public.staff(id),
  employee_number text not null check (employee_number ~ '^[A-Za-z0-9-]{1,20}$'),
  badge_lookup_hmac text null,
  pin_hash text not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz null,
  pin_set_by uuid not null references public.user_profiles(id),
  pin_set_at timestamptz not null default now(),
  badge_set_at timestamptz null,
  primary key (organization_id, staff_id),
  unique (organization_id, employee_number),
  unique (organization_id, badge_lookup_hmac)
);
```

Never selectable by any client role. Only definer functions read it. Managers see status (has PIN, has badge, employee number, locked) through `timeclock_credential_status(p_staff_id)`.

### 3.4 Punches, corrections, sync rejections

```sql
create table public.time_punches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  facility_id uuid not null references public.facilities(id),
  staff_id uuid not null references public.staff(id),
  punch_type text not null check (punch_type in ('in','out','meal_start','meal_end')),
  punched_at timestamptz not null,
  device_time timestamptz null,
  device_id uuid null references public.timeclock_devices(id),
  captured_offline boolean not null default false,
  client_punch_id uuid not null,
  flags text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (device_id, client_punch_id)
);
create index idx_time_punches_org_staff_punched_at on public.time_punches (organization_id, staff_id, punched_at);
create index idx_time_punches_facility_punched_at on public.time_punches (facility_id, punched_at);

create table public.time_punch_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  facility_id uuid not null references public.facilities(id),
  staff_id uuid not null references public.staff(id),
  correction_type text not null check (correction_type in ('add_punch','void_punch','change_time','acknowledge')),
  target_punch_id uuid null references public.time_punches(id),
  punch_type text null check (punch_type in ('in','out','meal_start','meal_end')),
  corrected_punched_at timestamptz null,
  exception_key text null check (exception_key is null or char_length(exception_key) <= 120),
  reason text not null check (reason in ('missed_punch','wrong_punch_type','device_outage','manager_verified_time','duplicate')),
  note text null check (note is null or char_length(note) <= 280),
  corrected_by uuid not null references public.user_profiles(id),
  corrected_at timestamptz not null default now()
);

create table public.timeclock_sync_rejections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  facility_id uuid not null references public.facilities(id),
  device_id uuid not null references public.timeclock_devices(id),
  staff_id uuid null references public.staff(id),
  client_punch_id uuid not null,
  punch_type text not null,
  device_time timestamptz null,
  reason text not null check (reason in ('not_recognized','locked','inactive_staff','not_assigned','invalid_next_type','pin_unavailable','facility_off')),
  created_at timestamptz not null default now(),
  unique (device_id, client_punch_id)
);
```

Shape rules enforced by a check constraint on corrections:

- `add_punch`: `punch_type` and `corrected_punched_at` required, `target_punch_id` null.
- `void_punch`: `target_punch_id` required.
- `change_time`: `target_punch_id` and `corrected_punched_at` required.
- `acknowledge`: `exception_key` required, `reason` must be `manager_verified_time`.

A trigger verifies `target_punch_id` belongs to the same organization, facility and staff.

RLS on `time_punches`, `time_punch_corrections`, `timeclock_sync_rejections`: **no update or delete policy for any role**, and a `BEFORE UPDATE OR DELETE` guard trigger raises for every role including service_role and the table owner path, so the append-only rule is not just a missing policy. Select for manager roles on accessible facilities, and for the staff member on rows where `staff.user_id = auth.uid()`. Insert into `time_punch_corrections` for manager roles with `corrected_by = auth.uid()`. Insert into `time_punches` and `timeclock_sync_rejections` only through `timeclock_record_punch`.

### 3.5 Audit

`timeclock_devices`, `timeclock_enrollment_codes`, `timeclock_facility_settings`, `timeclock_organization_settings` and `time_punch_corrections` carry the `haven_capture_audit_log` trigger. `timeclock_credentials` does not (its row would put `pin_hash` into `audit_log`); credential events are written by the definer functions as metadata-only rows: `credential_set`, `pin_reset`, `badge_registered`, `credential_locked`, `device_enrolled`, `device_revoked`, `device_throttled`.

---

## 4. Definer functions

Every function: `security definer`, `set search_path = public, extensions`, `revoke all ... from public, anon`, explicit grants, and a `COMMENT` carrying `COL-37 ruling:`.

### 4.1 Kiosk path (grant to `service_role` only, called from the route handlers)

`public.timeclock_enroll_device(p_code text, p_label text) returns jsonb`
Finds an unused, unexpired code by hash, creates the device with a fresh 32 byte token, marks the code used, writes `device_enrolled`. Returns `{ok, device_id, token, facility_id, facility_name}` or `{ok:false, error:'code_invalid'}`. The token is returned exactly once.

`public.timeclock_identify(p_device_token text, p_identifier text, p_badge_lookup_hmac text, p_pin text) returns jsonb`
Same validation as record_punch without inserting. Returns `{ok, first_name, state, next_actions[], today_worked_minutes}` so the kiosk can show the valid action button before the punch. Counts toward lockouts and throttles exactly like a punch.

`public.timeclock_record_punch(p_device_token text, p_identifier text, p_badge_lookup_hmac text, p_pin text, p_punch_type text, p_device_time timestamptz, p_client_punch_id uuid, p_captured_offline boolean) returns jsonb`

Deviation from the goal's signature, recorded: `p_badge_lookup_hmac` is added because the HMAC secret is a server environment value the database does not hold. The route computes the HMAC of the typed identifier and passes both; the function matches `employee_number = p_identifier` or `badge_lookup_hmac = p_badge_lookup_hmac`.

Order of checks, each returning `{ok:false, error}` rather than raising so that failure counters persist:

1. Device: `token_hash` matches, `revoked_at is null` → else `device_unknown` (HTTP 401). Update `last_seen_at`.
2. Device throttle: `throttled_until > now()` → `device_throttled` (429).
3. Facility flag: `timeclock_facility_settings.timeclock_enabled` for the device's facility → else `facility_off` (403).
4. Idempotency: an existing punch with `(device_id, client_punch_id)` → return it with `replayed: true` (200) before any credential work.
5. Credential lookup by employee number or badge HMAC within the device's organization. Not found → `not_recognized` (401) and a device failure.
6. Lock: `locked_until > now()` → `locked` (423). No counter change.
7. PIN: `pin_hash = crypt(p_pin, pin_hash)`. Wrong → increment `failed_attempts`, device failure; on the fifth failure set `locked_until = now() + 15 minutes`, write `credential_locked`; return `not_recognized` (401). Right → reset `failed_attempts`.
8. Staff: `employment_status in ('active','on_leave') and deleted_at is null` → else `inactive_staff`; the route returns 401 `not_recognized` so the tablet never learns why.
9. Facility membership: `staff.facility_id = device.facility_id` or a live `staff_facility_assignments` row → else `not_assigned`; the route returns 401 `not_recognized`.
10. State machine: last effective punch (corrections applied) within the last 16 hours decides the valid next types. Older than 16 hours counts as `out` (the `missing_out` exception carries the review). Invalid → `invalid_next_type` (409).
11. Insert. `punched_at = clock_timestamp()` when online; `= p_device_time` when `p_captured_offline`. Flags: `clock_skew` when `abs(device_time - server time) > 120 s` (online only), `offline_capture` when offline.
12. Return `{ok:true, punch_id, first_name, punch_type, punched_at, today_worked_minutes, next_actions, flags, replayed:false}`.

Offline replay differences: for `p_captured_offline = true`, steps 5 to 10 failures are also written to `timeclock_sync_rejections` (with `staff_id` when the identifier resolved) so they surface to managers as `rejected_offline_sync`. An empty `p_pin` on an offline replay records reason `pin_unavailable`. The kiosk treats any 4xx on an offline replay as delivered and drops the item.

Device failure accounting: a failure increments `failure_count` inside a rolling 10 minute window (`failure_window_started_at`); at 20 the device gets `throttled_until = now() + 5 minutes`, counters reset, and `device_throttled` is written.

Helper `public.timeclock_effective_punches(p_staff_id uuid, p_from timestamptz, p_to timestamptz)` returns the punches with `void_punch` removed, `change_time` applied, and `add_punch` rows included; used by the state machine and by `today_worked_minutes` (worked minutes on the device facility's calendar day in America/New_York, open segment counted to now). It is private (no request-role grant). Workweek boundaries are never computed in SQL; that rule lives only in `src/lib/timeclock/compute.ts`.

### 4.2 Manager path (grant to `authenticated`, body checks `haven.app_role()` and facility access)

- `timeclock_create_enrollment_code(p_facility_id uuid) returns jsonb` (`owner`, `org_admin`): returns `{code, expires_at}` once.
- `timeclock_revoke_device(p_device_id uuid) returns void` (`owner`, `org_admin`).
- `timeclock_list_devices(p_facility_id uuid) returns setof (id, label, enrolled_at, last_seen_at, revoked_at, throttled_until)` (manager roles).
- `timeclock_set_credentials(p_staff_id uuid, p_employee_number text, p_pin text, p_badge_lookup_hmac text, p_mode text)` (manager roles; `p_mode` in `set_number`, `set_pin`, `set_badge`, `clear_badge`). Refuses staff that are not `active`/`on_leave`. The PIN arrives from the route which generated it; the function only hashes.
- `timeclock_credential_status(p_staff_id uuid) returns jsonb` (manager roles): `{employee_number, has_pin, has_badge, locked_until, pin_set_at}`.
- `timeclock_unlock_credential(p_staff_id uuid)` (manager roles): clears `locked_until` and `failed_attempts`, writes `credential_unlocked`.

Reads of punches, corrections, sync rejections and settings by managers and staff are plain RLS selects from the browser client.

---

## 5. Kiosk flow (`/kiosk/timeclock`)

Tier 1 only. Light theme, `America/New_York` live clock, touch targets at least 56 px, WCAG AA, `prefers-reduced-motion` respected, works at 1024x768 and 768x1024.

1. **Enrollment** (no device token in IndexedDB): heading `Set up this tablet`, one input `Enrollment code` (8 characters, uppercase, autocorrect off), button `Enroll`. On success the facility name is shown for confirmation, the token is stored in IndexedDB (`haven-timeclock` database, `device` store), and the punch screen appears.
2. **Punch screen**: facility name, live clock, input `Badge or employee number` (autofocus, badge wedge types here and submits on Enter), then `PIN` (masked, `inputmode="numeric"`, on-screen keypad 0-9, backspace). After PIN the kiosk calls identify and shows one large primary button with the valid action (`Clock in`, `Start meal`, `End meal`, `Clock out`) and a secondary button when two actions are valid (`in` → `Clock out` primary, `Start meal` secondary; `meal_end` → same). Offline: the identify call cannot run; the kiosk shows all four actions and the server validates at sync.
3. **Confirmation**: first name, action, time (`7:02 a.m.`), and today's worked minutes as `12 h 4 min today`. Resets after 5 seconds.
4. **Errors** (never say which part was wrong): `Badge or PIN not recognized`, `Locked for 15 minutes. See your administrator.`, `This tablet is not set up for timeclock.` (401 device), `Timeclock is off for this facility.` (403 flag), `Try again in a few minutes.` (429). Inputs clear on any error and after 30 seconds idle.
5. **Offline**: when `navigator.onLine` is false or the request fails at the network layer, the punch is queued in IndexedDB (`punchQueue` store: client_punch_id, identifier, punch_type, device_time, queued_at) with the PIN held only in a page-memory map. Kiosk shows `Saved on this tablet. Will send when online.` Items older than 24 hours are dropped (they would be rejected as stale anyway and the manager sees the gap). Replay runs in queue order on `online` and on load; a network failure stops the replay so order is preserved; a 4xx removes the item (the server has recorded the rejection).

Route handlers (`src/app/api/kiosk/timeclock/*`, no session, service role, device token from header `x-timeclock-device`):

| Route | Method | Body | Result |
|---|---|---|---|
| `/enroll` | POST | `{code, label}` | `{device_id, token, facility_name}`; enrollment attempts are rate limited per client address with `in-memory-failure-rate-limit` (10 failures per 15 minutes). |
| `/identify` | POST | `{identifier, pin}` | `{first_name, next_actions, today_worked_minutes}` |
| `/punch` | POST | `{identifier, pin, punch_type, device_time, client_punch_id, captured_offline}` | punch receipt; status codes 200, 401 device, 403 flag, 423 locked, 409 invalid next type, 429 throttled, 422 offline rejection recorded |

Nothing typed on the kiosk is logged. Route logs carry `client_punch_id` and the error code only.

---

## 6. Manager flow (Quiet Operator, three tiers)

Navigation: Workforce pillar item `Timeclock` → `/admin/timeclock`.

**Tier 1, `/admin/timeclock`**: facility selector (existing scope), pay period selector (current period by default; falls back to the current workweek when the pay period is unset, with the `Set the pay period to export` notice). Table: staff name, status now (`In since 6:58 a.m.`, `On meal`, `Out`), week minutes, overtime minutes, exceptions count. Nothing else. Actions: `Export payroll CSV` (disabled with the blocking reason), `Compare with uPunch`. Owner and org_admin see a small `Pay period` panel to set the organization setting.

**Tier 2, `/admin/timeclock/[staffId]`**: days in the period, each with its effective punches, worked minutes, meal minutes, flags, and exceptions. Correction form: type (`Add punch`, `Void punch`, `Change time`), punch type and time as applicable, reason select, optional note. Exception rows carry `Acknowledge` which writes an `acknowledge` correction with `manager_verified_time` and the exception key.

**Tier 3**: `Full history` disclosure on the same page listing every raw punch and every correction with actor and time.

**Credentials** (staff profile, `Timeclock access` section, manager roles): employee number, `Register badge` (focus an input and scan; the kiosk never sees the raw value again), `Generate PIN` (6 random digits shown once with `Copy` and `Print`), `Reset PIN`, `Unlock` when locked. Staff that are not `active`/`on_leave` show `Timeclock access removed` and no controls.

**Devices** (facility settings, `Timeclock` tab): `Timeclock` toggle (owner, org_admin), `Enroll a tablet` shows the one time code and expiry, device list with label, enrolled, last seen, `Revoke`.

### 6.1 Exceptions (computed, never stored)

| Key | Rule |
|---|---|
| `missing_out` | Effective `in` (or `meal_end`) with no later `out` and more than 16 hours old. |
| `missing_meal_end` | `meal_start` followed by anything other than `meal_end`, or open more than 16 hours. |
| `clock_skew` | Punch flag. |
| `offline_capture` | Punch flag. |
| `rejected_offline_sync` | Row in `timeclock_sync_rejections`. |
| `short_turnaround` | `out` to the next `in` under 8 hours. |

Exception key: `${type}:${anchor}` where anchor is the punch id (or rejection id). An exception is resolved when an `acknowledge` row with that key exists, or when it no longer computes after corrections.

---

## 7. Computation (`src/lib/timeclock/compute.ts`)

Single source for: workweek boundaries (Monday 00:00 America/New_York), effective punches (corrections applied), segment pairing, worked and meal minutes, workweek split, overtime, day rows, exceptions, and the current status line. Rules:

- Durations are integer minutes from UTC instants (`Math.floor((end - start) / 60000)`), so DST weeks are exact. No rounding of the total beyond the floor of each segment.
- A worked segment runs from `in` to the next `out`; `meal_start` to `meal_end` inside it is subtracted. An open segment ends at `now` for status and week totals.
- Segments are split at workweek boundaries; the minutes before midnight Monday belong to the earlier week.
- Overtime per staff per workweek = `max(0, worked - 2400)`.

---

## 8. Export (`src/lib/timeclock/export.ts`, `GET /api/admin/timeclock/export`)

File `haven-timecard-{facility-slug}-{period-start}.csv`. Header row, one row per staff per workweek in the pay period:

```
employee_number,staff_name,period_start,period_end,workweek_start,regular_minutes,overtime_minutes,meal_minutes,exception_count,unapproved_exceptions
```

Blocked (button disabled, route returns 409) while any exception in the period lacks an acknowledgment or correction, with `Resolve {n} exceptions to export`. Blocked with `Set the pay period to export` while the organization setting is null. Staff without credentials export with an empty employee number.

---

## 9. Parallel run: `Compare with uPunch` (`/admin/timeclock/compare`)

Upload a CSV exported from the uPunch app. Choose which uploaded columns hold employee number or name, date, and hours; choose the hours format (decimal hours or `H:MM`). The comparison shows per staff per workweek: Haven minutes, uPunch minutes, difference, `Match` when the absolute difference is 5 minutes or less. The upload is parsed in the browser and discarded; nothing from it is stored or sent to the server. Download the comparison as CSV. Name matching is case and whitespace insensitive on `last, first` or `first last`; unmatched rows are listed separately.

---

## 10. Parallel run and cutover gates

See `docs/homewood/timeclock-cutover.md` (phases, no dates) and `docs/operations/timeclock-kiosk-lockdown.md` (Mosyle supervised iPad locked to `https://circleoflifealf.com/kiosk/timeclock`).

Exit gate for the parallel run: consecutive pay periods with zero unexplained differences (count TBD by Brian), payroll export accepted by payroll, ADP alignment from COL-357 confirmed, Jessica Murphy confirms workweek, meal and rounding TBDs. Rollback: turn the facility flag off and resume uPunch cards.

---

## 11. Environment

| Variable | Runtime | Purpose |
|---|---|---|
| `TIMECLOCK_BADGE_HMAC_SECRET` | Next.js server | HMAC-SHA256 key for badge lookup. Required for badge registration and badge punches; employee number punches work without it. Not set by this build. |

---

## 12. TBD list

1. Workweek start, meal paid or unpaid, rounding, and pay period frequency must match ADP. Confirmation with Jessica Murphy and payroll before cutover.
2. Parallel run exit count (consecutive matching pay periods): Brian.
3. `TIMECLOCK_BADGE_HMAC_SECRET` value and rotation owner (rotation invalidates every registered badge; re-scan required).
4. Whether `on_leave` staff may punch (this build allows it; a manager can revoke by suspending).
5. Mosyle steps marked `TBD verify` in the lockdown document.
6. uPunch day attribution: the Punch-to-Pay export lists hours by date. If it puts a whole night shift on the date it started, a shift crossing Sunday midnight differs from Haven in both adjacent workweeks by design (Haven splits at Monday 00:00 America/New_York). Confirm uPunch's midnight split setting before reading a Sunday night difference as an error. The synthetic fixture in the COL-352 evidence shows both outcomes.

## 12a. Known limits from the pre-merge review (not defects that block the parallel run)

These were found by an adversarial review of this build and judged lower severity than the five that were fixed. Each is a real behaviour a reader should know before the cutover.

- **The kiosk is an employee-number oracle.** A wrong PIN on an existing credential eventually returns `Locked for 15 minutes`, while an unknown identifier always returns `Badge or PIN not recognized`, and only the existing credential pays the bcrypt cost. Someone holding the tablet can therefore learn which employee numbers exist, and can lock a colleague out for 15 minutes. The device throttle (20 failures per 10 minutes) bounds the rate, device enrollment bounds who can try, and a manager can clear a lock. Revisit if employee numbers are issued sequentially.
- **A replayed punch is returned without re-checking the credential.** `timeclock_record_punch` answers an already recorded `(device, client_punch_id)` before it validates the PIN, so that the retry of a lost response is safe. Someone who knew a previously used client punch id would get that punch's first name and today's minutes back. The id is a random UUID, so this is not reachable in practice.
- **Queue order follows the tablet clock.** Offline punches replay in `queuedAt` order. If the tablet's clock jumps backwards between two captures (an NTP correction), they can replay out of order and the later one is refused as an invalid next type. Mosyle sets the clock automatically, which is why the lockdown document requires it.
- **A punch queued for more than 24 hours is dropped by the tablet** with no server-side record, because the server never saw it. A tablet offline across a weekend loses that shift from the timesheet with nothing to flag it; the manager finds it as a missing punch and corrects it with `device_outage`.
- **`haven.timeclock_worked_minutes` floors each segment separately** for the kiosk receipt, so the tablet can read one minute below `src/lib/timeclock/compute.ts` on a shift with several meal breaks. The receipt is informational; payroll uses `compute.ts`.

## 13. Follow ons

- Bridge timeclock workweeks into `time_records` or point the payroll batch import at the timeclock export (COL-357).
- Stand Up overtime prefill from timeclock week totals.
- Automatic credential revocation on termination (COL-355); today a terminated person is rejected at the kiosk because the function checks `employment_status`.
- Pay period selector history beyond the current and previous period.
- Kiosk cached last-known state per staff for a better offline action choice.
- Close the items in §12a: constant-time credential lookup, a credential check on the replay path, a monotonic capture sequence for the offline queue, and a server-side record when the tablet drops an expired punch.
