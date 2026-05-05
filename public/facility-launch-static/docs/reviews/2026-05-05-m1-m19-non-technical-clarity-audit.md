# Facility Launch Center — Onboarding Modules M1–M19, Non-Technical Clarity Audit

**Date:** 2026-05-05
**Scope:** `src/intakeCatalog.js` (M5–M16, M18, M19) + `src/app.js:354–406` (M1–M4, M17 custom render)
**Mode:** Read-only audit. No source files modified.
**Author:** JARVIS
**Audience:** CEO / CFO / COO / Executive Director / Director of Nursing roundtable — operators, not engineers.

---

## Context / Scope

The onboarding modules are presented as a 19-module Facility DNA intake. Each module has:

- 2–3 **module-level fields** (source-of-truth, owner, policy)
- A **checklist** (currently inert pills — covered separately in `2026-05-05-m15-m18-ux-review.md`, not re-litigated here)
- A **collection** with per-row fields (residents, rate records, care plans, etc.)

The user reports they cannot understand M16 fields (e.g. *"severity rule"*, *"family notification rule"*). That is correct, and it is not isolated to M16. The catalog was written by someone fluent in the *operating model* but the labels are **noun-phrases, not questions**, and almost none of them have:

1. **An enumerated picklist** when there is an obvious finite set of answers (severity, status, frequency, yes/no).
2. **A placeholder example** showing a real Homewood-shaped answer.
3. **Help text** under the label explaining "why we need this" in one sentence.

The result: a CFO or DON staring at *"Severity rule"* with a free-text box has no idea whether to type *"high"*, *"major reportable"*, or a paragraph of policy. They skip it. The module looks 80% complete with no actual decisions captured.

This report rewrites every module, label-by-label, in plain English. The pattern is consistent: **label = a question, placeholder = a real example, help = one sentence of why, type = the most constrained input that still works.**

---

## Cross-Cutting Recommendations (apply to every module)

These four changes alone solve ~70% of the comprehension problem. The per-module table that follows assumes they are adopted.

### CC-1 — Add `type: "select"` with `options: [...]` to the field spec

The catalog spec currently supports `date`, `number`, `relation` (M15 review proposes this), but every other field falls back to `<input type="text">`. **Eight of the nineteen modules contain at least one field whose answer is a known short list** (severity, status, cadence, yes/no, payer type, license state). Promote them to selects.

Suggested spec extension:

```js
{ key: "severityRule", label: "How serious is this kind of incident?",
  type: "select",
  options: ["Minor — no injury, info only",
            "Major — injury or hospital transfer",
            "Critical — state-reportable, abuse, death, elopement"],
  help: "Pick the worst outcome this category typically produces." }
```

The renderer change is one switch arm in `renderRecordForm` / `renderEditableRecordCells`; it is mechanically the same as the existing `relation` arm proposed for M5 lookups.

### CC-2 — Replace noun labels with plain-English questions

Every label currently reads like a column header in a database table. Operators understand questions, not column headers. This audit's per-module table gives the rewrite for each one.

**Rule of thumb:** if you can't read the label out loud and have a person at a roundtable answer it without follow-up, rewrite it.

### CC-3 — Add `placeholder` and `help` keys to the field spec

The catalog already carries `sampleRecord` per collection (a useful demo row), but no per-field placeholder or help renders into the UI. Add two optional keys:

- `placeholder` — a one-line concrete example shown in the empty input.
- `help` — a one-sentence "why this matters at go-live" hint shown under the label as `<small>`.

(The hand-rendered M1/M2/M4 in `app.js` already use a `hint` arg on `input(...)`. Extend the catalog renderer to consume the same convention.)

### CC-4 — Promote the per-module "module-level fields" into a one-line **"Who owns this and where is the source today?"** banner

The three module-level fields on every catalog module are nearly always *(policySource, owner, oneRule)*. Operators don't read them as fields — they read them as a banner. Render them as a stacked "Owner / Source / Standing rule" row at the top of the module so the operator only sees three fields they have to fill in once, not a sea of inputs.

This also matches how `seedData.js:29–48` already pre-populates owners and sources by role. The intake screen should *show* those defaults inline as ghosted text and let the roundtable confirm or override.

---

## M16 Deep Dive — the explicitly cited example

Current state (`intakeCatalog.js:222–240`):

