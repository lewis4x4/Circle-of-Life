# Haven: "Something Happened" Capture Spec

**Module:** 07 Incident and Risk (rewrite of the capture layer)
**Facility of record:** Homewood Lodge
**Repo:** `~/Circle of Life/Circle-of-Life`, `main` at `35594091`, migration head `399`
**Date:** 2026-09-16
**Status:** Draft for Speedy's review, then Jessica for thresholds and vocabulary

> **Roles updated 2026-09-22 (COL-615):** the retired `nurse` and `caregiver` login roles are now `med_tech`; `dietary` / `dietary_aide` are now `cook`. The Section 1 problem table records the code as it stood on 2026-09-16 and is left as written. See the Roles section in `AGENTS.md`.

---

## 1. Diagnosis: what the code and the screenshots say

Seven findings. File references are the current `main`.

| # | Finding | Evidence |
|---|---|---|
| 1 | **Five doors for one moment.** A caregiver who saw something must first decide whether it is a Shift Log, a Behavior, a Condition change, a Quick Note, or an Incident. Each writes a different table with its own notified flags. | `src/app/(caregiver)/resident/[id]/page.tsx` action grid (ADL, Shift Log, Behavior, Condition, Quick Note). Incident lives elsewhere on `FloorWorkflowStrip`. Tables: `daily_logs`, `behavioral_logs`, `condition_changes`, `incidents`, plus `append_caregiver_shift_note`. |
| 2 | **The caregiver picks the severity level.** "Level 2, minor injury / repeat event" versus "Level 3" is a clinical and regulatory judgment. The aide with a resident on the floor should never be the one deciding it. | `src/app/(caregiver)/incident-draft/page.tsx` `SEVERITY_LABELS` select; `caregiverIncidentSeverityValues` in `src/lib/validation/caregiver-incident.ts`. |
| 3 | **Nothing happens after submit.** No push, no text, no call. "Notify the nurse" is a boolean an administrator checks later by hand. The Kanban "Begin Triage" button has no handler; the card is a link. | `buildIncidentOpenObligations()` in `src/lib/incidents/workflow-obligations.ts`; manual `update({ nurse_notified: true })` at `AdminIncidentDetailPageClient.tsx:684-713`; `AdminIncidentsPageClient.tsx:575-578`. No Edge Function reads `notification_routes`; only the settings page does. |
| 4 | **The system says "nurse". COL says "Administrator or Assistant".** COL's own Incident Reporting Procedure (effective 12/01/2019): "Staff will immediately notify the Administrator or Assistant." Homewood may have no nurse on shift. The obligation is hardcoded. | `Incident Reporting Procedure.pdf` (parent folder); `workflow-obligations.ts` line `items.push("Notify the nurse.")`. HAVEN_BRAIN §4: standard alert audience is Administrator, Assistant, Michelle, Jessica, routed by role. |
| 5 | **Follow-ups never generate.** Spec 07 defines the post-fall protocol. `incident_followups` exists. Nothing inserts rows except demo seed. Only two things fire on insert: the watch protocol trigger and the care plan review alert trigger. | `grep "INSERT INTO incident_followups"` hits only `033_seed_oakridge_demo_data.sql`. Triggers on `incidents`: `156_watch_protocol_auto_trigger.sql`, `394_care_plan_review_alert_triggers.sql`. `regulatory_reporting_obligations` has no writer. |
| 6 | **Prose is required.** `description` and `immediate_actions` are `NOT NULL`. HAVEN_BRAIN §5.4, Jessica's rule: "dropdown-only by default... the design assumes line staff will not write coherent narrative." The incident form breaks the rule that the observation form obeys. | `021_incident_reporting_schema.sql`; the caregiver form's two required textareas. |
| 7 | **Admin surfaces are Tier 2 and 3 with no Tier 1 for the floor.** The Kanban, Lifecycle Blockers, and RCA workspace are fine as operational detail and history. There is no ten-second surface for the person who just found a resident on the floor. | Screenshots: Safety Operations Kanban, Incident Lifecycle Blockers, Root cause workspace. |

One more fact that shapes everything below. COL's paper process is already the right shape:

1. Staff complete Section 1 (type of injury checkboxes, first aid yes/no, facts) and Section 3 (witnesses).
2. Staff immediately notify the Administrator or Assistant.
3. Administrator or Assistant complete Section 2 (family, physician, EMS notified with time) and Section 4 (corrective action).
4. Staff document on the Resident Observation Log, a running per-resident line log.
5. Administrator secures video if appropriate, then follows up.

Haven should do steps 2, 4, and the "follow up" verification automatically, and split the form the way the paper does: the floor does Section 1, the office does Sections 2 and 4.

---

## 2. The design: one door, three taps

**One door.** On the floor-app home (`/caregiver`) and on every resident hub, one primary button: **Something happened**. It replaces the incident tile and absorbs Behavior and Condition as branches. Quick Note stays for "nothing happened, just a note." ADL, meds, and rounds are routine work and stay where they are.

**Three taps.**

