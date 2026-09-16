# 25A. Smart Rounding: Cadence, Monitoring Orders, Watchlist, and Settings

> **Target path in repo:** `docs/specs/25A-smart-rounding-cadence-and-watchlist.md`
> This spec covers both the observation model (cadence, capture, escalation) and the Resident Assurance surface (`docs/specs/25-resident-assurance-engine.md`), which is why it carries the `25A` suffix.

**Source of the decisions in this spec:** COO interview, 2026-09-16, plus owner decisions recorded the same day. This spec supersedes the cadence decided 2026-08-14 in migration `310`.

**Authority:** This spec is build authority for this scope. Where it conflicts with `AGENTS.md` or `CODEX.md` on process or security, those win and the conflict is recorded. `HAVEN_BRAIN.md` is domain supplement only.

**Migration allocation for this build.** The spec text names migrations `404` through `410`. At the branch point the repo head was `411`, so this build allocates the next seven sequential numbers, `412` through `418`, keeping the suffixes. Read the mapping in section 9.

---

## 1. Decision record

Eight decisions were made 2026-09-16. Each is binding for this scope.

| # | Decision | Supersedes |
|---|---|---|
| 1 | Six observation windows per resident per 24 hours: 6:00a, 10:00a, 2:00p, 6:00p, 10:00p, 2:00a. Three per 12-hour shift. | Migration `310` times, all five facilities |
| 2 | Grace is 60 minutes, not 30. Shift-change windows are asymmetric: 0 before, 60 after. | `310` uniform 30-minute grace |
| 3 | Applies to all five facilities, not Homewood only. | `310` per-facility presets and the Plantation wing stagger |
| 4 | Capture is chip-composed narrative: chips assemble a sentence, free text appends, chips required, note optional. | `310` dropdown-only capture |
| 5 | Elevated monitoring is a **Monitoring Order**: a clinical instruction with an interval, a window, an ordering party, and a reason. Any staff member on the floor can enter one and it takes effect immediately. No approval queue. | The pending-watch approval queue on the current Watches tab |
| 6 | A Monitoring Order replaces the standard windows for that resident while active, and any order check falling inside a standard window satisfies that window in the compliance record. | Nothing; new behavior |
| 7 | Escalation fires at 30, 60, and 90 minutes past the close of the grace window. | `310` ladder measured from grace close at 0, +30, +60 |
| 8 | Every window time, grace value, escalation offset, recipient role, delivery channel, and shift definition is per-facility configuration, editable by an administrator without a migration or a deploy. Decisions 1 through 7 are the **seeded defaults**, not constants. | Cadence hardcoded in `219` and `310` |

**Closes open decision #20** in `HAVEN_BRAIN.md` (observations versus QuickMAR narrative): QuickMAR stays the system of record for medication administration. Observation narrative is Haven only. Haven does not ingest QuickMAR narrative for this scope and does not write to QuickMAR. There is no duplicate-documentation exemption; a med pass is evidence that a caregiver was in the room, it does not satisfy an observation window.

**Cadence load, for the record.** The COO model reduces documentation. At Homewood, `310` generates ten checks per resident per day (four day plus every two hours overnight). This spec generates six. At the other four facilities `310` generates seven; this spec generates six. The 5:30p and 5:30a checks in `310` were the outgoing shift's last look. The 6:00a and 6:00p checks here are the incoming shift's first look, which is the direction that assigns accountability at handoff.

---

## 2. Cadence model

### 2.1 The six windows

Facility-level configuration. Every active resident at the facility inherits it. There is no per-resident plan for standard cadence.

**These times are the seeded default, not a constant.** Section 6 is the settings surface that edits them per facility. Nothing below may be written as a literal in code.

| Key | Due | Grace before | Grace after | Window | Shift | Owner |
|---|---|---|---|---|---|---|
| `shift_change_am` | 06:00 | 0 | 60 | 06:00 to 07:00 | day | incoming day staff |
| `mid_morning` | 10:00 | 60 | 60 | 09:00 to 11:00 | day | day staff |
| `afternoon` | 14:00 | 60 | 60 | 13:00 to 15:00 | day | day staff |
| `shift_change_pm` | 18:00 | 0 | 60 | 18:00 to 19:00 | night | incoming night staff |
| `evening` | 22:00 | 60 | 60 | 21:00 to 23:00 | night | night staff |
| `overnight` | 02:00 | 60 | 60 | 01:00 to 03:00 | night | night staff |

All times are facility-local (America/New_York for all five COL facilities). Store and compare in UTC; render in facility-local. Windows never overlap and the largest unobserved gap is 03:00 to 06:00.

### 2.2 Why shift-change grace is one-sided

A symmetric 60-minute grace would open the 06:00 window at 05:00, which lets the outgoing night shift clear it before the incoming day shift arrives. The entire purpose of the shift-change check is that the incoming shift has laid eyes on every resident before taking responsibility for them. `grace_before_minutes = 0` on both shift-change windows is a requirement, not a preference.