| Existing label | Existing input type | Why a CEO/DON can't answer it |
|---|---|---|
| Severity rule | free text | "Rule" implies they should write a policy paragraph; they don't know if it wants a tier, a description, or both. |
| Family notification | free text | Notifies *who*, *how fast*, by *whom*? Three questions in one cell. |
| State reporting threshold | free text | Operators know whether *this* incident gets reported, not the abstract threshold. |
| Claims/legal routing | free text | "Routing" is a software word. They want to know "do we call the lawyer?" |
| Immediate actions | free text | OK as a textarea but unbounded — needs a starting template. |
| Investigation owner | free text | They'd answer this in two seconds with a select. |
| Follow-up cadence | free text | Same — finite set of answers. |
| Incident type | free text | Should be a select; the operating world has ~10 incident categories. |

### Proposed M16 rewrite (collection: `incidentWorkflows`)

| Old key | **New label (the question)** | Type | Options / placeholder | Help text (one line under the label) |
|---|---|---|---|---|
| `incidentType` | **What kind of incident is this?** | select | Fall (no injury) · Fall with injury · Medication error · Elopement · Resident-to-resident altercation · Allegation of abuse/neglect · Skin tear or wound · Choking/aspiration · Behavioral event · Property damage · Other | Pick the closest match — we'll branch the workflow off this. |
| `severityRule` | **How serious is this kind of event, at worst?** | select | Minor — no injury, info only · Major — injury, ER visit, or family-level concern · Critical — state-reportable, abuse, death, or elopement | Pick the worst plausible outcome. The app uses this to decide who gets paged. |
| `immediateActions` | **What does the caregiver do in the first 15 minutes?** | textarea | Placeholder: "Assess resident, vitals, call EMS if needed, notify charge nurse and DON, secure scene, start incident note in app." | Write the play-by-play a brand-new caregiver should follow before calling anyone. |
| `familyNotificationRule` | **How fast do we have to tell the family?** | select | Within 1 hour · Same business day · Within 24 hours · Only if condition changes · Per care plan (custom) | "Family" = the responsible party listed on the resident's record (M15). |
| `stateReportingThreshold` | **Does the state need to know?** | select | Yes — always for this category · Maybe — ED/DON decide within 24h · No | If unsure, choose "Maybe" and the app will flag it for ED/DON review. |
| `claimsRouting` | **Do we need to loop in CFO, our broker, or legal?** | select (multi) | CFO · Insurance broker · Outside counsel · None of the above | Triggered for injury, hospital transfer, abuse allegation, or property loss. |
| `investigationOwner` | **Who runs the investigation?** | select | DON · ED · Compliance lead · Outside investigator · Other | The single person whose name goes on the file — not "the team." |
| `followUpCadence` | **When do we check back on this resident/incident?** | select | 24 hours · 24h + 72h · 24h + 72h + care-plan review · Per protocol — investigation owner sets it | The app will create the follow-up task automatically. |

### Proposed M16 rewrite (module-level fields)

| Old label | **New label** | Type | Placeholder | Help |
|---|---|---|---|---|
| Incident policy/source | **Where does our written incident policy live today?** | text | "Operations binder, tab 12" | We need a source we can cite if surveyors ask. |
| Claims/legal routing owner | **Who decides whether to call our insurance broker or attorney?** | text | "CFO, with ED notified" | One named person, not a department. |
| State reporting rule | **What's our standing rule for notifying the state?** | textarea | "ED + DON decide jointly within 24 hours; default-yes for any major or critical event." | This is the one-paragraph policy, not the case-by-case decision. |

### Why this fixes the M16 problem specifically

A CFO can now sit down with the DON and answer **eight selects + one paragraph** for each incident type, in roughly 90 seconds per row. That is the difference between *"I don't understand this screen"* and *"OK, what's next?"*

---

## Module-By-Module Rewrite Plan

The table format is: **old label → new label · type · options/placeholder · help.** Only the labels that need rewriting are listed; clean labels (e.g. "DOB", "Phone", "Email") are not repeated.

### M1 — Company / Portfolio _(hand-rendered in `app.js:360–369`)_

