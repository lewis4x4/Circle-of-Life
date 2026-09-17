# Module 38: Admission and discharge register, visitor log, survey print pack (COL-353)

Homewood Lodge keeps a paper admission and discharge log, a paper visitor sign in sheet, and printed survey binders. Haven already records admissions, discharges, hospital holds and leave through `resident_status_history`. What is missing is the register people actually read and print. This module adds a facility Admission and Discharge Register derived from status history, a staff operated front desk Visitor Log with a live in the building now list, and a Survey Print Pack that prints both plus the census record for a walk in survey.

Mission alignment: pass. The register is derived from the record Haven already keeps, so nobody retypes a resident's history into a second place; the visitor log gets a definer write path and a void trail where it previously had a client update; the print pack leaves an audit event naming what was handed to a surveyor. No AI judgment is introduced and no clinical decision is automated.

**Linear:** COL-353 (this module), COL-352 (timeclock, owns device enrollment the visitor kiosk would reuse), COL-351 (roster census, owns the Stand Up status set), COL-418 (discharge frees the bed, owns the discharge entry point).
**Migration:** `412_admission_discharge_register_visitor_log.sql`. 408 to 411 are on `origin/main` (timeclock, facility data checks hardening, assessment instrument hold, facility identity health scope comment). **Database probes:** `supabase/tests/review_admission_discharge_register.sql`, `supabase/tests/review_visitor_log.sql`.
**Routes:** `/admin/residents/register`, `/admin/front-desk` (existing, extended), `/admin/compliance/survey-pack`, `/print/survey-pack`.

---

## 1. Decisions (settled, do not reopen)

| Topic | Decision |
|---|---|
| The register is derived | Every row comes from `resident_status_history`. There is no form that types a register line. A wrong row is fixed by correcting the resident's status through the existing flows, and the register follows. |
| Event types | `admission` (first transition into `active` for that residency), `readmission` (into `active` after `discharged`), `discharge` (into `discharged`), `death` (into `deceased`), `hospital_out` (into `hospital_hold`), `hospital_return` (`hospital_hold` to `active`), `leave_out` (into `loa`), `leave_return` (`loa` to `active`). |
| Bed holds are hideable | Hospital and leave rows show by default and hide with one toggle, so the page can match a paper log that lists only admissions and discharges. |
| Status labels | `hospital_hold` is "Bed Hold: Hospital". `loa` is "Bed Hold: Vacation/Family". Never "memory care". |
| Visitor log is staff operated | A front desk staff member signs a visitor in and out on the admin app. A self service kiosk is out of scope; it would reuse COL-352's device enrollment and waits for that merge. |
| One visitor log | Haven already had `public.visitor_log_entries` (migration 294). This module hardens that table rather than adding a second one. See §3. |
| Visitor writes | Sign out, correction and void go through `security definer` functions, never a client update. Sign out sets the sign out time once. A wrong entry is voided with a coded reason and stays visible in tier 3. |
| No free text on the new path | The sign in form writes no notes. Free text invites health details about residents onto a log that front desk staff read. |
| Entries left open | Entries signed in before the most recent 04:00 America/New_York and not signed out are flagged `left_open` and shown as an exception. They are never auto closed. |
| Visitor privacy | Visitor records and the resident visited are PHI adjacent. Same facility scope as resident records, minus `family`. Corporate and Front Office get no new read path from this module. |
| Print pack | A print stylesheet on Haven pages under the existing `(print)` route group. No PDF library, no new dependency. |
| Print is recorded | Every print writes one audit event with facility, pack sections and date range, and no names. If the audit write fails the print view does not render. |
| Binder retirement | Not decided here. Binders remain until Michelle compares a Haven print pack against the binder for the same range and approves it. |
| Out of scope | Visitor self service kiosk, Stand Up admissions and discharges suggestion (§7), a register entry form, visitor retention policy, PDF generation. |

**TBD (record, do not decide here):** see §8.

---

## 2. Discovery facts the design rests on