The task for a shift-change window is assigned to staff whose shift **begins** at that time. Where no incoming staff row exists for the shift, the task is assigned to the facility pool and is satisfiable by any staff member with observation permission at that facility.

### 2.3 Shifts

COL runs two 12-hour shifts at all five facilities: `day` 06:00 to 18:00, `night` 18:00 to 06:00. There is no evening shift. Any daypart model with three values is wrong and must be removed from this module. The Overview cycle header, the task generator, the reports tab, and the shift-summary card all read from the two-shift model.

### 2.4 Task generation

`observation-task-generator` generates one shift ahead, not eight hours. Generating a full 12-hour shift means a caregiver coming on at 06:00 sees all three of their windows immediately. The Plans page control reads **Generate next shift**.

Generation is idempotent per `(resident_id, window_key, service_date)`. Re-running produces no duplicates.

Residents in status `hospital_hold`, `loa`, `discharged`, and `deceased` generate no tasks. Status changes mid-shift cancel remaining tasks for that resident rather than leaving them to go overdue.

### 2.5 Plantation

`apply_plantation_wing_observation_plan` staggered observation times across Plantation's wings. The COO cadence is uniform and has no wing concept. This spec applies the same six windows at Plantation.

Do not drop the function. Mark it deprecated, leave it callable, and record an open item: **Plantation wing stagger retired by the 2026-09-16 cadence decision; the Director of Operations to confirm whether the stagger existed for a staffing constraint at 64 beds that the uniform cadence reintroduces.** This is an owner decision, not a code cleanup.

---

## 3. Capture model

### 3.1 Chips compose the sentence

An observation is recorded by tapping chips. The chips assemble a readable sentence at submit time. Free text appends to it and is never required.

Existing required fields from migration `310` are retained: `resident_location`, `resident_state`, `quick_status`. The first two are sourced from `observation_vocab` (`field_name` values `location` and `state`); `quick_status` is the `resident_observation_quick_status` enum on the log row. Extend `observation_vocab`, do not replace it.

Three chip groups are added. Each is optional individually; at least one must be present alongside the retained required fields.

| Group | Values |
|---|---|
| `meal_intake` | ate well, ate some, refused meal, ate in room, no meal this window |
| `mood_state` | pleasant, quiet, grouchy, agitated, confused, tearful |
| `med_response` | took meds, refused meds, no meds this window |

**`refused meds` records an observation only.** It does not write to, read from, or reconcile against any medication order, MAR row, or QuickMAR artifact. Automatic mutation of medication records is forbidden.

### 3.2 Composed narrative

The submit RPC composes a sentence from the selected chips at write time and stores it. The composition is stored, not derived on read, so the historical record is immutable even if vocabulary changes later.

Storage: `composed_summary text NOT NULL` on the log row, plus the existing free-text `note` column for the staff note. Display concatenates the two.

Example: chips `ate well`, `pleasant`, `dining room` compose to `Ate lunch well, pleasant, in dining room.` Staff note appends `Daughter visited.`

### 3.3 The free-text rule is unchanged

Free-text-required observations are forbidden. This spec does not violate that. Chips are required, free text is optional, and no observation is failed or nagged for a missing note. What changed is that the chips now compose a sentence instead of storing two dropdown values, which is what makes the record readable to a family member or a surveyor.

### 3.4 Speed target

A caregiver covering half a 36-bed building records one window for 18 residents in one pass. Target is 10 seconds per resident with no typing. The capture surface stays on one screen with no navigation between chip groups and no browser-native select or textarea chrome.

### 3.5 Assignment

Tasks divide across staff on duty by the existing shift and resident-assignment model (`shift_assignments.assigned_resident_ids`). Do not add a `cart_assignments` table.

Assignment determines whose task list a window appears on. It does not restrict who may record. Any staff member with observation permission at that facility may record any resident's check, because the person who witnesses something is not always the person assigned. The log records both the observer and whether the observer was the assigned staff member.

---

## 4. Monitoring Orders

### 4.1 What it is

A Monitoring Order is a clinical instruction to observe a resident more often than the standard cadence, for a defined window, at a defined interval, requested by a named party for a stated reason.

The typical origin is a physician, a hospital discharge instruction, or a visiting nurse. The facility can also originate one. The ordering party carries the authority; the staff member keying it in does not need rank.

**Name.** The operator-facing term is **Monitoring Order**. Not "watch." A watch implies the facility chose it, and most of the time a clinician did. The Watches tab is replaced.