| Old | **New label** | Type | Options / placeholder | Help |
|---|---|---|---|---|
| Parent legal name | **Parent / holding company legal name** | text | "Sorensen Smith & Bay Holdings LLC" | The top of the org chart — usually on the EIN letter. Leave blank if there isn't one. |
| DBA | **DBA ("doing business as") name** | text | "Homewood Lodge" | The marketing name, if different from the legal name. |
| Operating LLC | **Operating company (the entity that signs payroll & vendor contracts)** | text | "Sorensen, Smith & Bay LLC" | This is who employs staff and bills residents. |
| Property LLC | **Property-holding company (the entity that owns/leases the building)** | text | "Homewood Property Company LLC" | Often a different LLC than the operating company — that's normal in senior living. |
| Time zone | **Facility time zone** | select | America/New_York · America/Chicago · America/Denver · America/Los_Angeles · America/Phoenix | Drives every report, shift, and reminder. Pick once, never change. |

### M2 — Facility Profile _(hand-rendered, `app.js:370–390`)_

| Old | **New label** | Type | Options / placeholder | Help |
|---|---|---|---|---|
| Facility type | **License category** | select | Assisted Living Facility · Memory Care · Independent Living · Skilled Nursing · Continuing Care Retirement Community · Group Home | Use the exact category on the license certificate. |
| License state | **State that issued the license** | select | (US state list) | Drives state-specific reporting in M16. |
| License agency | **Issuing agency name** | text | "AL Department of Public Health, Bureau of Health Provider Standards" | Copy verbatim from the certificate. |
| License expiration | **License expiration date** | date | — | The app will warn 90/60/30 days out. |
| Floors/wings | **How is the building laid out?** | text | "2 floors; AL on first, Memory Care on second wing" | One sentence — used to seed Rooms/Beds (M3). |
| Operating address confirmed | **I've confirmed the operating address with the property records** | yes/no | (checkbox) | Required because mailing address often differs from physical address — and Property LLC vs Operating LLC may use different ones. |
| Emergency contact | **24/7 emergency contact for this building** | text | "Maintenance Director cell, then ED cell" | Who picks up when the alarm goes off at 2 a.m. |

### M3 — Rooms / Beds / Units _(hand-rendered, `app.js:391–395`)_

| Old | **New label** | Type | Options / placeholder | Help |
|---|---|---|---|---|
| Beds total | **Total licensed beds** | number | "62" | Match the number on your license. |
| Units total | **Total units / apartments** | number | "48" | Different from beds — couples sometimes share a unit. |
| Unit type | **Unit type** | select | Studio · 1-bedroom · 2-bedroom · Memory Care suite · Companion · Shared | Add new options if a state license uses different terms. |
| Care designation | **What level of care does this room support?** | select | Assisted Living · Memory Care · Skilled · Independent · Respite | Drives which residents may be placed here. |
| Status | **Room status** | select | Active · Reserved · Offline (out for maintenance) | "Offline" rooms are excluded from move-in pipeline (M14). |

### M4 — Employees / Users / Roles _(hand-rendered, `app.js:396–400`)_

| Old | **New label** | Type | Options / placeholder | Help |
|---|---|---|---|---|
| Role coverage notes | **What roles are NOT yet covered for go-live?** | textarea | "Need a backup DON; awake-overnight caregiver position is open." | Be honest — unfilled critical roles are a launch risk, not a paperwork item. |
| App role | **What role do they play inside the app?** | select | Executive · Administrator · DON / Clinical · Caregiver · Med-Pass-Cert · Business Office · Maintenance · Activities · Family-Read-Only · Surveyor-Read-Only | Controls what they can see and edit. Different from job title. |
| Employment status | **Employment status** | select | Active · Onboarding · Inactive · Terminated | Inactive employees are still in the directory but can't log in. |
| Login status | **App login status** | select | Pending invite · Invite sent · Active · Locked / disabled | Watched at go-live to make sure every shift has at least one logged-in user. |
| Credential summary | **Credentials / training on file** | text | "Caregiver orientation 2026-04-01; CPR exp 2027-03; Med-pass certified" | One short line — the binder still holds the full file. |

### M5 — Residents