- `public.resident_status_history` (migration 217) is an **interval** model, not a from/to model: one row per status with `status`, `effective_from`, `effective_to`, plus `reason`, `notes`, `created_by` referencing `public.user_profiles(id)`. There is no `from_status` column. The previous status is derived with `lag(status) OVER (PARTITION BY resident_id ORDER BY effective_from)`, which is why the register classifies events with a window function and not a stored column.
- `resident_status` enum: `inquiry`, `pending_admission`, `active`, `hospital_hold`, `loa`, `discharged`, `deceased`.
- `residents` carries `admission_source text`, `discharge_reason discharge_reason`, `discharge_destination text`, `discharge_date date`. The admit flow (`/admin/admissions/new`) writes `admission_source`; `officialDischargePatch()` in `src/lib/residents/official-discharge.ts` writes `discharge_reason` and `discharge_destination`. All three live on the resident row, not on the status history row, so they are single valued per resident.
- There is **no bed assignment history table**. `residents.bed_id` is the current assignment only, and an official discharge sets it to `null`. Room and bed at the time of an event are therefore not recoverable. The register returns the current assignment with `room_as_of = 'current'`, and a discharged resident shows no room. See §8.
- `public.resident_billable_status` (migration 217, `security_invoker` since 389) is the billable compatibility view: `active`, `hospital_hold`, `loa` are billable; `inquiry`, `pending_admission`, `discharged`, `deceased` are not. It reads `residents.status`, which is the current status, so it cannot answer a historical month by itself. §4 explains how the census function stays tied to it.
- `public.census_daily_log` (migration 007) is a facility level daily aggregate (occupied beds, hold beds, occupancy rate, `admissions_today`, `discharges_today`). It has no per resident rows and no billable versus physical split, so it is not the census record this pack prints.
- Residents are visible to any role that is not `family` holding the facility grant (`013_resident_profile_rls.sql`). `family` sees only linked residents through `haven.can_access_resident(id)`. Admitting is `owner`, `org_admin`, `facility_admin`, `nurse`; discharging is those plus `caregiver`.
- `public.audit_log` has RLS enabled and no policies, so only `service_role` or a `security definer` function can write it. The print pack event follows the migration 322 pattern: insert directly with `new_data = jsonb_build_object('event', ...)`.
- `public.user_profiles.id` **is** `auth.users.id` (migration 003), so `signed_in_by = auth.uid()` needs no lookup table. `haven.authorized_user_id()` is the canonical actor accessor.
- Stand Up's admission and discharge field keys are `admissions_expected` and `expected_discharges`, and their own help text says "not admissions already made". They are forward looking expectations. Status history records what happened, so it cannot suggest them. See §7.
- The `(print)` route group (`src/app/(print)/layout.tsx`) already serves print sheets outside the app shell with identity context and no chrome. The pack lives there rather than hiding navigation with print CSS.

---

## 3. Visitor log: what changed and why

Migration 294 shipped `public.visitor_log_entries` for the Module 35 front desk kit, and `/admin/front-desk` writes to it. COL-353 asked for a table with the same name. Adding a second visitor log would give Homewood two places a visitor might have been signed in and would make the surveyor facing print pack read only one of them, so migration 412 hardens the existing table instead.

Two of these are correctness fixes independent of COL-353. The table had a client `UPDATE` policy, so any facility staff member could rewrite `visitor_name` or `checked_in_at` after the fact; and `resident_id` had no constraint tying it to the entry's facility.

| Concern | Before (294) | After (412) |
|---|---|---|
| Sign in and out times | `checked_in_at`, `checked_out_at` | unchanged; these are the sign in and sign out columns. Renaming live columns would break `/admin/front-desk` for no gain. |
| Who signed in and out | `created_by` referencing `auth.users` | adds `signed_in_by`, `signed_out_by` referencing `public.user_profiles(id)` |
| Visitor type | `family`, `vendor`, `contractor`, `medical`, `official`, `other` | adds `surveyor_regulator`. Existing values are kept; rows written before 412 keep their value and the screen labels them. |
| Who is being visited | `resident_id`, unconstrained | adds `visiting_type` (`resident`, `staff`, `facility`) with a check that `resident_id` is present exactly when `visiting_type = 'resident'`, and a trigger that the resident belongs to the entry's facility |
| Phone | none | adds `visitor_phone`, optional, format checked |
| Sign out | client `UPDATE` | `public.visitor_sign_out()`, `public.visitor_sign_out_all_open()`; the UPDATE policy is dropped |
| Void | soft delete only | adds `voided_at`, `voided_by`, `void_reason` (`entered_in_error`, `duplicate`, `wrong_facility`) through `public.visitor_void()` |
| Free text | `purpose`, `screening_notes` | kept for the infection control screening the front desk kit already captures; the COL-353 sign in form writes neither |