### 4.2 Fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `resident_id` | uuid | yes | |
| `interval_minutes` | integer | yes | 30, 60, 120, 240, or custom between 15 and 720 |
| `starts_at` | timestamptz | yes | defaults to now |
| `ends_at` | timestamptz | no | null means open-ended |
| `review_due_at` | timestamptz | yes when `ends_at` is null | forces a decision instead of an order running forever |
| `ordered_by_type` | text + CHECK | yes | `physician`, `hospital_discharge`, `home_health_nurse`, `hospice_nurse`, `facility_nurse`, `facility_admin` |
| `ordered_by_name` | text | yes | free text, the ordering person or facility |
| `order_received_as` | text + CHECK | yes | `verbal`, `written_order`, `discharge_paperwork`, `fax` |
| `reason_category` | text + CHECK | yes | `post_hospital_return`, `post_fall`, `change_in_condition`, `behavior`, `skin_or_wound`, `elopement_risk`, `other` |
| `reason_note` | text | yes | |
| `document_path` | text | no | private storage path for discharge paperwork |
| `entered_by` | uuid to `user_profiles(id)` | yes | |
| `status` | text + CHECK | yes | `active`, `completed`, `cancelled`, `expired` |
| `cancelled_by`, `cancelled_at`, `cancel_reason` | | conditional | required together when status is `cancelled` |

Append-only history on status transitions. Audit trigger on every mutation.

### 4.3 Behavior

**Immediate effect.** `create_monitoring_order` sets status `active` and the next generated task appears on the live board within the generator's next tick. There is no approval gate and no pending state. The facility administrator and the standing alert audience are notified through `notification_routes`, not asked.

**Replacement with absorption.** While an order is active for a resident:

- the standard six windows stop generating for that resident
- order tasks generate at `interval_minutes` from `starts_at`
- any completed order check whose observation time falls inside a standard window's span marks that standard window satisfied in the compliance record

Absorption is what keeps the compliance report honest. A resident on 30-minute checks is observed far more than the standard requires, and the daily compliance view must not report them as missing six windows. Absorption is implemented as a view computed from `resident_observation_logs`, not by generating phantom standard tasks.

**Expiry.** A scheduled job sets status `expired` when `ends_at` passes. An order with a `review_due_at` in the past surfaces on the Watchlist as a signal and does not silently expire.

### 4.4 Interaction with `resident_watch_instances`

Migrations `400` to `403` were expected to carry a trigger that creates a `resident_watch_instances` row from a Level 2 or higher care event. **At the branch point that trigger does not exist**; `402_care_events_functions.sql` only reads the table. Do not modify the care-event functions and do not drop the table.

Add an `AFTER INSERT` trigger on `resident_watch_instances` that creates a corresponding `resident_monitoring_orders` row with `ordered_by_type = 'facility_nurse'`, `order_received_as = 'written_order'`, and `reason_category` derived from the triggering source. Backfill existing rows in the same migration. Monitoring Orders becomes the single operator-facing model; `resident_watch_instances` remains the care-event integration point for whenever that trigger lands.

### 4.5 Entry surface

A **Monitoring Order** button on the resident record, tier 2. Not buried in Smart Rounding. A caregiver holding discharge paperwork at 21:00 opens the resident and enters the order in under a minute on a phone.

Active orders render on the resident record as a persistent band showing interval, reason, ordering party, and remaining window.

---

## 5. Escalation

### 5.1 Ladder

Measured from `window_close = due_at + grace_after_minutes`.

| Rung | Trigger | Recipient |
|---|---|---|
| nudge | `window_close` minus 15 min | assigned staff only, push |
| tier 1 | `window_close` plus 30 min | assigned staff plus facility administrator |
| tier 2 | `window_close` plus 60 min | administrator plus standing alert audience via `notification_routes` |
| tier 3 | `window_close` plus 90 min | the facility's 60-minute protocol and 911 decision rule |

The nudge is a staff-only reminder and is not an escalation. It exists because a 15-minute warning catches most misses before they reach anyone, which is what keeps tier 1 volume low enough that an administrator still reads it.

**Recorded honestly:** under `310`, a 10:00 window with 30-minute grace reached the administrator at 10:30. Under this spec, with 60-minute grace, a 10:00 window reaches the administrator at 11:30. The first human-visible alert is one hour later than today. That is the cost of the grace the COO specified. Every rung lives in the policy table, so moving tier 1 to `window_close` plus 0 is a configuration change, not a code change.

### 5.2 Interval-scaled grace

A 60-minute grace on a 30-minute Monitoring Order is incoherent. Grace scales with interval:

```
grace_minutes = LEAST(60, GREATEST(10, CEIL(interval_minutes / 4.0)))
```

| Interval | Grace |
|---|---|
| 30 min | 10 min |
| 60 min | 15 min |
| 120 min | 30 min |
| 240 min (standard) | 60 min |

The standard cadence falls out of the same formula, so there is one rule, not two.

### 5.3 Policy table

Rungs, offsets, recipients, channels, and the tier 3 protocol are rows in a facility-scoped policy table, not constants in `observation-escalation-engine`. No Florida rule and no COL-specific timer in a code path. Section 6 is the surface that edits them, including per-shift overrides and per-channel routing.