| Old | **New label** | Type | Options / placeholder | Help |
|---|---|---|---|---|
| Resident source of truth | **Where does the current resident roster live today?** | text | "Census spreadsheet on the BOM's desktop" | We need to know what we're replacing. |
| Resident validation owner | **Who confirms the roster is correct on day 1?** | text | "Business Office Manager" | One named person, not "the office." |
| Status | **Resident status** | select | Active · Move-in scheduled · On hospital leave · Discharged · Deceased | Drives the live census and billing. |
| Payer type | **Who pays the bill?** | select | Private pay · LTC insurance · Medicaid waiver · VA Aid & Attendance · Private pay + LTC mix · Other | Drives M6 billing setup. |
| Care level | **Current care level** | select | Independent · Level 1 · Level 2 · Level 3 · Memory Care · Skilled | Match your facility's published care levels. |
| Risk flags | **Risk flags** | multiselect | Fall risk · Elopement risk · Skin breakdown · Aspiration / dysphagia · Behavioral · DNR/DNH on file · Allergy alert · None | Clinical shorthand — drives caregiver tasks (M7/M8). |
| Consent/privacy status | **Consents on file** | multiselect | HIPAA release · Photo/marketing · Family portal · Telehealth · Advance directive · None | Each one corresponds to a binder document — the doc is uploaded in M17. |

### M6 — Resident Rates / Billing / Payer

| Old | **New label** | Type | Options / placeholder | Help |
|---|---|---|---|---|
| Billing source of truth | **Where is the current billing system?** | text | "QuickBooks, customer ledger" | What we're migrating off of (or feeding into). |
| Billing cycle | **Billing cycle** | select | Monthly in advance, on the 1st · Monthly in arrears · Bi-weekly · Custom | If "Custom," explain in the next field. |
| Rate approval owner | **Who has to sign off on a rate change?** | text | "CFO" | Single name. |
| Resident *(lookup)* | **Resident** | resident-lookup | (autocomplete from M5) | Type two letters of the name and pick. |
| Base monthly rate | **Base monthly room & board rate** | number ($) | "4200" | Before care-level add-ons or extras. |
| Care charge | **Care-level monthly charge** | number ($) | "650" | The Level 1/2/3 add-on. |
| Other charges | **Other monthly charges (one per line)** | textarea | "Medication management $250\nCable $40" | Anything that isn't room/board or care level. |
| Concessions | **Discounts / concessions** | text | "Two weeks free at move-in; community fee waived" | Plain English; the contract is the source of truth. |
| Collection status | **Account status** | select | Current · 1–30 days past due · 31–60 · 61–90 · 90+ / collections · Hold (negotiating) | Drives the daily AR scoreboard. |

### M7 — Care Levels / Service Plans / ADLs

| Old | **New label** | Type | Options / placeholder | Help |
|---|---|---|---|---|
| Assessment tool/source | **Which assessment do we use today?** | text | "AL assessment packet, paper" | Name the form, not the process. |
| Reassessment cadence | **When do we re-assess?** | select | Quarterly · Semi-annually · Annually · On change of condition only · Quarterly + on change of condition | This becomes a recurring task. |
| Care plan owner | **Who owns the care plan for each resident?** | select | DON · Resident Care Director · ED · Other | Same person co-signs change-of-condition. |
| ADL needs | **What activities of daily living need help?** | multiselect | Bathing · Dressing · Toileting · Transfers · Eating · Ambulation · Medication reminders · None | Drives caregiver task generation. |
| Mobility | **Mobility level** | select | Independent · Cane · Walker · Wheelchair (self-propel) · Wheelchair (assist) · Bedfast | Used by maintenance (M13) for room readiness too. |
| Cognitive status | **Cognitive status** | select | Intact · Mild memory support · Moderate dementia · Advanced dementia · Other | Drives Memory-Care wing eligibility. |
| Fall risk | **Fall risk** | select | Low · Moderate · High | Triggers enhanced rounds (M8). |
| Escalation rules | **When something changes, who gets called and how fast?** | textarea | "Any fall: notify DON within 15 min; missed med: notify charge nurse within 30 min." | Plain English play-by-play. |

### M8 — Rounds / Checks / Care Tasks