`visiting_type` is nullable and its checks are written so rows created before 412 stay valid. New rows through the COL-353 form always set it.

---

## 4. Data model

### 4.1 `public.admission_discharge_register(p_organization_id, p_facility_id, p_from, p_to, p_include_holds)`

`security invoker`, `set search_path = public`. One row per event. The caller's resident row level security decides what is visible.

| Column | Source |
|---|---|
| `event_at` | `resident_status_history.effective_from` |
| `event_type` | classified from `lag(status)` and `status` (§1) |
| `resident_id`, `resident_display_name` | `residents` |
| `room_number`, `bed_label`, `room_as_of` | current assignment through `residents.bed_id`; `room_as_of` is always `'current'` (§2) |
| `from_status`, `to_status` | `lag(status)` and `status` |
| `admission_source` | `residents.admission_source`, on `admission` and `readmission` rows only |
| `discharge_reason`, `discharge_destination` | `residents.discharge_reason`, `residents.discharge_destination`, on `discharge` and `death` rows only, and only for the resident's most recent such event (§8) |
| `recorded_by`, `recorded_by_name` | `resident_status_history.created_by` joined to `user_profiles` |

Events are classified in one query with a window function over each resident's ordered history. No loops. Rows with `deleted_at` set are excluded. `p_include_holds = false` drops `hospital_out`, `hospital_return`, `leave_out` and `leave_return`. Range is `effective_from >= p_from AND effective_from < p_to`, half open, so an event at exactly `p_to` belongs to the next range and no event is printed twice across adjacent packs.

### 4.2 `public.census_record_monthly(p_organization_id, p_facility_id, p_from, p_to)`

`security invoker`, `set search_path = public`. Returns `resident_id`, `resident_display_name`, `month` (a date, the first of the month), `physical_presence_days integer`, `billable_days integer`.

Physical presence days are days the resident was `active`. Billable days are days in a status the compatibility view calls billable. The view reads current status, so it cannot be joined per historical day. Rather than restate its list, migration 412 adds `haven.resident_status_is_billable(public.resident_status)`, and `supabase/tests/review_admission_discharge_register.sql` asserts the helper agrees with `public.resident_billable_status` for **every** value of the enum. The view is untouched and stays the authority: if anyone changes it, the probe fails. A day counts when the resident held the status at any point in it, evaluated in America/New_York.

### 4.3 Visitor functions

All `security definer`, all `set search_path = public`, all assert the caller's facility grant, all write an audit event. Execute granted to `authenticated`, revoked from `anon` and `public`.

- `public.visitor_sign_out(p_entry_id uuid)` sets the sign out time and `sign_out_method = 'individual'` once. Raises if already signed out or voided.
- `public.visitor_sign_out_all_open(p_facility_id uuid)` signs out every open entry for the facility with `sign_out_method = 'bulk_end_of_day'` and returns the count. Voided rows are left alone.
- `public.visitor_void(p_entry_id uuid, p_reason text)` voids once with a coded reason.
- `public.visitor_log(p_organization_id, p_facility_id, p_from, p_to, p_include_voided)` is `security invoker` and computes `left_open`: open, not voided, and signed in before the most recent 04:00 America/New_York.

### 4.4 `public.survey_print_pack_record(p_facility_id uuid, p_sections text[], p_from date, p_to date)`

`security definer`, asserts the facility grant, inserts one `audit_log` row with `table_name = 'survey_print_pack'`, `action = 'INSERT'`, and `new_data = jsonb_build_object('event', 'survey_print_pack_printed', 'sections', ..., 'range_from', ..., 'range_to', ...)`. No resident name, no visitor name, no staff name. `user_id` and `facility_id` carry who and where, which is what the audit log carries for every other event.

---

## 5. Flows

**Register.** An administrator opens `/admin/residents/register`, picks a range (last 30 days by default on screen), and reads a dense table. A counts line above it reads `Admissions 3 · Discharges 2 · Hospital out 1`. Turning off `Show bed holds` leaves admissions, readmissions, discharges and deaths. A row opens the resident's status timeline around that event and links to the record and to the flow that would correct it. Nothing on this page writes.