---

## 6. Cadence and Escalation Settings

### 6.1 Principle

Everything in sections 2 and 5 is **seeded configuration, not code**. The cadence migration seeds the six windows and the escalation migration seeds the 30/60/90 ladder, and from that point every time, every grace value, every escalation offset, every recipient role, and every delivery channel is editable per facility by an administrator without a migration, a deploy, or a developer.

No observation time, grace value, escalation offset, recipient, or channel may appear as a literal in any TypeScript file, Edge Function, or SQL function body. They are rows.

### 6.2 What is editable, per facility

| Object | Editable |
|---|---|
| Shift definitions | key, label, start and end local time, count |
| Observation windows | key, label, due local time, grace before, grace after, shift, enabled |
| Escalation rungs | key, offset from window close, target roles, channels, per-shift override, enabled |
| Terminal protocol | the tier 3 rule text and its offset, never its existence |
| Monitoring Order intervals | the preset list offered in the picker, and the grace formula divisor |
| Watchlist signal rules | threshold, lookback days, severity class, enabled |
| Gap and load thresholds | maximum unobserved gap warning, maximum windows per resident per day |

### 6.3 Versioning, and why it is not optional

Configuration is versioned and effective-dated. A change creates a new version. It never mutates the version that was in force.

`resident_observation_tasks` carries `cadence_version_id`, stamped at generation. Compliance reports, the Integrity tab, and every export read the stamped version, not current configuration.

Without this, changing the 10:00 window to 11:00 in March silently rewrites February's compliance numbers, and an inspector who pulls six months of observation records gets a report computed against times that were not in force. That is the failure mode this whole module exists to prevent.

Escalation versions work the same way. `resident_observation_escalations` carries `escalation_version_id`.

### 6.4 When a change takes effect

Three options on the form. Default is the first.

| Option | Behavior |
|---|---|
| **Next shift boundary** | The new version's `effective_from` is the start of the next shift. Nothing on the current board changes |
| **Scheduled** | Administrator picks a date and time. If it is not a shift boundary, warn and require acknowledgment |
| **Immediately** | Applies to tasks not yet generated. Pending tasks in the current shift are cancelled and regenerated. Requires typed acknowledgment |

**Never, under any option:** a completed task, a missed task, or an escalation already fired is modified. Staff mid-shift do not get the board rearranged under them without an explicit immediate-apply acknowledgment.

### 6.5 Validation

**Hard block. The form does not submit.**

1. Two enabled windows whose grace spans overlap. Overlap means one observation could satisfy two windows, which silently inflates compliance
2. Zero enabled windows on any defined shift
3. `grace_before_minutes` greater than 0 on a window whose due time equals a shift start. The incoming shift must be the one that lays eyes on the resident. This rule derives from the shift definitions, never from hardcoded 06:00 and 18:00
4. Escalation rung offsets not strictly increasing
5. The terminal rung disabled
6. Window frequency below the jurisdiction floor (6.10)

**Warning with typed acknowledgment.** The administrator types the facility name to confirm.

- Largest unobserved gap exceeds the facility's configured threshold
- Total windows per resident per day decreases from the current version
- A target role on any rung has zero holders at that facility right now
- More than 8 windows per resident per day

### 6.6 Preview before commit

Required by the Quiet Operator constitution: configuration forms with consequences preview their effect before commit.

The preview shows, current against proposed:

- A 24-hour strip with each window and its grace span drawn, overlaps in red, the largest unobserved gap labeled
- Windows per resident per day
- Total daily tasks at the facility, computed from the live active-resident count
- Escalation ladder with wall-clock examples for one named window
- Recipient resolution per rung: the roles, and how many people currently hold each at this facility

### 6.7 Replay simulation

A **Simulate** action runs the proposed configuration against the last N days of actual `resident_observation_logs` for that facility and reports what would have happened.

`simulate_cadence_change(facility_id, proposed_cadence_version_id, proposed_escalation_version_id, lookback_days)` returns, for the lookback window:

| Output | Meaning |
|---|---|
| Windows generated | Under the proposed configuration |
| Windows that would have been satisfied | A log exists inside the proposed span |
| Windows that would have been missed | Total and by shift |
| Escalations by rung | How many tier 1, tier 2, tier 3 would have fired |
| Change against actual | Missed and escalation counts under the configuration actually in force |

**Label it honestly on the surface.** The replay assumes staff behavior is unchanged. Staff behavior will change when the schedule changes. It is a measurement against past behavior, not a prediction. The surface says so in one line and does not present it as a forecast.

### 6.8 Templates and multi-facility apply

Named cadence and escalation templates at organization level. A facility is either **on a template** or **custom**.