| Old | **New label** | Type | Options / placeholder | Help |
|---|---|---|---|---|
| Rounds policy/source | **Where is the written rounds policy today?** | text | "Policy binder, tab 4 + DON interview" | Will be reconciled against actual practice — both go in. |
| Cadence decision owner | **Who can change the rounds cadence?** | select | COO · ED · DON · Other | One name. |
| Rounds exception process | **What happens when a resident needs more frequent checks?** | text | "DON authorizes; reason documented in the resident's record." | This is the **enhanced-checks workflow** in plain English. |
| Resident group | **Which residents are on this round?** | select | All residents · Memory Care wing · Specific resident (use the resident lookup) · Custom group | "Custom group" lets you name a list, e.g. "fall-risk residents." |
| Shift | **Shift** | select | Day · Evening · Night · 24 hr · Custom | If custom, define start/end below. |
| Cadence | **How often?** | select | Every 15 min · Every 30 min · Hourly · Every 2 hours · Every 4 hours · Once per shift · Custom | Hourly = 60 minutes from one round to the next. |
| Documentation required | **Where does the caregiver document this round?** | select | In the app (timestamped) · Paper sheet only · App + paper | Paper-only is allowed but flagged for migration. |
| Missed-round escalation | **What happens when a round is missed?** | textarea | "After 15 minutes overdue, the app pages the charge caregiver, then DON at 30 min." | Drives the auto-escalation timer. |

### M9 — Schedules / Shifts / Assignments

| Old | **New label** | Type | Options / placeholder | Help |
|---|---|---|---|---|
| Schedule source of truth | **Where is the staff schedule today?** | text | "Excel file in the BOM's email" | We need to know what we're replacing. |
| Staffing ratio policy | **Minimum staffing ratio you commit to** | textarea | "Day: 1 caregiver per 12 AL residents and 1 per 8 MC. Night: 1 awake caregiver per wing + 1 on-call." | Both the marketing claim and the survey-defensible minimum. |
| Call-off escalation owner | **Who do staff call when they can't make a shift?** | text | "Scheduler first; ED if unfilled inside 4 hours." | One name + backup. |
| Department | **Department** | select | Resident Care · Memory Care · Med-Pass · Dining · Activities · Maintenance · Business Office · Sales | Add categories only if needed for credentialing. |
| Minimum staff | **Minimum people on this shift** | number | "3" | The hard floor — below this we're calling the ED. |
| Credential needed | **What credentials must this role have?** | text | "Caregiver orientation complete; med-pass certification (if med-pass shift)." | We block scheduling if missing — keep it accurate. |

### M10 — Medications

| Old | **New label** | Type | Options / placeholder | Help |
|---|---|---|---|---|
| Medication scope | **What level of medication assistance do you provide?** | select | None — residents self-administer · Reminders only · Assistance with self-admin · Med-pass by trained staff · Skilled nursing administration | Drives whether M10 is in scope at all. |
| MAR/eMAR source | **Where is the MAR (medication administration record) today?** | select | Paper MAR · Pharmacy printout · eMAR (specify) · None — out of scope | "MAR" = the daily med chart. Don't be alarmed if it's still on paper. |
| Medication process owner | **Who owns the medication process?** | select | DON · LPN/RN designee · ED · Outside pharmacy consultant | One name. |
| Pharmacy | **Pharmacy** | text | "Homewood Pharmacy, 205-555-1212" | The dispensing pharmacy, not the resident's preference. |
| MAR status | **Is this resident's MAR up to date today?** | select | Current · Pending pharmacy update · Pending physician order · Out of scope | Updated by the DON daily during onboarding. |
| Med-pass times | **Standard med-pass times** | text | "08:00, 14:00, 20:00" | List the regular pass times — the app will create the reminders. |
| PRN process | **What does the caregiver do for an as-needed (PRN) request?** | textarea | "Document reason, request, result; notify charge nurse if pain ≥ 5/10 unrelieved." | "PRN" = pro re nata, "as needed." |
| Controlled substance process | **Controlled substance handling** | textarea | "Two-person count at every shift change; locked cabinet; deviation = call DON immediately." | Required if any resident is on a Schedule II–IV med. |
| Allergies | **Drug allergies** | text | "Penicillin (rash); sulfa drugs" | Pulled into M11 and the resident's face sheet. |
| Exception escalation | **What happens if a med is missed?** | textarea | "Charge nurse paged immediately; DON notified within 30 min; PCP within 24 h if clinically significant." | Drives the auto-escalation timer. |

### M11 — Dining / Meals / Dietary