**Visitor sign in.** A front desk staff member opens `/admin/front-desk`, types the visitor's name, picks a type, picks Resident, Staff or Facility, and for Resident picks from that facility's `active`, `hospital_hold` and `loa` residents only. Submit returns focus to the name field for the next visitor in the queue. The whole flow is keyboard operable and laid out for a phone at 390.

**Sign out.** A `Sign out` button per row in `In the building now`. At end of day `Sign out everyone` confirms with the count and records `bulk_end_of_day`. An entry left open past 04:00 reads `Still signed in from {date}` as neutral text and stays open.

**Survey walk in.** The front desk signs the surveyor in as `surveyor_regulator`. The administrator opens `/admin/compliance/survey-pack`, takes the default range of the prior six months, ticks the sections, and prints. The pack is handed over and the audit event is the record of what was provided.

---

## 6. Print pack

Sections, in order: Admission and Discharge Register, census record, Visitor Log. Range defaults to the prior six months ending today. The register section carries its own with or without bed holds choice.

The print view is one page tree under `(print)`, which has no navigation chrome by construction. `@media print` rules live in a colocated CSS module: black on white, `thead` repeated on each page with `display: table-header-group`, rows kept together with `break-inside: avoid`, and a section title with facility and range at the top of each section. The footer reads `Printed from Haven by {name} on {date time} Eastern · Page N of M · {facility}` with page numbers from CSS counters.

The route calls `survey_print_pack_record` before rendering. If it fails the view renders `Print could not be recorded. Try again.` and no pack.

---

## 7. Stand Up admissions and discharges

Out of scope, and **no follow on issue is filed**. The run brief said to file one if Stand Up had admissions or discharges field keys. It has `admissions_expected` and `expected_discharges`, whose own help text reads "Admissions you expect this week, not admissions already made" and "Discharges you expect this week, where notice has been given or the decision is known". Those are forward looking expectations. `resident_status_history` records what already happened and cannot suggest either one. Suggesting them from the register would put last week's actuals into a field that asks for next week's plan, which is the kind of quiet wrongness a confirmed figure is supposed to prevent. If COL later adds "admissions made" and "discharges made" keys, that is the issue to file, and the Front Office allowlist order applies: Front Office first, never a version bump.

---

## 8. TBD (record, do not decide here)

| # | Question | Owner | Reference |
|---|---|---|---|
| 1 | (COL-451) Which columns does the Homewood paper admission and discharge log carry that Haven does not capture? Haven has admission source, discharge reason and discharge destination on the resident row; the paper log may carry responsible party, payer at admission, or a physician. No vocabulary or column is added for these until the paper log is read. | Jessica Murphy | Homewood paper admission and discharge log |
| 2 | (COL-451) Room and bed at the time of an event. Haven has no bed assignment history, so the register prints the current assignment and a discharged resident shows none. Deciding this means deciding whether to record bed assignment history, which is a schema change outside this module. | Jessica Murphy | §2, `room_as_of` |
| 3 | (COL-451) Discharge reason and destination for a resident who was readmitted. `residents` holds one set of discharge columns, so a readmission overwrites the prior discharge's reason and destination. The register shows them only on the most recent discharge or death row and leaves older ones blank rather than showing the wrong reason. | Jessica Murphy | §4.1 |
| 4 | Visitor log retention period. No retention rule is applied by this module. | Michelle Norris | |
| 5 | Do surveyors sign the visitor log? `surveyor_regulator` exists as a type; whether a surveyor is asked to sign in is a facility practice decision. | Michelle Norris | §5 |
| 6 | Paper binder retirement sign off. Binders stay until Michelle compares a print pack against the binder for the same range and approves. | Michelle Norris | `docs/homewood/admission-discharge-visitor-runbook.md` |

---

## 9. Follow ons

- **COL-450** Visitor self service kiosk on enrolled tablets. Blocked by COL-352 merging; the kiosk reuses its device enrollment.
- **COL-451** Decision: admission source and discharge destination on the register. Open decision for Jessica Murphy, covering TBD 1, 2 and 3.
- No Stand Up suggestion issue was filed. See §7 for why.