- `cadence_templates` and `escalation_templates`, organization-scoped, with their own versions
- Seed one: **COL Standard Six**, carrying the six windows, with all five facilities pointed at it
- Editing a template offers to push to every facility on it, with a per-facility diff preview and per-facility effective timing
- Editing a facility directly detaches it to custom, with a warning naming what it will stop inheriting
- A portfolio settings view lists all facilities, the template each is on, custom or inherited, and drift from the template

### 6.9 Escalation detail

**Per shift.** A rung may carry a shift override. Night shift runs one or two staff at Homewood and the timing that is reasonable at 10:00 with three people on the floor is not reasonable at 02:00 with one. Rungs without an override apply to every shift.

**Recipients are roles.** Never a named person, never an email address in a rung row. Roles resolve through `notification_routes` at delivery time.

**Channels per rung, per shift.** `in_app`, `push`, `sms`. The default seed sets night tier 1 to `in_app` only, tier 2 to `in_app` and `push`, tier 3 to `in_app`, `push`, and `sms`.

A tier 1 push at 02:00 every night gets muted within a week, and once the administrator mutes Haven notifications, tier 2 and tier 3 are muted with it. Channel control per rung per shift is what protects the rungs that matter.

**Test send.** `send_test_escalation(facility_id, rung_key)` delivers through the real routing to the real current recipients with `TEST` as the first word of the body. It creates no escalation row and touches no task.

### 6.10 Jurisdiction floor

Multi-state means multi-regulator. A configuration floor keyed by jurisdiction prevents a facility being configured below its regulator's minimum.

`jurisdiction_observation_floors`: jurisdiction, minimum windows per 24 hours, maximum unobserved gap minutes, citation reference, effective dates.

**Seed the table with the `FL_AHCA` row present and its floor values null, marked TBD.** No verified Florida minimum observation frequency exists in repository authority. Do not invent one. With null values the floor check passes and the structure is ready.

### 6.11 Audit, change log, rollback

Every configuration change writes an audit row through `haven_capture_audit_log()` with the actor, the timestamp, the before and after values, and a **required** `change_reason` free text.

The settings page shows the last ten changes inline: who, when, what changed, and why, with a diff view.

**Rollback** creates a new forward version copying an earlier one. It never deletes a version and never rewrites `effective_from` on a version that was in force.

### 6.12 Who can change what

| Action | Roles |
|---|---|
| Edit facility cadence or escalation | `org_admin`, `owner` |
| Propose a change | `facility_admin`, `manager`, creating a `pending_approval` version |
| Approve a proposed change | `org_admin`, `owner` |
| Edit an organization template | `org_admin`, `owner` |
| Simulate, preview, test send | `facility_admin` and above |
| View configuration and change log | `facility_admin` and above |

**This approval gate is deliberate and does not contradict section 4.** A Monitoring Order is a clinical instruction for one resident that cannot wait for a supervisor at 21:00, so it has no gate. A cadence change is policy for an entire building and should not happen without the organization signing off. Different risk, different rule.

**Role literal note.** `assistant_administrator` is a `staff_role` value, not an `app_role` value. The authentication role enum (`app_role`) carries `manager` in that position. Recipient targeting through `notification_routes.staff_role_targets` uses `staff_role` and therefore does carry `assistant_administrator`; SQL permission gates through `haven.app_role()` use `manager`.

### 6.13 Surface

Lives in facility administration, not in the Smart Rounding tab strip. The strip stays at five tabs.

| Tier | Content |
|---|---|
| 1 | The 24-hour window strip, the escalation ladder in wall-clock terms, template name or Custom, and the effective-from date |
| 2 | Editing one window or one rung, with the preview and the simulate action |
| 3 | Version history, the change log with reasons, and rollback |

A read-only view of the current cadence renders on the Smart Rounding Live board header so a caregiver can see the times in force without leaving the board.

---

## 7. Watchlist

Replaces the Safety Scores tab.

### 7.1 Why the composite score goes

The current surface computes a 0 to 100 resident score from observation compliance, incident recency, and medication adherence. Observation compliance and medication adherence measure whether **staff** did their job. Blending them into a number on a **resident** row means a resident drops twenty points because their caregiver ran late, and a reader interprets that as decline.

A composite is also unactionable and undefendable. The operational question is never "what is her score," it is "who do I need to look at today and why."

No score appears on a resident row. Compliance and adherence move to the Integrity tab where they belong, cut by shift, hall, and staff member.

### 7.2 Signals

A signal is a discrete rule with a facility-configurable threshold, stored in a rules table so the full list can be printed and handed to a surveyor.