| Old | **New label** | Type | Options / placeholder | Help |
|---|---|---|---|---|
| Meal schedule | **Standard meal times** | text | "Breakfast 8:00, lunch 12:00, dinner 17:00" | Snacks listed separately below. |
| Dietary source of truth | **Where do diet orders come from?** | select | Physician order · Dietitian assessment · Family preference (no clinical) · Mixed | Required because allergies must be physician-ordered to be enforced. |
| Dining owner | **Dining lead** | text | "Dining Manager" | One name. |
| Diet order | **Diet order** | select | Regular · Low sodium · Diabetic / carb-controlled · Renal · Heart-healthy · Pureed · Mechanical soft · Thickened liquids · NPO · Custom (note below) | If custom, expand below. |
| Texture | **Texture** | select | Regular · Mechanical soft · Pureed · Bite-sized · Other | Separate from diet order. |
| Likes/dislikes | **Strong food preferences** | text | "Loves oatmeal; refuses fish." | Helps the kitchen avoid wasted trays. |
| Assistance needed | **Help needed at meals** | select | None · Cueing · Tray setup · Hand-over-hand feeding · 1-on-1 throughout meal | Drives caregiver tray-time staffing. |
| Snack/hydration plan | **Standing snack & hydration plan** | text | "PM snack at 15:00; hydration round at 10:00 and 14:00." | Required for any fall-risk or skin-breakdown resident. |
| Missed meal escalation | **What happens if a resident refuses or misses a meal?** | textarea | "Caregiver lead notified after one full meal refused; DON after two consecutive." | Drives the auto-flag in the daily report. |

### M12 — Activities / Life Enrichment

| Old | **New label** | Type | Options / placeholder | Help |
|---|---|---|---|---|
| Activity calendar source | **Where does the monthly calendar live today?** | text | "Printed monthly calendar; Word doc in the LE Director's email." | What we're migrating. |
| Attendance tracking rule | **Do we track attendance for every group activity?** | select | Yes — every scheduled group activity · Only for outings & off-site · Spot-check / sample · No | Drives whether the app prompts for attendance. |
| Activities owner | **Life Enrichment lead** | text | "Life Enrichment Director" | One name. |
| Audience | **Who is this activity for?** | select | All residents · AL residents only · Memory Care residents only · Specific list (use lookup) · Family-invited | Drives who sees it on the calendar. |
| Attendance required | **Track attendance?** | yes/no | — | If no, we just show it on the calendar. |
| Transport/offsite rules | **If off-site, what's required?** | textarea | "Signed outing consent on file; 1:4 staff ratio min; vehicle inspection same day." | Required for any outing — even a doctor's appointment. |
| Family visibility | **Show on family portal calendar?** | yes/no | — | Off for clinical-only events. |

### M13 — Maintenance / Work Orders / Assets

| Old | **New label** | Type | Options / placeholder | Help |
|---|---|---|---|---|
| Work-order source/process | **How are maintenance requests submitted today?** | select | Logbook only · Verbal · Maintenance email · Existing work-order app (specify below) · Mixed | Drives the migration plan. |
| Preventive maintenance cadence | **What PM happens on a regular schedule?** | textarea | "Monthly fire panel + life-safety walkthrough; quarterly room audit; annual generator load test." | Plain English — vendor contracts go in M18. |
| Maintenance owner | **Maintenance lead** | text | "Maintenance Director" | One name. |
| Category | **Asset category** | select | Life safety (fire/sprinkler) · HVAC · Plumbing · Electrical · Kitchen equipment · Resident room · Common area · Vehicle · Generator · Other | Life-safety is the priority lane. |
| PM cadence | **How often does this asset get serviced?** | select | Weekly · Monthly · Quarterly · Semi-annually · Annually · On condition / event-driven | Generates the recurring task. |
| Last service | **Last service date** | date | — | The app warns when next-due is approaching. |
| Next due | **Next service due** | date | — | Auto-suggested from cadence + last-service. |
| Vendor/owner | **Who services this asset?** | text | "SafeFire Systems (M18 contact)" | If a vendor, link to the M18 entry. |
| Emergency procedure | **What happens if this fails at 2 a.m.?** | textarea | "Maintenance on-call calls SafeFire dispatch; ED notified; if life-safety, call 911 first." | The 2 a.m. test — if you can't answer it, the asset isn't really managed. |

### M14 — Admissions / Sales / Move-In Pipeline