| Tap | Screen | What the reporter does | What Haven does |
|---|---|---|---|
| 1 | **Who** | Taps a resident face from "My residents" (today's `shift_assignments.assigned_resident_ids` for the signed-in staff row), searches, or taps "No resident / the building." Pre-filled when launched from a resident hub. | Loads resident risk flags (`residents.fall_risk_level`, `elopement_risk`, active `resident_watch_instances`) to tune the questions. |
| 2 | **What** | Taps one of eight tiles: Fall, Hurt, Sick or not themselves, Upset or behavior, Wandering or left, Medicine, Family or complaint, Building or other. | Selects the question set. |
| 3 | **How bad** | Answers two to four big-button questions on one screen. A live banner reads back the result in plain words: *Note*, *Heads-up*, *Urgent*, *Emergency*. One optional **I'm worried** button raises it one step. Then taps the send button, whose label already says what will happen. | Derives the level, category, flags, and the factual sentence. Routes. Returns a receipt. |

No typing at any level. A mic button (speech to text through `grace-transcribe`) and a camera button (`incident_photos`) are optional on the confirmation screen. Time defaults to now; "It happened earlier" opens a 15-minute stepper, never a datetime picker. Shift is derived (`currentShiftForTimezone`). Location is six chips from `observation_vocab` (`location`), not a text field.

**Send button copy by level.**

| Level | Word on screen | Button | Stored |
|---|---|---|---|
| 1 | Note | Save to log | `level_1` |
| 2 | Heads-up | Save and alert the Administrator | `level_2` |
| 3 | Urgent | Send urgent alert | `level_3` |
| 4 | Emergency | Send emergency alert | `level_4` |

Level 4 screens for Sick, Fall, and Wandering show one interstitial line before the button: *Call 911 first if you have not. Then send.* This is a per-event escalation to named roles. It is not the rejected mass alert button and must not become one.

**Receipt screen (what builds trust).** "Saved to P. Brownell's log at 10:06 PM. Kaye Sorensen (Administrator) alerted by push and text at 10:06 PM. Waiting for acknowledgment." The acknowledgment line updates live. Then: "Next for you: check on him again at 10:20 PM" (from the watch protocol). Buttons: Add photo, Add voice note, Back to my residents.

**Offline.** The capture writes to an IndexedDB queue keyed by `client_event_id` and syncs on reconnect (the PWA service worker from `055` exists). The receipt says "Saved on this device, sending when back online" and shows the on-call phone from the cached `on_call_schedules` row for Level 3 and 4 so the human step still happens.

### 2.1 The eight tiles and their questions

Every question is a row of large buttons. Multi-select rows are marked. The rules column is the whole level engine for that tile; §3 formalizes it.

**Fall** (category `fall_with_injury` or `fall_without_injury`; `fall_witnessed` from Q3)

| Q | Buttons | Rule |
|---|---|---|
| Are they hurt? | Not hurt / A little (bruise, scrape, sore) / Badly (bleeding will not stop, cannot move or stand, bone looks wrong, passed out) | Badly = L4. A little = L2 minimum. |
| Did they hit their head? | No / Yes / Not sure | Yes or Not sure = L3 minimum (neuro checks). |
| Did anyone see it happen? | Yes / No | Sets `fall_witnessed`. No injury and unwitnessed = L2. |
| Are they going out (911 called or going to the ER)? | No / Yes | Yes = L4 (transfer to more acute care is an AHCA adverse incident). |

Floor for any fall is L2. See decision D2.

**Hurt** (injury found, no fall; categories `skin_integrity`, `unexplained_bruise`, `other`)

| Q | Buttons | Rule |
|---|---|---|
| What do you see? (multi) | Bruise / Skin tear or cut / Burn / Swelling or pain / Other | Sets injury description. |
| How bad? | First aid was enough / Needs more than first aid | More than first aid = L3 (physician). |
| Do you know how it happened? | Yes / No | No + bruise = `unexplained_bruise`, L2. Second unexplained bruise in 30 days = L3. |

Known cause, first aid enough = L1 with a photo prompt. That is the "minor thing closed out as a note" Speedy asked for. Unknown cause is never L1.

**Sick or not themselves** (writes `condition_changes`; category `other` if promoted)

| Q | Buttons | Rule |
|---|---|---|
| What do you see? (multi) | More confused than usual / Weak or dizzy / Fever or chills / Vomiting or diarrhea / Not eating or drinking / Pain / Short of breath / Chest pain / Face droop, slurred speech, one weak side / Will not wake up or very hard to wake | Any of the last four = L4 with the 911 line. One other signal = L2. Two or more = L3. |
| How fast? | Came on today / Getting worse over days | Stored on the row; does not change level. |

**Upset or behavior** (writes `behavioral_logs`; categories `behavioral_resident_to_resident`, `behavioral_resident_to_staff`, `behavioral_self_harm`)

| Q | Buttons | Rule |
|---|---|---|
| What happened? | Yelling or cursing / Refusing care / Hitting, pushing, grabbing / Sexual behavior / Crying or withdrawn / Hurting themselves | Sexual behavior toward another resident = L3. Hurting themselves = L3. |
| Was anyone touched or hurt? | No one / Another resident / Staff | Another resident = L3 minimum. Staff = L2. |
| Is it over? | Yes / Still going | Still going = L2 minimum. |

No one touched, over = L1. That is most behavior events, and today they evaporate into Quick Notes.

**Wandering or left** (categories `wandering`, `elopement`)

| Q | Buttons | Rule |
|---|---|---|
| Where are they now? | Found inside / Found outside on the grounds / Found off the property / Not found yet | Not found yet = L4 now, `elopement`, AHCA flag pending admin decision. Off property = L3 `elopement`. On grounds = L2 `wandering`. Inside = L1 `wandering`. |
| Hurt? | No / Yes | Yes raises one level. |

**Medicine** (categories `medication_refusal`, `medication_error`)

| Q | Buttons | Rule |
|---|---|---|
| What happened? | Refused / Missed or late / Wrong medicine, dose, time, or person / Took something not theirs | Refused = L1 with "also mark it in the eMAR." Missed or late = L2. Wrong or not theirs = L3 `medication_error`. |
| Any reaction or feeling bad? | No / Yes | Yes = L4. |

**Family or complaint** (categories `abuse_allegation`, `neglect_allegation`, `other`)

| Q | Buttons | Rule |
|---|---|---|
| What happened? | Family upset or complaint / Visitor problem / Resident complaint about care / Someone may have been mistreated | Mistreated = L3 `abuse_allegation`, DCF report obligation for the administrator (s. 429.23(6), ch. 415). Resident complaint about care = L2 with the grievance clock (10-day acknowledgment, 21-day resolution, s. 429.28). Others = L1. |

**Building or other** (resident optional; categories `environmental_*`, `property_damage`, `property_loss`, `other`)

| Q | Buttons | Rule |
|---|---|---|
| What happened? | Water leak or flood / Smoke, fire, or alarm / Power out / Broken equipment / Something missing or damaged / Other | Smoke or fire = L4. Leak or power = L2. Equipment, missing, damaged, other = L1. |
| Is anyone in danger? | No / Yes | Yes = L4. |

**I'm worried** raises the derived level by one (never above 4) and stores `level_bumped_by_reporter = true`. Reporters can always escalate. Only an administrator can lower, with a reason, and the original stays on the row.

---

## 3. The level engine

One rule set, two runtimes, one fixture file.

- `src/lib/care-events/level-engine.ts`: pure function `deriveCareEvent(kind, answers, residentContext) => { level, category, flags, sentence }`. No IO. Exhaustive vitest coverage from `src/lib/care-events/level-cases.json`.
- `public.care_event_derive(kind text, answers jsonb, context jsonb) RETURNS jsonb`: SQL mirror, `IMMUTABLE`, used inside `submit_care_event` so the server never trusts the client's level.
- `scripts/care-events/verify-level-parity.mjs`: runs every case in `level-cases.json` against the SQL function on the local stack and diffs against the TS output. Wired into `npm run test`. Parity failure fails the build.

Derivation order, applied in this sequence, highest wins:

1. Start at the tile's base level (Fall 2, Hurt 1, Sick 2, Upset 1, Wandering 1, Medicine 1, Family 1, Building 1).
2. Apply each answer rule from §2.1 as a minimum (`level = max(level, rule)`).
3. Apply resident context: active watch instance raises Fall and Sick by one; `elopement_risk = true` raises Wandering by one; a prior `unexplained_bruise` in 30 days raises Hurt-unknown-cause to 3.
4. Apply the reporter bump.
5. Clamp to 1 to 4.

Flags derived alongside the level:

| Flag | Set when |
|---|---|
| `ahca_reportable` (pending admin confirmation) | Level 4 from Fall, Sick, Wandering not found, Medicine reaction, Building danger; any `abuse_allegation` or `neglect_allegation`; any transfer out. Mirrors s. 429.23(2): death, brain or spinal damage, permanent disfigurement, fracture or dislocation, condition requiring transfer to more acute care, event reported to law enforcement, elopement placing the resident at risk. |
| `insurance_reportable` | Level 3 or 4; any elopement; any abuse or neglect allegation (spec 07 threshold, unchanged). |
| `dcf_report_required` | `abuse_allegation`, `neglect_allegation`. |
| `grievance_clock` | Family or complaint, "Resident complaint about care." |
| `neuro_checks` | Fall with head Yes or Not sure. |
| `call_911_prompt` | Any Level 4 from Fall, Sick, Wandering, Building danger. |

**The factual sentence.** The engine composes Section 1 of the paper form from the answers so `incidents.description` and `immediate_actions` are satisfied without typing: *"Found on the floor in the resident room at 10:05 PM. Not witnessed. Hurt a little: bruise. Did not hit head. Not going out. First aid given."* The optional voice note is appended verbatim under "Staff note:". Facts, not assumptions, in the reporter's tap choices.

---

## 4. What fires at each level

Routing reads configuration, never names. Targets come from `notification_routes` (exists: `severity_min`, `channels`, `staff_role_targets`) plus `on_call_schedules` (exists) for the phone. COL's seed for Homewood is decision D1; the default below uses HAVEN_BRAIN §4's standard audience.

| Level | Word | Who is told | Channels | Must acknowledge | Escalation if no acknowledgment | Auto follow-ups | Clocks |
|---|---|---|---|---|---|---|---|
| 1 | Note | Nobody is interrupted. Appears on the Administrator's Today board and in the next shift handoff. | in_app | No | None | None | None |
| 2 | Heads-up | On-shift Administrator or Assistant | in_app, push | Yes, 30 min | +30 min: on-call primary by SMS | Per `incident_followup_protocols` for the kind (Fall: recheck at 4 h and 8 h, fall risk reassessment 24 h) | None |
| 3 | Urgent | Administrator or Assistant, on-call primary | in_app, push, SMS | Yes, 10 min | +10 min: on-call secondary by SMS and voice; +20 min: corporate route (Jessica, Michelle by role) | Level 2 set plus neuro checks q2h x 24 h when flagged, environment assessment 24 h, care plan review 48 h, RCA 72 h | Grievance 10 and 21 days when flagged |
| 4 | Emergency | Everyone in Level 3 plus owner route and corporate route at once | in_app, push, SMS, voice | Yes, 5 min | +5 min: repeat voice to all targets every 5 min until acknowledged | Level 3 set plus AHCA report preparation task, staff debrief | AHCA preliminary report 1 business day and full report 15 days (`regulatory_reporting_obligations`); insurance carrier notice |

Also on every Level 2 and above: `incidents` row with `allocate_incident_number` (exists), `exec_alerts` row for the in-app feed (exists), the watch protocol trigger (exists, fires on the `incidents` insert), and the care plan review alert trigger (exists). Nothing in this table requires a new trigger on `incidents`; the fan-out function inserts the `incidents` row and the existing triggers do their work.

Delivery is recorded per target per channel in `care_event_deliveries` so "was the Administrator told" is a query, not a checkbox. The manual notified flags on `incidents` become derived: `nurse_notified`/`administrator_notified` are set by the acknowledgment RPC with the acknowledging user and time, never by hand.

SMS and voice go through Twilio. The Twilio BAA is a Day One vendor item. Until it is signed, the dispatcher writes those rows as `skipped` with `reason = 'channel_not_enabled'` and push plus in-app carry the load. The receipt screen tells the reporter which channels actually went out.

---

## 5. The Administrator's second screen

Sections 2 and 4 of the paper form, on a phone, in under a minute.

**The card (push notification opens it).** Resident, tile word, level word, the factual sentence, reporter, time since, photo thumbnail. Two buttons: **I've got it** (acknowledge; stops the escalation clock; stamps `administrator_notified_at`) and **Call [reporter first name]**.

**The completion form.**

| Field | Control | Writes |
|---|---|---|
| Family notified | One tap: "Yes, now" stamps time and user; or "Later" | `incidents.family_notified`, `_at`, `_by`, `_method` |
| Physician notified | Same | `incidents.physician_notified`, `_at`; orders in an optional voice note |
| EMS or 911 | Same | `incidents.injury_treatment = 'er_visit' or 'hospitalization'` |
| Corrective action | Chips: Care plan review, Room or furniture change, Equipment fixed, Increased checks, Staff retrained, Other (voice) | `incidents.resolution_notes`, `care_plan_updated` |
| AHCA reportable (Level 3 and 4 only) | Yes / No plus one reason chip from the s. 429.23 list | `incidents.ahca_reportable`; on Yes, `regulatory_reporting_obligations` rows for 1 business day and 15 days |
| DCF report made (abuse or neglect only) | Yes with time / Not yet | `care_events.answers -> admin.dcf_reported_at` |
| Video secured | Yes / No / Not applicable | `care_events.answers -> admin.video_secured` |
| Lower the level | Only here, requires a reason chip | `care_events.final_level`, `level_changed_by`, `level_change_reason` |
| Close | One button, enabled when required fields for the level are present | `care_events.status = 'closed'`, `incidents.status = 'resolved'` |

Witness statements (Section 3): every staff member on the shift gets a "Witness statement for HOM-2026-0007" task in their follow-ups list; a voice note satisfies it. The RCA workspace stays as it is for Level 3 and 4; the "Root cause narrative" textarea should accept the transcribed voice note.

---

## 6. Data model: exists, extend, build

Migrations start at `400`. Naming law applies: `organization_id`, `user_profiles`, integer cents where money appears (none here), text plus CHECK for new enums to match module 07's mixed pattern.

### 6.1 Exists, reuse as is

`incidents`, `incident_followups`, `incident_photos`, `incident_sequences`, `allocate_incident_number()`, `regulatory_reporting_obligations`, `notification_routes`, `on_call_schedules`, `exec_alerts`, `notification_subscriptions`, `dispatch-push`, `resident_watch_protocols` and `auto_trigger_watch_protocol()`, `care_plan_review_alert_raise()`, `behavioral_logs`, `condition_changes` (has `linked_incident_id`), `observation_vocab` (location chips), `grace-transcribe`, `shift_handoffs.auto_summary`, `currentShiftForTimezone`, `loadCaregiverFacilityContext`, `fetchCaregiverResidentProfile`.

### 6.2 Build

**`400_care_events.sql`**

```sql
CREATE TABLE public.care_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  resident_id uuid REFERENCES public.residents(id),
  client_event_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('fall','injury_found','condition_change','behavior','wandering','medication','family_complaint','environment')),
  answers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
  derived_level incident_severity NOT NULL,
  final_level incident_severity NOT NULL,
  level_bumped_by_reporter boolean NOT NULL DEFAULT false,
  level_changed_by uuid REFERENCES public.user_profiles(id),
  level_changed_at timestamptz,
  level_change_reason text,
  category incident_category NOT NULL,
  flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  sentence text NOT NULL,
  note text,
  occurred_at timestamptz NOT NULL,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  shift shift_type NOT NULL,
  location_code text,
  reported_by uuid NOT NULL REFERENCES public.user_profiles(id),
  captured_offline boolean NOT NULL DEFAULT false,
  incident_id uuid REFERENCES public.incidents(id),
  behavioral_log_id uuid REFERENCES public.behavioral_logs(id),
  condition_change_id uuid REFERENCES public.condition_changes(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','closed')),
  acknowledged_by uuid REFERENCES public.user_profiles(id),
  acknowledged_at timestamptz,
  closed_by uuid REFERENCES public.user_profiles(id),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (organization_id, client_event_id)
);
CREATE INDEX idx_care_events_resident ON public.care_events (resident_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_care_events_facility_open ON public.care_events (facility_id, final_level, occurred_at DESC) WHERE deleted_at IS NULL AND status <> 'closed';
CREATE INDEX idx_care_events_reporter ON public.care_events (reported_by, occurred_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE public.care_event_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid NOT NULL REFERENCES public.facilities(id),
  care_event_id uuid NOT NULL REFERENCES public.care_events(id) ON DELETE CASCADE,
  escalation_step integer NOT NULL DEFAULT 0,
  target_role text,
  target_user_id uuid REFERENCES public.user_profiles(id),
  target_phone text,
  channel text NOT NULL CHECK (channel IN ('in_app','push','sms','voice')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed','skipped','acknowledged')),
  skip_reason text,
  provider_message_id text,
  error_message text,
  send_after timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_care_event_deliveries_queue ON public.care_event_deliveries (status, send_after) WHERE status = 'queued';
CREATE INDEX idx_care_event_deliveries_event ON public.care_event_deliveries (care_event_id, escalation_step);

CREATE TABLE public.incident_followup_protocols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid REFERENCES public.facilities(id),
  kind text NOT NULL,
  min_level incident_severity NOT NULL,
  requires_flag text,
  task_type text NOT NULL,
  description text NOT NULL,
  due_offset_minutes integer NOT NULL,
  repeat_every_minutes integer,
  repeat_until_minutes integer,
  assign_to_role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE public.care_event_escalation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  facility_id uuid REFERENCES public.facilities(id),
  level incident_severity NOT NULL,
  ack_within_minutes integer,
  step integer NOT NULL,
  after_minutes integer NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('route','on_call_primary','on_call_secondary')),
  notification_route_id uuid REFERENCES public.notification_routes(id),
  channels text[] NOT NULL,
  repeat_every_minutes integer,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (organization_id, facility_id, level, step)
);

ALTER TABLE public.notification_routes ADD COLUMN IF NOT EXISTS user_targets uuid[];
```

`notification_routes.user_targets` is the "approved explicit-recipient extension" HAVEN_BRAIN §6.4 allows, so Michelle and Jessica can be routed by subscription without a role hack. Both still appear as configuration rows, never in code.

**`401_care_events_rls.sql`**: RLS on all four tables. Insert `care_events`: `owner, org_admin, facility_admin, manager, admin_assistant, coordinator, med_tech` (the retired `nurse` and `caregiver` folded into `med_tech`, migration 468) within `haven.accessible_facility_ids()`. Select: same roles within facility, `family` excluded. Update: reporter may set `note` within 24 hours; admin roles (`owner, org_admin, facility_admin, admin_assistant, manager`) may update status and level fields. Deliveries: select for admin roles and the reporter; insert and update only through definer functions. Protocols and policies: admin roles. Audit triggers `haven_capture_audit_log()` on `care_events` and `care_event_deliveries`; `haven_set_updated_at()` on `care_events`.

**`402_care_events_functions.sql`**

- `public.care_event_derive(p_kind text, p_answers jsonb, p_context jsonb) RETURNS jsonb` (`IMMUTABLE`): the SQL mirror of the level engine. Returns `{level, category, flags, sentence}`.
- `public.submit_care_event(p_payload jsonb) RETURNS jsonb` (`SECURITY DEFINER`, `SET search_path = public, pg_temp`): validates facility access with `haven.accessible_facility_ids()`, upserts on `(organization_id, client_event_id)` for idempotent offline replay, calls `care_event_derive`, applies the reporter bump, inserts `care_events`, then fans out inside the same transaction: `behavioral_logs` row for `behavior`, `condition_changes` row for `condition_change`, `incidents` row for `final_level >= level_2` using `allocate_incident_number` (sets `condition_changes.linked_incident_id` when both), `incident_followups` from `incident_followup_protocols`, `regulatory_reporting_obligations` when `flags.ahca_reportable`, `exec_alerts` row for level 2 and above, `care_event_deliveries` step 0 rows from `care_event_escalation_policies` and `on_call_schedules`. Returns the receipt: `{care_event_id, level, incident_number, deliveries: [{target_name, channel, status}], next_check_at}`.
- `public.acknowledge_care_event(p_care_event_id uuid) RETURNS void`: sets `status = 'acknowledged'`, `acknowledged_by/at`, marks that user's queued deliveries `acknowledged`, sets `incidents.administrator_notified = true, administrator_notified_at = now()` (and `nurse_notified` when the acknowledging user's `app_role = 'med_tech'`), cancels unsent escalation rows.
- `public.complete_care_event_admin_section(p_care_event_id uuid, p_section jsonb) RETURNS void`: writes the §5 fields, lowers level only with a reason, closes when the level's required fields are present.
- `public.care_event_escalation_tick() RETURNS integer`: called by `pg_cron` every minute; for open events past `ack_within_minutes`, inserts the next step's deliveries from `care_event_escalation_policies`.
- `public.v_resident_timeline` view: union of `care_events`, `incidents` (pre-launch rows without a care event), `condition_changes`, `behavioral_logs`, `daily_logs` notes, `resident_observation_logs` exceptions, ordered by time. This is the digital Resident Observation Log.
- `public.v_incident_reports_log` view: the paper Incident Reports Log columns exactly (date, room, resident, fall, bruise, scrapes or burn, cut or laceration or puncture, non-apparent, other, contributing factors, shift) so the surveyor sees a familiar artifact.

