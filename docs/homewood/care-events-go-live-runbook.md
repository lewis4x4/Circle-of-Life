# Care events go live runbook, Homewood Lodge

How the "Something Happened" capture layer goes live at Homewood Lodge, and how the paper incident form, the paper witness statement, the paper Incident Reports Log and the fax to the physician stop.

Phases, in order. No phase begins until the one before it is complete. There are no dates and no durations here on purpose: a phase ends when its exit condition is met, not when a calendar says so.

Roles are named by what they do. Signatures are collected on the printed packet, not in this document.

---

## Preconditions

Every one of these must hold before the first caregiver is shown the flow. None of them is this run's work to close.

| # | Precondition | Where it is tracked | State at the time of writing |
|---|---|---|---|
| P1 | Migrations 400 to 403 applied and ledgered on production | COL-426 | Met. Both production and Haven HFO Staging carry every object and ledger 400 to 403 by numbered version; COL-444 closed the gap COL-426 was opened for |
| P2 | Migration 412 applied and ledgered on staging, then production | This run's PR | Not met. 412 is written, replayed and tested, and is deliberately not applied. Until it is, witness statements cannot be completed and the bucket still refuses a PDF |
| P3 | `care-event-dispatcher` deployed and drift clean | COL-434 | Partly met. The function is deployed and ACTIVE. The Edge Function deploy workflow is still disabled, so a later change to it will not reach the project by itself |
| P4 | `scripts/care-events/cron-schedules.sql` names the secret the dispatcher actually reads | COL-434 | Not met until PR #578 merges. Following the script as written sets `CARE_EVENT_DISPATCHER_CRON_SECRET` while the function reads `CARE_EVENT_DISPATCHER_SECRET`. The dispatcher then 401s on every cron run, silently, and every Level 2 and above alert sits queued while the caregiver's receipt says the Administrator was told |
| P5 | The two cron schedules exist on the project: `care_event_escalation_tick` every minute, and the dispatcher every minute | COL-434 | Verify before go live. Without the tick, an unacknowledged Urgent never escalates |
| P6 | Forbidden patterns green on pull requests | COL-424 | Met. Fixed on main by PR #573 |
| P7 | D1 decided: who the Level 2 target is at each building on each shift, and who is on the corporate route | COL-456 | Open |
| P8 | D2 decided: the floor level for a witnessed fall with no injury | COL-457 | Open |
| P9 | Routes configured for Homewood Lodge per D1, on the notification settings page | Follows COL-456 | Open |
| P10 | Push works on the administrator's and the assistant's phones | Operations | Verify with a test event on staging, not in production |
| P11 | SMS state decided per D5, and whichever way it goes is written down | COL-460 | Open. Until a BAA is signed, the dispatcher marks SMS rows `skipped` with `channel_not_enabled` and the receipt tells the caregiver which channels actually went out |

P7, P8 and P11 are decisions. They are not engineering work and they do not become engineering work by waiting.

### The other four owner decisions

D3, D4, D6 and D7 do not block go live: each has a default, each default is what runs today, and the taxonomy review packet prints whatever the configuration currently says. They are filed so that the reviewer signing the packet's first row knows what they are also signing.

| Decision | Subject | Issue |
|---|---|---|
| D3 | Acknowledgement windows of 30, 10 and 5 minutes | COL-458 |
| D4 | Whether a Level 1 Note reaches the family portal | COL-459 |
| D6 | Grievances inside this flow or as their own module | COL-461 |
| D7 | Whether a med tech "Refused" writes to the eMAR | COL-462 |

---

## Phase 1: Taxonomy sign off

**Purpose.** Nobody signs away paper until somebody has read what replaces it.

1. An administrator opens `/admin/settings/care-events/taxonomy-packet` with the building selected in the header, types their own name in the printed-by field, and prints the packet. That name appears on the footer and is not stored.
2. The packet carries every tile, every question, every answer and the level word and category it produces, what fires at that level, and which sheet in the binder each tile replaces. It is generated from the running system; it is not a summary somebody wrote.
3. The owner-side reviewer reads it and signs the first row of the sign-off page: the taxonomy and the seven owner decisions (COL-456, COL-457, COL-458, COL-459, COL-460, COL-461, COL-462).
4. Any change the reviewer wants goes back as a Linear issue against spec 07A. It is never an ad hoc edit to a running rule, and it is never a second taxonomy kept alongside the first.