| Old | **New label** | Type | Options / placeholder | Help |
|---|---|---|---|---|
| CRM/pipeline source | **Where do inquiries live today?** | select | Spreadsheet · CRM (specify below) · Email inbox only · Phone log only · Mixed | Drives the import path. |
| Move-in checklist owner | **Who owns the move-in day workflow?** | text | "Sales Director with BOM" | One name + backup. |
| Admission approval rule | **Who must sign off before a move-in date is confirmed?** | select | ED only · ED + DON · ED + DON + CFO · Other (describe) | Tied to the gate that confirms a deposit can be collected. |
| Stage | **Pipeline stage** | select | New inquiry · Tour scheduled · Toured · Assessment scheduled · Assessment complete · Deposit collected · Move-in scheduled · Moved in · Lost / not a fit | Drives the conversion funnel report. |
| Referral source | **Where did this prospect come from?** | select | Hospital discharge planner · Skilled nursing referral · Physician · Family / friend · Web inquiry · Walk-in · Marketing event · Other | Drives the referral-source ROI report. |
| Assessment status | **Pre-admission assessment status** | select | Not yet scheduled · Scheduled · In progress · Complete · Resident not appropriate (lost) | DON owns this column. |
| Required docs | **Pre-admission documents on file** | multiselect | Face sheet · Physician orders · Negative TB · POA / advance directive · Insurance card · Hospital discharge summary · Other | Each item maps to a doc upload in M17. |
| Deposit | **Deposit status** | select | Not requested · Requested · Received · Refunded · Waived | Triggers a "ready to confirm move-in date" flag. |
| Room target | **Target room** | select (rooms from M3) | "112" | Pulls from M3 to prevent typos. |

### M15 — Family / Responsible-Party Portal

(Already covered in detail in `2026-05-05-m15-m18-ux-review.md` — only the rewrites that go beyond that review are listed here.)

| Old | **New label** | Type | Options / placeholder | Help |
|---|---|---|---|---|
| Family portal scope | **What can family members see in the portal?** | multiselect | Statements & balance · Activity calendar · Care notes · Photos · Wellness updates · Documents · Messages with staff | Anything checked here is visible to the responsible party. |
| Communication policy | **What's our standing rule for who gets called for what?** | textarea | "Primary RP gets billing & care escalations. Secondary RP gets care escalations only if primary unreachable in 30 min." | This is the one-paragraph policy, not the per-resident preference. |
| Authority | **Legal authority** | multiselect | Financial POA · Healthcare POA · Guardian / conservator · Spouse · Adult child (no formal authority) · Other | Each one needs a doc in M17. |
| Communication preference | **Communication preferences** | multiselect | Text — urgent only · Text — anything · Email — anything · Phone call — anything · Portal in-app only · Do not contact except emergencies | Stored per contact, not per resident. |
| Portal invite status | **Portal invite status** | select | Not invited · Invite sent · Active · Declined · Locked | Watched at go-live to push family adoption. |
| Billing access | **Can this contact see billing?** | yes/no | — | Off for non-financial contacts (e.g. neighbors, friends). |
| Privacy consent | **Privacy / HIPAA release on file?** | select | Yes — full release · Yes — limited (specify in notes) · No · Pending | Required before *any* PHI is shared. |

### M16 — Incidents / Risk / Claims Awareness

**Covered in the M16 Deep Dive section above.** Treat that section as authoritative.

### M17 — Documents / Insurance / Compliance _(hand-rendered)_

| Old | **New label** | Type | Options / placeholder | Help |
|---|---|---|---|---|
| Review notes | **What still needs to be picked or refreshed?** | textarea | "Two GL certs are duplicates from 2022 — need to pick one as source-of-truth and chase the 2024 cert from broker." | Custodian's working notes — these are the open items. |