**`403_care_events_seed_col.sql`**: `incident_followup_protocols` from spec 07's post-fall table (org-scoped default, `facility_id NULL`), the grievance 10 and 21 day rows, the AHCA report preparation task, the witness statement task. `care_event_escalation_policies` per §4 for `organization_id = '00000000-0000-0000-0000-000000000001'`. `notification_routes` rows: "Administrator or Assistant" (`staff_role_targets = '{administrator,assistant_administrator}'`, both values exist on `staff_role`; `app_role` fallback `facility_admin, admin_assistant`; `severity_min = level_2`), "Corporate" (`user_targets` empty until D1 names them, `severity_min = level_3`), "Owner" (`severity_min = level_4`). No named person in the migration; Jessica and Michelle are added through the settings page after D1.

**Cron.** The repo has no `cron.schedule` statements in migrations; the hosted jobs were created on the project directly. Ship `scripts/care-events/cron-schedules.sql` with the two statements (`care_event_escalation_tick()` every minute; `care-event-dispatcher` every minute with the `Authorization: Bearer <anon key>` and `x-cron-secret` headers the other function jobs use) for Brian to run on the hosted project. Do not run it from the build.

**Photos.** `incident_photos.storage_path` exists; no `storage.buckets` migration for it was found. `400` creates a private `incident-photos` bucket with policies scoped by `haven.accessible_facility_ids()` if the bucket does not already exist on the hosted project (check first; the migration must be idempotent).