| Signal key | Rule | Source |
|---|---|---|
| `recent_fall` | any fall in 30 days | `care_events` / `incidents` |
| `repeat_fall` | 2 or more falls in 30 days | same |
| `post_hospital_window` | hospital or ER return in 30 days | `resident_status_history`, OOF `hospitalization` |
| `meal_refusal_trend` | 3 or more refusals in 7 days | observation chips |
| `med_refusal_trend` | 3 or more `refused meds` chips in 7 days | `resident_observation_logs` |
| `behavior_change` | `agitated` or `confused` 3 or more times in 7 days against a 30-day baseline of zero | `resident_observation_logs` |
| `withdrawal` | 0 activity attendance in 10 days where the prior 30-day average was 4 or more | activity attendance |
| `night_restlessness` | not `resting in bed` or `sleeping` at the `overnight` window on 4 or more of 7 nights | `resident_observation_logs` |
| `active_monitoring_order` | any active order | `resident_monitoring_orders` |
| `monitoring_order_review_overdue` | `review_due_at` in the past, status still `active` | same |
| `elopement_or_wandering` | any event in 90 days | `care_events` |
| `care_plan_review_overdue` | past due | `care_plan_review_alerts` |
| `form_1823_due` | due within 30 days | 1823 renewal at 11 months |
| `observation_gap` | 2 or more consecutive missed windows | `resident_observation_tasks` |
| `weight_loss` | 5 percent in 30 days or 10 percent in 180 days | `daily_logs.weight_lbs` |

**`weight_loss` source.** `daily_logs.weight_lbs` (migration `015`) is the confirmed weight source in repository authority. The signal ships enabled against it.

`observation_gap` is a data-quality signal. Render it in a visually distinct class from clinical signals so nobody reads a documentation lapse as a resident decline.

Signals that depend on chips and on the `overnight` window produce nothing until the cadence and chip migrations are live. Ship the rules disabled where their inputs do not yet exist and enable them in the same run once the inputs land.

### 7.3 Bands

Three words, not a number: **Needs a look**, **Watch**, **Acute**. Band derives from signal count and signal severity class, defined in the rules table.

**Continued residency risk** is a derived band that fires when three or more signals remain open past 30 days. The rule itself, like every other jurisdiction rule, lives in configuration keyed by jurisdiction, never in a code path.

### 7.4 Disposition

Every signal instance carries a status: `new`, `acknowledged`, `plan_in_place`, `cleared`. A reviewer moves it forward and writes one line about what was done. Each transition records user and timestamp, append-only.

That ledger is the survey artifact: the facility identified the risk on a date, a named person reviewed it, this is what was done. Export it as a CSV matching the columns of the paper log it replaces.

### 7.5 Three tiers

| Tier | Surface | Content |
|---|---|---|
| 1 | Portfolio | Five facilities, one row each, open Acute signal count, band, trend direction |
| 2 | Facility watchlist | Residents with open signals: Resident, Room, Signal, Since, Band, Status, Owner. Ranked by band then age |
| 3 | Resident | Full signal history, disposition ledger, and the observation log behind each signal |

### 7.6 Facility risk index

A composite survives at facility level only, as `v_facility_risk_index`, a trend over 90 days. Facility aggregates are statistically meaningful and no care decision hangs on one. A resident-level 94 is false precision. A facility-level trend is a management instrument.

### 7.7 Reconciliation with the Resident Assurance Engine

`resident-safety-scorer`, `risk-nightly-scorer`, and `resident-assurance-ai` exist behind `haven-ai-router`, specified in `docs/specs/25-resident-assurance-engine.md`.

**Ruling for this build: retire from this surface.** The scorer stops writing to the Watchlist entirely and keeps whatever other consumers spec 25 names. No AI-derived number renders on a resident row under any circumstance.

### 7.8 Volume target

Under 5 open Acute signals per facility per day at steady state. Tune thresholds against seeded data until the target holds, and state the measured number in the part completion block.

### 7.9 Push, not pull

New Acute signals fire through `notification_routes` to the facility administrator and the standing alert audience. The page is where the list is worked, not where it is discovered.

---

## 8. Smart Rounding shell and defects

Nine defects observed on the live module 2026-09-16.

| # | Defect | Fix |
|---|---|---|
| 1 | Facility scoping not applied | Every query in the module filters by `haven.accessible_facility_ids()` and the selected facility. Add a regression test asserting the resident count matches the facility |
| 2 | Three-daypart model | Two shifts only, per 2.3 |
| 3 | Developer text in operator UI | Remove. No migration number, branch name, or internal identifier renders anywhere in the module |
| 4 | 12-hour templates excluded | Facility cadence per section 2 is the only template |
| 5 | Plans tab fails to load | Same root cause as 1 |
| 6 | Live board fails to load | Same root cause as 1 |
| 7 | Wrong unit of work | Cadence is facility-level and inherited. The per-resident create form is removed. The only per-resident record is a Monitoring Order |
| 8 | Stale and fabricated scores | Replaced by section 7 |
| 9 | Nine-tab strip | Collapse to five: **Live board, Watchlist, Monitoring Orders, Integrity, Reports.** Overview folds into Live board. Escalations folds into Live board as a filter. Plans is removed with defect 7. Insights folds into Reports |