**Exit condition.** The first sign-off row is signed, and every change the reviewer asked for has either landed or been recorded as a decision that is not blocking.

---

## Phase 2: Enable capture at Homewood Lodge

**Purpose.** Get real events into Haven while paper is still the record.

1. Apply migration 412 to Haven HFO Staging. Verify, then apply to production and ledger it. Do not re-run 400 afterwards: its `ON CONFLICT (id) DO UPDATE` on the bucket row would put the old 15 MB limit and the images-only MIME list back.
2. Confirm the two cron schedules and the dispatcher secret name (P4, P5).
3. Walk one synthetic event end to end on staging: a Level 2 fall, a witness statement tapped by a second signed-in staff member, one photo and one PDF attached, the incident form and the physician sheet printed. Confirm a delivery row reached `sent` rather than sitting `queued`.
4. Turn the flow on for the building.

**Exit condition.** A real event has been captured by a real caregiver and acknowledged by the administrator, and the delivery ledger shows how and when.

---

## Phase 3: Parallel run

**Purpose.** Prove the two records say the same thing before one of them stops.

1. Staff use **Something happened** for every event. They also complete the paper incident form for every event, exactly as they do now. Nothing about paper changes in this phase.
2. The administrator completes the Haven completion form for every event, and prints the Haven incident form and, where a physician is notified, the physician sheet.
3. The physician sheet is printed and faxed as before. The administrator records the physician notification with method `fax` on the completion form.
4. Each week, the compliance reviewer prints the Haven incident log for the same range as the paper Incident Reports Log and compares them line by line.
5. **Every difference is a Linear issue.** Not a note, not a verbal correction. A missing row, an extra row, a wrong date, a wrong room, a level that reads wrong to the reviewer: each one is filed with the incident number and the range, and each one is closed before the retirement gate.

**Exit condition.** A comparison period passes with no unexplained difference between the Haven log and the paper log, and every difference raised has been closed.

---

## Phase 4: Retirement gate

**Purpose.** One signature, given knowingly, on a page that says what is being retired.

1. The compliance reviewer signs the second row of the taxonomy packet's sign-off page: paper and fax retirement.
2. The signed packet goes into the binder.

**This is a gate, not a step.** No part of Phase 5 begins without that signature. This run does not decide it, cannot decide it, and does not build anything that would let it be skipped.

---

## Phase 5: Retire

Once, and only once, the second row is signed:

**Stops.**
- The paper incident form.
- The paper witness statement.
- The paper Incident Reports Log.

**Continues.**
- The physician sheet print, and the fax. The sheet replaces the fax's contents, not the fax itself. Whether the fax itself is ever replaced is a separate decision, and no e-fax vendor is proposed by this work.

**Stays as it is.**
- Paper records created before go live stay in the binder. They are the record for their own period and nothing migrates them.

---

## Rollback

At any point in any phase, if the Haven path is not carrying the work:

1. Resume the paper incident form, the paper witness statement and the paper Incident Reports Log immediately. Staff are told once, plainly, that paper is the record again.
2. Haven records already captured stay exactly where they are. Nothing is deleted, hidden or backfilled; a care event that was captured happened, whatever the process around it did afterwards.
3. The reason is filed as a Linear issue against spec 07A before the next attempt.

Rollback is not a failure state that needs approval. Any administrator may call it.

---

## What this runbook does not cover

- The fax decision. The physician sheet is a print; replacing the fax itself is out of scope.
- SMS and voice beyond D5 and the Twilio BAA.
- The second capture form on the med tech surface, which still asks a staff member to choose a severity (COL-452). Until that is closed, the packet's claim that the eight tiles are the whole taxonomy is not quite true for that one door.
- Rollout to the other four buildings. Homewood Lodge is the acceptance facility; nothing here authorises a second building.