**Edge Function `care-event-dispatcher`** (Deno, `supabase/functions/care-event-dispatcher`): cron every minute. Drains `care_event_deliveries` where `status = 'queued' AND send_after <= now()`. `in_app` marks sent (the `exec_alerts` row already exists). `push` calls `dispatch-push` with `x-dispatch-secret`. `sms` and `voice` call Twilio when `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and `CARE_EVENT_SMS_ENABLED=true` are set; otherwise marks `skipped` with `skip_reason = 'channel_not_enabled'`. Message bodies carry no PHI beyond first initial and last name, room, tile word, level word, and a deep link; the detail lives behind sign-in. Logs with `withTiming` like the other functions.

### 6.3 Extend

- `src/lib/incidents/workflow-obligations.ts`: replace the hardcoded list with a function that takes the facility's routes and the delivery ledger. "Notify the nurse" becomes "Administrator acknowledged 10:07 PM (push, 2 min)" or "Administrator not yet acknowledged (escalated to on-call 10:16 PM)."
- `src/lib/incidents/incidents-display-copy.ts`: add `formatLevelWord(level)` returning Note, Heads-up, Urgent, Emergency. Every surface that shows `L1`..`L4` uses it. Raw `level_2` never reaches the screen (Quiet Operator rule 4).
- `AdminIncidentsPageClient.tsx`: "Begin Triage" calls `acknowledge_care_event` when the incident has a care event, otherwise keeps the link. Add the **Today** strip above the follow-up pressure band: acknowledgment queue (events past `ack_within_minutes` with no acknowledgment, red), open AHCA clocks with hours remaining, events by level today.
- `AdminIncidentDetailPageClient.tsx`: notification log reads `care_event_deliveries`; the notify buttons become the §5 completion form.
- `AppShell.tsx` "Report incident" and the floor-app home tile route to `/caregiver/report`. `/caregiver/incident-draft` becomes a redirect. The resident hub gains the primary **Something happened** button above the action grid; Behavior and Condition tiles deep-link into `/caregiver/report?resident=<id>&kind=behavior` and `&kind=condition_change`.
- `shift_handoffs.auto_summary` builder includes every `care_events` row from the outgoing shift grouped by level, so Level 1 notes reach the next shift without anyone re-typing them.
- Resident profile (admin and floor app): new **Timeline** tab reading `v_resident_timeline` (Tier 3).

### 6.4 New routes and components

| Route | Purpose |
|---|---|
| `/caregiver/report` | The three-tap flow. Client component tree: `ReportWhoStep`, `ReportWhatStep`, `ReportHowBadStep`, `ReportReceipt`. State in a small reducer; the level engine runs on every answer change for the live banner. |
| `/caregiver/report/[careEventId]` | Receipt revisit: add photo, add voice note, see acknowledgment. |
| `/admin/care-events/[id]` | The administrator's card and completion form (phone-first, also fine on desktop). Linked from the push notification deep link and from the incident detail page. |
| `/admin/incidents` | Existing Kanban plus the Today strip. |
| `/admin/residents/[id]?tab=timeline` | Tier 3 timeline. |

Component floor: 56 px tap targets on `/caregiver/report`, one question row per line on phones, WCAG AA contrast, `prefers-reduced-motion` respected, no browser-native select anywhere in the flow (Quiet Operator reject list).

---

## 7. What management gets

Three tiers, per the project's UI law.

**Tier 1, Administrator, "Today at Homewood."** Events today by level word. Acknowledgment queue with age. Open AHCA clocks with hours remaining. Overdue follow-ups. Nothing else on the first screen.

**Tier 1, Jessica and Michelle, five buildings.** One row per building: events by level (7 days), median acknowledgment time for Heads-up and above, escalations that reached step 2 or later, open AHCA clocks, overdue follow-ups. Color by the constitution's incident thresholds (0 neutral, 1 to 3 neutral, 4 to 10 amber, above 10 red) applied to Level 2 and above only, so Notes never paint a building red.

**Tier 2.** The existing incident detail, the care event card, the Kanban.

**Tier 3.** RCA workspace (exists), Trends (exists), the resident Timeline, the Incident Reports Log export, and the delivery ledger per event.

Metrics that only exist because Level 1 is now captured instead of lost:

| Metric | Why Milton and Jessica want it |
|---|---|
| Falls per 1,000 resident-days (spec 07, exists) | Survey and insurance baseline |
| Events per resident, 30 days, with "3 or more" surfacing a care plan review | Finds the resident whose pattern nobody has connected |
| Near-miss ratio: Notes to Heads-up and above | A building with many Notes per Urgent is reporting. A building with none is hiding. This is the culture gauge. |
| Reporting rate per reporter per shift | The silence detector. A shift that logs nothing for a week is a training or trust problem, not a quiet week. |
| Acknowledgment latency p50 and p90 by building and shift | Whether the Administrator or Assistant is reachable on nights and weekends |
| Escalations that reached step 2 or later | The on-call ladder is real or it is not |
| Time-of-day and shift heat map by kind | Staffing and med-pass timing decisions |
| AHCA clocks met or missed | The one number a surveyor asks first |
| Unexplained bruises per resident and per shift | Abuse screen |

All of these are single queries over `care_events`, `care_event_deliveries`, and `incident_followups`. None require a new trends table; `exec-kpi-snapshot` can add them to the existing KPI catalog.

---

## 8. Owner decisions before build

Label these `Darren Decision` or route to Jessica per the operating system spec. None block migrations `400` to `402`; D1 and D2 block the seed in `403` and the Homewood go-live of this flow.

| # | Decision | Owner | Default if unanswered |
|---|---|---|---|
| D1 | Who is the Level 2 target at each building on each shift, and who is on the corporate route. "Administrator or Assistant" per the 2019 procedure, plus Michelle and Jessica by role or explicit subscription. Nurse is not a COL escalation target unless Jessica says a building has one (and since COL-615 there is no nurse login role). | Jessica | Routes seeded to `facility_admin` and `admin_assistant`; corporate route empty until named |
| D2 | Floor level for a witnessed fall with no injury. Spec 07 says Level 1 (log only). The 2019 procedure says notify the Administrator for every incident. | Jessica | Level 2 (Heads-up). Safer, and the Administrator sees a push instead of finding it on the board |
| D3 | Acknowledgment windows: 30, 10, and 5 minutes for Levels 2, 3, 4. | Jessica | As written in §4 |
| D4 | Does a Level 1 Note appear in the family portal activity feed. | Jessica, then Milton | No. Portal shows activities, billing, admin notes only (§5.8) |
| D5 | Twilio for SMS and voice, BAA signed, budget line. | Darren | Push and in-app only until signed; SMS rows marked skipped |
| D6 | Grievance handling inside this flow or as its own module. | Jessica | Inside: Level 2 with the 10 and 21 day follow-up rows |
| D7 | Should med tech "Refused" write to the eMAR record directly. | Jessica with Brian (QuickMAR boundary, §11 #20) | No. Level 1 note with a reminder; eMAR remains the record |

---

## 9. Acceptance

Each item is a transcript-visible check for the build run.

1. `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` exit 0. `npm run test` includes `level-cases.json` parity across TS and SQL.
2. Migrations `400` to `403` replay clean on a throwaway Postgres (`npm run migrations:verify:pg`) and `npm run migrations:check` passes.
3. Playwright (`playwright.homewood.config.ts` project) walks the three taps for each of the eight tiles and asserts: no text input is required to submit; the level word in the banner matches `level-cases.json`; submit returns a receipt with an incident number for Level 2 and above and none for Level 1.
4. A Level 3 Fall submitted as `med_tech` produces, visible in the transcript by query: one `care_events` row, one `incidents` row with `fall_witnessed` and `injury_severity` set from the answers, `incident_followups` rows matching the seeded protocol, one `resident_watch_instances` row, one `care_plan_review_alerts` row, one `exec_alerts` row, and `care_event_deliveries` rows for push and in_app with `sms` marked `skipped` when Twilio is not configured.
5. A Level 4 Wandering "Not found yet" produces `regulatory_reporting_obligations` rows at plus 1 business day and plus 15 days and `flags.ahca_reportable = true`.
6. `acknowledge_care_event` as `facility_admin` sets `incidents.administrator_notified_at` and cancels queued step 1 deliveries; `care_event_escalation_tick` inserts step 1 rows for an unacknowledged Level 3 after 10 minutes in a clock-advanced test.
7. Offline replay: submitting the same `client_event_id` twice returns the same `care_event_id` and creates no second incident.
8. RLS: `family` cannot select `care_events`; `med_tech` at facility A cannot read facility B's rows; `med_tech` cannot update `final_level`.
9. No surface renders `level_1`..`level_4` raw; `formatLevelWord` covers every read path (grep in the transcript).
10. `v_incident_reports_log` returns the paper log's columns for Homewood for a seeded month.

---

## 10. Out of scope and forbidden

- No mass alert button for a missing resident. Level 4 Wandering routes to configured roles like every other event.
- No family reply path. Level words never appear in the portal.
- No named person in code or migrations. Routes and subscriptions only.
- No new rounds tables; the Smart Rounding observation model is untouched. A Level 2 and above event may create a watch instance through the existing trigger, nothing more.
- No automatic mutation of medication orders or eMAR records from a Medicine event.
- No PHI in push or SMS bodies beyond first initial, last name, room, tile word, level word.
- No Florida rule in a code path. Timers, reportability reasons, grievance windows, and acknowledgment windows live in `care_event_escalation_policies`, `incident_followup_protocols`, and the `flags` derivation table, keyed by `jurisdiction` where the underlying table has one.
- The RCA workspace, Trends, and Lifecycle Blockers pages are not redesigned in this run; they gain the level word and the delivery ledger and nothing else.

---

## Appendix A. COL paper artifacts this replaces

| Paper | Haven equivalent |
|---|---|
| Incident Form, Section 1 (type, first aid, facts) | Tap 2 and Tap 3 answers plus the generated sentence |
| Incident Form, Section 2 (family, physician, EMS with time) | Administrator completion form |
| Incident Form, Section 3 (witnesses) | Witness statement follow-up tasks, voice note accepted |
| Incident Form, Section 4 (corrective action) | Administrator completion form chips plus voice |
| Witness / Interview Statement | Same follow-up task |
| Resident Observation Log | `v_resident_timeline`, the resident Timeline tab |
| Incident Reports Log | `v_incident_reports_log` export |
| Elopement Incident Form | Wandering tile answers plus the Level 3 and 4 completion fields (last seen, located, condition, family, physician, online adverse report) |
| Medication Incident Report | Medicine tile answers plus the completion form (provider notified, how discovered, prevention); the 5 Rights in-service becomes a `staff_retrained` corrective chip that opens an in-service log entry |

## Appendix B. Source files read for this spec

`docs/specs/07-incident-reporting.md`; migrations `001`, `017`, `021`, `022`, `023`, `055`, `058`, `070`, `098`, `129`, `156`, `180`, `181`, `204`, `219`, `310`, `394`; `src/app/(caregiver)/incident-draft/page.tsx`; `src/app/(caregiver)/resident/[id]/page.tsx`; `src/app/(caregiver)/caregiver/page.tsx`; `src/app/api/med-tech/incidents/route.ts`; `src/components/incidents/*`; `src/lib/incidents/*`; `supabase/functions/observation-escalation-engine`, `dispatch-push`; COL paper forms: Incident Reporting Procedure, Incident Reports Log, Resident Observation Log, Elopement Incident Form, Medication Incident Report; Fla. Stat. 429.23 (adverse incident definition and 1 business day / 15 day reports).