Empty states follow the constitution: left-aligned, two lines, no centered halo icon, and they say what would populate them.

---

## 9. Data model

Spec numbers `404` through `410` map to allocated migrations `412` through `418`.

| Spec | Allocated | Contents |
|---|---|---|
| `404` | `412_col_observation_cadence_michelle_2026_09_16.sql` | Six windows with asymmetric grace, applied to all five facilities, superseding `310`. Deprecates `apply_plantation_wing_observation_plan` without dropping it. Two-shift model |
| `405` | `413_observation_chip_vocabulary.sql` | Extends `observation_vocab` with `meal_intake`, `mood_state`, `med_response`. Adds `composed_summary` to the log table. Adds the composing submit RPC |
| `406` | `414_resident_monitoring_orders.sql` | Table, CHECK constraints, RLS, `create_monitoring_order`, `cancel_monitoring_order`, `expire_monitoring_orders`, absorption view, bridge trigger and backfill from `resident_watch_instances`, audit and updated-at triggers |
| `407` | `415_observation_escalation_policy.sql` | Facility-scoped policy rows for the four rungs, interval-scaled grace function, rewrite of the engine's reads |
| `408` | `416_resident_watchlist_signals.sql` | `watchlist_signal_rules`, `watchlist_signal_instances`, `watchlist_signal_dispositions` (append-only), `v_facility_risk_index`, `v_watchlist_facility`, `v_watchlist_portfolio`, RLS, COL seed with no named person |
| `409` | `417_cadence_config_versioning.sql` | `facility_shift_definitions`, `facility_cadence_versions`, `facility_cadence_windows`, `facility_escalation_versions`, `facility_escalation_rungs`, `cadence_templates` and `escalation_templates` with their window and rung children, `jurisdiction_observation_floors` with the `FL_AHCA` row and null floors. Adds `cadence_version_id` to `resident_observation_tasks` and `escalation_version_id` to `resident_observation_escalations`, backfilling both to the seeded version |
| `410` | `418_cadence_config_rpcs.sql` | `create_cadence_version`, `activate_cadence_version`, `rollback_cadence_version`, `apply_template_to_facilities`, `validate_cadence_version`, `simulate_cadence_change`, `send_test_escalation`. All `SECURITY DEFINER` with explicit `search_path`, all audited, all role-gated per section 6.12 |

Naming law, non-negotiable: `organization_id` never `org_id`; business-user foreign keys reference `user_profiles(id)`; `docs/specs/` never `specs/`; integer cents on any new money column; no new rounds tables; text plus CHECK for new enums in this module.

Regenerate `src/types/database.ts`.

### Edge Functions

| Function | Change |
|---|---|
| `observation-task-generator` | Reads the active `facility_cadence_versions` row for the service date and stamps `cadence_version_id` on every task. One shift ahead, Monitoring Order replacement, idempotent per `(resident_id, window_key, service_date)`, skips non-active statuses. No window time, grace value, or shift boundary in the function body |
| `observation-escalation-engine` | Reads the active `facility_escalation_versions` row and its rungs, including per-shift overrides and per-rung channels, and stamps `escalation_version_id`. Interval-scaled grace from the configured divisor. No hardcoded timer, offset, recipient, or channel |
| `cadence-version-activator` (new) | Scheduled tick that activates `scheduled` cadence and escalation versions when `effective_from` passes, and marks superseded versions |
| `watchlist-signal-engine` (new) | Evaluates enabled rules on a schedule; writes `watchlist_signal_instances`; fires Acute through `notification_routes` |

The repo has no `cron.schedule` statements in migrations. Ship `scripts/smart-rounding/cron-schedules.sql` with the schedules to run against the hosted project. Do not run them from the build.

---

## 10. Permissions

| Action | Roles |
|---|---|
| Record an observation | Resident Aide (`caregiver`) and above, any resident at an accessible facility |
| Create a Monitoring Order | Resident Aide (`caregiver`) and above |
| Cancel a Monitoring Order | `facility_admin`, `manager`, `org_admin`, `owner` |
| Disposition a Watchlist signal | `facility_admin`, `manager`, `org_admin`, `owner` |
| View portfolio tier 1 | `org_admin`, `owner`, and roles with access to more than one facility |
| Cadence, escalation, shift, and template configuration | Section 6.12 |

RLS enforces organization scope first, then facility access, on every new table. Use `haven.accessible_facility_ids()` and `haven.app_role()`.

---

## 11. Open items