(M17 is mostly driven by the Document Intake panel — no per-row label rewrites needed there beyond what's in `2026-05-05-document-intake-ux-review.md`.)

### M18 — Vendors / Contacts / Emergency

| Old | **New label** | Type | Options / placeholder | Help |
|---|---|---|---|---|
| Vendor/contact source | **Where is the vendor list today?** | select | Binder · Spreadsheet · Sticky notes / nowhere centralized · Other | Be honest. |
| After-hours vendor rule | **Who can call vendors after hours?** | textarea | "Maintenance on-call calls life-safety vendors directly. ED approval required for any vendor billing > $500." | Drives the after-hours phone tree. |
| Vendor directory owner | **Who owns the vendor directory?** | text | "Maintenance Director with BOM backup" | One name + backup. |
| Category | **Vendor category** | select | Fire / life safety · HVAC · Plumbing · Electrical · Pest control · Landscaping · Pharmacy · Medical waste · Lab / imaging · Linen · Food / supply · IT / phones · Generator / fuel · Insurance broker · Outside counsel · Other | Drives the after-hours decision tree. |
| Contract status | **Contract status** | select | Active · Auto-renew · Expiring < 90 days · Expired · Month-to-month · No contract on file | Expiring & expired flagged on the executive dashboard. |
| Insurance required | **COI on file?** | select | Required & current · Required & expired · Not required · Pending request | "COI" = certificate of insurance from the vendor. |
| After-hours phone | **24/7 dispatch phone** | text | "205-555-3999" | The number we call at 2 a.m., not the office line. |
| Account # | **Account number** | text | "HF-7781" | So Maintenance doesn't have to dig through invoices at 2 a.m. |
| Escalation owner | **Who escalates if this vendor isn't responding?** | text | "Maintenance Director, then ED" | One name + backup. |

### M19 — Launch Scoreboard / Operating Reports

(Already in pretty good shape — `intakeCatalog.js:298–308` was rewritten recently and uses operator-friendly labels like "Number we're watching", "Person on the hook", "What we do if it slips". These are good. The two opportunities to tighten further:)

| Old | **New label** | Type | Options / placeholder | Help |
|---|---|---|---|---|
| Refresh cadence | **How often is the number updated?** | select | Live · Hourly · Daily by 8am · Daily by EOB · Weekly Monday 9am · Monthly | Daily is the default for the first 30 days. |
| Audience | **Who sees this number on the daily huddle?** | multiselect | CEO · CFO · COO · ED · DON · Sales · Investors / board · Family-facing | Only roles checked here are auto-paged at huddle time. |
| Action if off-track | **What we do if it slips** | textarea | "DON pulls the assignment sheet at huddle, reassigns, documents reason in app." | Has to be a *verb the owner does*, not "investigate" or "review." |

---

## Implementation Priority

If the user can only ship one batch this week, ship **Tier 1**. Tier 1 alone moves the roundtable from blocked to functional.

### Tier 1 — Unblocks the M16 roundtable (1–2 days)

1. Add `type: "select"` + `options: [...]` rendering arm to `renderRecordForm` and `renderEditableRecordCells` in `app.js` (one switch arm; mechanically same as the existing `type: "date"` arm).
2. Add `placeholder` and `help` keys to the field-spec consumer (already present in the hand-rendered M1/M2/M4 — extend to the catalog renderer).
3. Apply the **M16 rewrite (selects + new labels + help text)** from the Deep Dive section verbatim.
4. Wire the **M16 module-level fields** into the new "Owner / Source / Standing rule" banner pattern.

### Tier 2 — High-value selects across all modules (2–3 days)

Apply selects + relabels + help to the high-leverage fields in: M5 (status, payer, care level), M6 (collection status, billing cycle), M7 (cadence, mobility, cognitive, fall risk), M8 (cadence, shift, documentation), M9 (department), M10 (scope, MAR source, MAR status), M11 (diet order, texture, assistance), M14 (stage, deposit, assessment status), M18 (category, contract, COI).

These are mechanical and parallelizable — one engineer can do all of them in an afternoon once Tier 1's renderer is in.

### Tier 3 — Plain-English relabel pass on the remaining free-text fields (1 day)

Everything else in this report — the textareas and free-text fields that can't be enumerated but still benefit from a question-shaped label, a placeholder, and one line of help.

### Tier 4 — Lookup-typed fields (covered in `m15-m18-ux-review.md`, do alongside Tier 2)

Promote `residentName` / `residentId` to the `relation: "resident"` lookup widget across M6/M7/M10/M11/M15. Promote `roomTarget` (M14) and `vendorOrOwner` (M13) to picklists from M3 and M18 respectively.

---

## Final Note

The catalog's underlying *operating model* is sound — these are the right modules and the right collections. The audit is purely a **labeling and input-type problem**. Every recommendation here can land without a single change to `state.js`, `scoring.js`, `gates.js`, or the data shape. The renderer learns four new field-spec keys (`type:"select"`, `options`, `placeholder`, `help`); the catalog grows three or four characters per field; and the roundtable goes from staring at *"severity rule"* to picking from a five-option dropdown.