| # | Item | Owner |
|---|---|---|
| 1 | Plantation wing stagger retired by the uniform cadence. Confirm the stagger was not covering a staffing constraint at 64 beds | Director of Operations |
| 2 | The 2026-08-14 cadence source is overridden on the COO's direction. Raise it with the Director of Operations before staff see new times on a tablet | Owner |
| 3 | `weight_loss` signal runs against `daily_logs.weight_lbs`; confirm weights are actually recorded there at COL | Owner |
| 4 | The AI scorer is retired from the Watchlist surface for this build; confirm no other spec 25 consumer regressed | Owner |
| 5 | Night cadence at the four facilities where residents sleep. The 22:00 and 02:00 windows are look-ins, not interactions. Confirm a look-in satisfies the "do not wake residents" rule | Director of Operations |
| 6 | `jurisdiction_observation_floors` ships with the `FL_AHCA` row present and its values null. Supply the number and the citation, or confirm no numeric floor exists | Director of Operations and Compliance |
| 7 | Whether facility administrators should hold direct cadence edit rather than the propose-and-approve path in 6.12. Seeded as propose-and-approve | Owner |
| 8 | The care-event to `resident_watch_instances` trigger described in 4.4 does not exist at the branch point. The bridge trigger is built and will fire when that trigger lands | Owner |

---

## 12. Acceptance

1. Six windows generate for every active resident at Homewood for a full service day, verified by SQL count: 33 residents times 6 equals 198 tasks, no duplicates on a second generator run.
2. The `shift_change_am` window does not accept an observation recorded before 06:00 facility-local, and the `mid_morning` window does accept one at 09:00. Both asserted in tests.
3. No surface in the module renders the string "Evening", a migration number, or a raw enum value.
4. A chip-composed observation stores a non-empty `composed_summary` and succeeds with an empty free-text note.
5. Creating a Monitoring Order at interval 30 produces order tasks at 30-minute spacing with 10-minute grace, stops standard window generation for that resident, and marks the standard windows satisfied where an order check falls inside them.
6. A Monitoring Order created by a user with the Resident Aide role succeeds and is `active` immediately, with no pending state.
7. A missed `mid_morning` window produces escalation rows at `window_close` plus 30, 60, and 90, and a nudge at `window_close` minus 15, with a clock-advanced test.
8. The Watchlist returns ranked signal rows for seeded data, every signal traces to a rule row, and a disposition transition writes an append-only row with user and timestamp.
9. Acute signal volume at Homewood against seeded data is at or under 5 per day, with the measured number stated.
10. No resident-level numeric score renders anywhere in the module.
11. The tab strip has five tabs.
12. Facility scoping: a signed-in user with access to one facility sees only that facility's residents on every tab, and the resident count matches the facility's active roster.
13. `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` all exit 0.
14. No resident PHI in commits, logs, filenames, test fixtures, seed scripts, or commit messages.
15. Changing a window time through the settings surface and activating it creates a new `facility_cadence_versions` row, leaves the prior version's `effective_from` and `effective_to` untouched, and generates the next shift's tasks stamped with the new `cadence_version_id`.
16. A compliance report run for a date before the change recomputes to the same numbers after the change. This is the anti-rewrite check.
17. `validate_cadence_version` rejects each of the six hard blocks in section 6.5 with a distinct error.
18. `simulate_cadence_change` against seeded logs returns missed-window and per-rung escalation counts for both the proposed and the in-force configuration.
19. No literal observation time, grace value, escalation offset, recipient, channel, or shift boundary exists in any TypeScript file, Edge Function body, or SQL function body, with the only hits being tests, fixtures, and migration seed data.
20. `send_test_escalation` delivers through the real routing with `TEST` as the first word of the body and creates no row in `resident_observation_escalations`.
21. Applying a template to three facilities creates one new version per facility with the same window set, each independently effective-dated, and the portfolio settings view reports zero drift afterward.

---

## 13. Out of scope and forbidden

- No mass alert button for a missing resident.
- No family reply path. The portal stays one-way.
- No QuickMAR write, no automatic mutation of medication orders or MAR rows, no QuickMAR narrative ingestion in this scope.
- No new rounds tables. `round_shift_configs`, `resident_round_overrides`, `round_location_vocab`, `round_activity_vocab`, `rounds-escalation-engine`, `cart_assignments` are retired names and must not appear.
- No reintroduction of the migration `219` defaults.
- No named person in code, migrations, or seeds. Routes, roles, and subscriptions only.
- "Memory care" never appears on a COL-facing surface. Facility type is ALF/Intermediate or Enhanced ALF Services.
- No Florida rule in a code path. Timers, reasons, and the continued-residency rule live in configuration keyed by jurisdiction.
- No resident-level composite score.
- No approval queue on Monitoring Orders.
- No literal observation time, grace value, escalation offset, recipient, channel, or shift boundary in code. They are rows, per section 6.1.
- No in-place mutation of a cadence or escalation version that was in force.
- No configuration change silently altering a completed task, a missed task, or a fired escalation.
- No invented regulatory floor.
- Quiet Operator applies: no monospace or all-caps labels, no purple, no neon, no centered dashed empty states, no browser-native select or textarea chrome, semantic color only.
- American spelling. No em dashes in code comments, UI copy, or documentation.
