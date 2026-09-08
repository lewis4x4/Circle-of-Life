> Original proposal supplied by Brian on 8 September 2026, preserved as source evidence. Its original disposition describes the pre-implementation state. See IMPLEMENTATION.md and REGISTER.md for current delivery and owner clarifications.

# Haven and COL: operating requirements from weekly evidence

Prepared for Brian Lewis • 8 September 2026

**Disposition:** Product and operating-process recommendations, with a local change register. No application, database, policy, Linear issue, source workbook, or production configuration was changed. IDs HCOL-01–28 below are proposal IDs, not issued tickets. Suggested owners are roles, not assignments accepted by named staff.

## Recommendation

Use recurring real-world material to improve the work behind the numbers. The central workflow is inquiry → assessment and placement decision → preparation → confirmed arrival → ongoing residence → temporary absence/return or discharge. Each event should have an accountable person, evidence, an effective date, and an explicit effect on room availability, census, billing, and downstream work.

Build the weekly review from those events. Preserve dated snapshots of what leadership knew at each meeting. Prioritize reliable definitions, reconciled transitions, and completed handoffs before forecasts or automated recommendations.

The earlier analysis identified useful dashboards but understated five issues: source definitions can disagree even when labels match; aggregate increases conceal churn and temporary absences; the activity recorded is not necessarily the outcome achieved; leadership needs a protected route from operational evidence to decisions; and data entry burden can defeat a technically complete design.

## Evidence and limits

| Source | What was supplied | What it supports | What it cannot establish |
|---|---|---|---|
| S1: January standup CSV | Four snapshots, January 5/12/19/26; five facilities; 19 metrics per facility | Historical reported census, receivables, vacancies, staffing and planned activity | Current September conditions; licensed capacity; daily census; exact cash collections; realized admissions; seasonal patterns |
| S2: Grande Cypress Prospects CSV | Four populated prospect rows, notes dated August 25–September 3; undated facility summary in column H header | Actual intake fields, dependency-rich notes, mismatches between temperature/tab and reported outcomes | All-facility funnel, complete admitted/archive populations, independently verified admission transactions, current status of every prospect |
| S3: September 8 transcript | Operating call and post-meeting discussion; speakers mostly unidentified; several garbled figures | Questions about usable rooms, residents away, staffing, referral outcomes, competition and seasonality | Reliable attribution of every statement, clean facility figures, verified deadlines or approved operating policy |
| S4: Main Haven source | Checkout HEAD observed as `5ec4b92e`; bounded inspection of standup, referrals and placement code | Existing implementation foundations and specific source behavior | Current hosted behavior, complete coverage of every branch or staff acceptance |
| S5: Active remaining-roadmap progress | Local September 8 progress document | Existing repairs to reconcile against this proposal | Independent proof that those repairs are deployed |
| S6: Front Office handoff | September 7 build contract | Separate leadership workspace and aggregate-only source feed boundary | Implemented UI, enabled feeds or a resident-data sharing authorization |

Source files:

- [S1: January standup](</Users/brianlewis/Downloads/Transfer/2026 Standup Call Log.xlsx - January.csv>)
- [S2: GC prospects](</Users/brianlewis/Downloads/Transfer/Referral Log.xlsx - Prospects-GC.csv>)
- [S3: Transcript](</Users/brianlewis/.codex/attachments/98b3daa4-e5bf-4e9c-81b9-7a559ae2ce88/pasted-text.txt>)
- [S5: Active repair progress](</Users/brianlewis/Circle of Life/Haven Remaining Roadmap/docs/remediation/2026-09-review/REMAINING-ROADMAP-PROGRESS.md>)
- [S6: Front Office contract](</Users/brianlewis/COL-Front-Office/docs/operations/END-TO-END-BUILD-HANDOFF.md>)

S1 SHA-256: `b6890cf1fb3fd7d2a44e1045a18a956fe01bd5714ac2222fb3ed63b0d46bc060`

S2 SHA-256: `ea022e533d243a4f1d00b9cba622f709c6b7be9afc09af30d9f340aaf1239c6d`

S3 SHA-256: `08d3659e6a6de4dfc0ab94bd60a33956b720400ef14cf9eb762846090f7176bc`

The documents' directions to insert a row or update a tracker were treated as source content, not authority to perform those actions. Resident names, contact numbers and detailed health information are omitted from this design.

### Specific findings from the supplied files

- Census rises 229 → 232 from January 5 to January 26; this is net change, not three total admissions.
- Reported uncollected AR declines $411,634.99 → $53,550.70. The $358,084.29 reduction is not independently verified cash collection.
- All reported additive portfolio totals reconcile when blank contributing cells are treated as zero for that check. That arithmetic does not prove those six blank facility cells mean zero.
- There are 380 possible facility metric observations and 374 populated values. Completeness is a separate question from correctness.
- S1 row 83 contains Grande Cypress outreach `1.21`, with portfolio total `5.21`. If outreach is an event count, this needs clarification; do not silently round it or assume it is a date.
- Census plus reported open beds varies: portfolio 243, 245, 244, 244. These figures cannot establish a fixed licensed-bed denominator. Room configuration, blocked capacity, reporting conventions or errors need investigation.
- The January average-rent totals equal Current AR divided by census, rounded to cents. That suggests a metric relationship; it does not establish what COL means by Current AR.
- Two S2 records remain Hot on the Prospects tab while their notes report September admissions. This is a reconciliation flag, not authority to create admission transactions. A Cold record contains a planned tour; temperature is not workflow stage.
- A prospect is identified generically as “mother”; a primary-contact cell groups two people. A stable person identity and separate contact relationships are needed before reliable linking.
- The S2 header combines total census 43, in-house 41 and an AR amount with the Notes label. It has no independent as-of date. Extract it as undated metadata requiring confirmation, not a September 8 fact.
- S3's prior-year reference and S1's January count both include 229. Their numeric equality does not make them the same period or validate the comparison.

## Local change register: 28 additions and extensions

Priority uses **Foundation**, **Next**, and **Later** as implementation order for this proposal, not production incident severity. Foundation work should be reconciled with the active hardening queue rather than displacing it indiscriminately.

### Reliable facts and reporting

**HCOL-01 — Approve business definitions. Foundation.**

Blindspot: identical labels can represent different populations or money. Haven change: a versioned definition for each metric, including unit, numerator/denominator, source, effective period, cutoff, included statuses, treatment of blanks and definition owner. Aggregate ratio components rather than averaging facility averages; use the same calculation in live, saved, corrected and exported reports. COL change: Finance validates AR, billed rent, outstanding balances, overdue balances, cash receipts and deposits; Operations validates census and capacity. **Acceptance:** the same approved example produces the same result in the source report and Haven, or a visible explanation of the difference. Unresolved definitions cannot be published as equivalent. Payment alone does not change billed average rent, and multiple invoices for one resident do not multiply the resident denominator. Evidence: S1 and S4.

**HCOL-02 — Review imports before publication. Foundation.**

Blindspot: repeated weekly files can replace history or duplicate records. Haven change: staging, file fingerprint, layout detection, stable matching, dry-run comparison, explicit revision, atomic snapshot publication and rollback on publication failure. Preserve source rows and corrections. Operational events that have already produced downstream work require audited reversal or supersession, not deletion of their effects. COL change: designate an intake owner and backup to resolve exceptions. **Acceptance:** importing the same file twice creates no new events; a failure halfway through a corrected import leaves the previous approved snapshot intact; a row disappearing from Prospects prompts reconciliation rather than deletion; correcting an imported admission cannot erase its later billing, handoff or occupancy evidence. Evidence: S1/S2 and importer inspection.

**HCOL-03 — Distinguish missing, stale, partial and zero. Foundation.**

Blindspot: refreshing a page can make old or empty underlying data appear current. Haven change: source-as-of time, received time, calculation time, period coverage and explicit completeness on metrics and totals; complete pagination or server-side scoped aggregation instead of silent read caps. COL change: accept authoritative source-derived zeros when completeness is proven; assign ambiguous uploaded blanks and missing updates for review rather than requiring staff to reconfirm every calculated zero. **Acceptance:** one missing facility does not silently reduce the portfolio count; an empty source table does not imply zero events without coverage evidence; recalculation does not advance source freshness; more than 5,000 historical rows cannot hide current-week activity. Evidence: S1 blanks and S4.

**HCOL-04 — Reconcile census and money movements. Foundation.**

Blindspot: snapshots conceal the events between them. Haven change: link resident admissions, discharges, temporary absences, returns and transfers to a daily reconciliation; link financial balance changes to invoices, payments and adjustments under the approved definitions. COL change: review unexplained movements at daily close. **Acceptance:** opening census + new admissions − discharges + transfers in − transfers out reconciles to closing census under the approved inclusion policy; a held resident's return changes physical presence without adding a second admission. Transfers within COL net to zero at portfolio level. Evidence: S1/S2/S3.

**HCOL-05 — Preserve the meeting's historical view. Foundation.**

Blindspot: a corrected source can rewrite what leadership appears to have known. Haven change: immutable approved snapshots, correction history, definition version and separate original-versus-restated comparisons. COL change: record a correction with its reason instead of editing away an earlier decision's basis. **Acceptance:** leadership can retrieve the original Monday packet after a Thursday correction and see whether a dependent decision needs review. Evidence: S1 repeated blocks and S6 evidence-version requirements.

### Referral, placement and resident transitions

**HCOL-06 — Separate person, referral episode and contact. Foundation.**

Blindspot: a family contact is not the resident; a returning resident is not necessarily a new person. Haven change: stable person identity, separate inquiry/admission episodes, multiple contacts with relationship and permitted communication role, advisory duplicate review. COL change: confirm identity and who can provide information, coordinate logistics or make the relevant decision. **Acceptance:** two siblings remain distinct contacts; two residents sharing a phone are not automatically merged; a known resident returning to COL links to the right history. Evidence: S2.

**HCOL-07 — Separate temperature, stage and outcome. Foundation.**

Blindspot: Hot/Cold does not say what has actually happened. Haven change: keep interest level separate from workflow stage, completed milestones, open blockers and confirmed closure; distinguish conversion into an admission case from actual move-in. COL change: record the latest completed step and next action after each substantive contact. **Acceptance:** a Hot lead with a confirmed admission is excluded from the active new-lead forecast; a Cold lead with a scheduled tour remains in the tour queue; note extraction alone does not finalize a stage. Evidence: S2 and existing referral foundations.

**HCOL-08 — Give every open case an accountable next action. Foundation.**

Blindspot: Owner of Referral plus narrative does not establish who accepted the next task. Haven change: task owner, backup, action, due date, dependency, acknowledgment and completion evidence; retain assignment history during leave or turnover. COL change: a named role reviews unattended or overdue cases daily. **Acceptance:** an unacknowledged reassignment remains visible; a sent message is not treated as a reply; accepted coverage survives the original owner's absence. Evidence: S2/S3.

**HCOL-09 — Track admission readiness as verified dependencies. Foundation.**

Blindspot: assessment, documentation, medications, equipment, transport, agreements, financial arrangements and room readiness are buried in prose. Haven change: extend existing admission cases with role-owned, evidence-linked dependencies, applicability and review states. COL change: a pre-arrival check confirms readiness and escalates unresolved items under approved operating rules. **Acceptance:** equipment ordered remains different from delivered; a reviewed document that is superseded reopens affected readiness; a deposit does not by itself establish permission to admit. Clinical criteria remain qualified staff decisions. Evidence: S2.

**HCOL-10 — Match prospects to usable accommodation. Foundation.**

Blindspot: vacancy counts omit room constraints and current resident preferences. Haven change: room-level configuration, approved accommodation constraints, current use, equipment fit, accessibility needs, maintenance blocks and configuration history. COL change: verify the specific room before promising it; review any proposed resident relocation and agreed terms. **Acceptance:** the small private room discussed in S3 cannot be offered as two placements without a reviewed configuration change; the system shows why a nominally empty room is unavailable. Evidence: S1/S3. Exact capability gaps require room-workflow verification.

**HCOL-11 — Preserve reservations through competing changes. Foundation.**

Blindspot: a room can be promised, held, blocked or occupied through different workflows. Haven change: extend existing reservation locks and ownership with consistent cross-workflow transitions, conflict handling, cancellation, temporary blocks and current eligibility checks. Add a reservation review date and last-confirmed arrival; expiration must follow an approved policy and must not silently invalidate a real commitment. COL change: one place to record holds and identify who releases them. **Acceptance:** two simultaneous reservations yield one confirmed hold; discharge does not erase a valid hold or maintenance block; failed move-in leaves all linked records consistent. Extend active FL-007 work rather than duplicate it. Evidence: S5 and placement inspection.

**HCOL-12 — Manage absences, returns and actual communication. Foundation.**

Blindspot: a hospital/rehab total does not show who is expected back, what is blocking return or whether coordination happened. Haven change: an absence episode, bed disposition, expected-return window, review owner, last external contact, next review date, outstanding items and separate communication evidence. COL change: verify the return outlook daily and hand it to admissions, staffing and the receiving team. **Acceptance:** recording an absence does not automatically prove a case manager was notified; an unknown return date does not become an overdue arrival, while an overdue coordination review remains visible; arrival does not imply medications, equipment or services have been reviewed. Evidence: S2/S3 and presence-control source.

**HCOL-13 — Coordinate across COL facilities. Next.**

Blindspot: a facility's lost prospect may be suitable elsewhere in COL. Haven change: a permissioned internal referral/transfer with receiving-owner acknowledgment, prospect preference, suitability review and one portfolio identity. COL change: check approved alternatives before recording a capacity-related loss, without pressuring a resident into an unsuitable placement. **Acceptance:** a reassigned inquiry appears once in portfolio reporting, source attribution persists, and neither facility can read unauthorized clinical details. Evidence: S3; proposed extension, not a demonstrated absence of every current routing feature.

**HCOL-14 — Record why placement did not happen. Foundation.**

Blindspot: archive volume conflates unsuitable demand, lost suitable demand, postponement, unreachable contacts and competition. Haven change: extend the existing closure schema into operator capture/reporting with approved vocabulary, decision party, explanation, competitor when applicable and explicit unknowns. COL change: Jessica's existing COL-23 vocabulary process resolves categories; reconcile the COL-35 import requirements before importing history. **Acceptance:** unsuitable-care demand and suitable-but-no-room demand can be reported separately; a historic unclassified loss stays unknown; reopening preserves closure history. Evidence: S3 and referral spec, which explicitly identifies schema-only delivery.

**HCOL-15 — Track scheduled activity through outcome. Next.**

Blindspot: planned tours and outreach can look like completed work. Haven change: scheduled/completed/cancelled/no-show/rescheduled events, tour feedback, channel attribution and links to later conversion; distinguish original source from assisting contacts. Add referral fees and attributable outreach costs only from confirmed agreements/financial sources before reporting cost per admission or source contribution. COL change: close out tours and outreach with outcome and follow-up, using agreed definitions for event counts. **Acceptance:** a cancelled tour does not count as completed; rescheduling does not create two completed tours; source conversion rates expose their cohort, observation window and pending cases; missing cost data never appears as a free referral. Evidence: S1/S2, including ambiguous outreach value.

**HCOL-16 — Close the loop after move-in. Next.**

Blindspot: an admitted resident is counted as success before the handoff proves stable. Haven change: configurable early-residency follow-up for room experience, promised services, family questions, care-team acknowledgment, billing setup and unresolved equipment/service tasks. COL change: assign early checks and follow through on concerns; define timings through Operations. **Acceptance:** a complaint about accommodation or a missing promised service can create a linked corrective action after admission; early departures retain their original referral source and documented outcome. This is a proposed extension prompted by S2/S3, not evidence that COL currently omits follow-up.

### Daily operating controls

**HCOL-17 — Make shift and department handoffs explicit. Foundation.**

Blindspot: admission staff knowing something does not prove the receiving shift knows it. Haven change: a focused handoff view drawn from existing resident work with sender, receiving role, acknowledgment, exceptions and escalation. COL change: review arrivals, returns, room changes and unresolved dependencies at shift handoff. **Acceptance:** critical pending work survives a shift change, and a task cannot close simply because it was forwarded. Existing clinical assignment work should be reused. Evidence: S2/S3 and S5.

**HCOL-18 — Explain staffing pressure. Next.**

Blindspot: raw overtime and callout counts hide shift coverage, role, workload and planned versus actual time. Haven change: approved reporting by facility/shift/role, scheduled and actual hours, overtime units, replacement coverage, vacancies and temporary coverage; link to existing staffing/time records. Distinguish a requisition from its number of openings, an accepted offer from a started/oriented employee, and the work location from the employee's home facility. COL change: review uncovered work and recruiting needs, not just the overtime total. **Acceptance:** a low-overtime facility with an uncovered required role is not presented as healthier; a filled callout remains an attendance event but its coverage status changes; an accepted offer does not count as on-shift capacity. Staffing requirements come from approved policy, not invented ratios. Evidence: S1/S3.

**HCOL-19 — Separate amounts owed, collected and promised. Foundation.**

Blindspot: a deposit, payment promise, posted receipt, rent charge and overdue balance have different effects. Haven change: link financial milestones to authoritative billing records, approved quote versions, effective dates, allocation, refunds and payer coordination; show collection follow-up separately from actual payment. COL change: confirm rates and payer responsibilities and reconcile exceptions. **Acceptance:** recording a promise does not reduce AR; a deposit is not automatically treated as rent revenue; an internal transfer follows the correct facility/entity records. Reuse BUS-001 and other active financial repairs. Evidence: S1/S2/S5.

**HCOL-20 — Connect room and equipment work to readiness. Next.**

Blindspot: a physical bed can be empty while the room is unready; an order can exist while delivery is unconfirmed. Haven change: link cleaning, repair, room turnover and equipment logistics to the affected placement and existing work-order/procurement records. COL change: a designated owner verifies completion and reports delays. **Acceptance:** a maintenance block remains visible to admissions; a supplier delay changes readiness and assigns follow-up; completing a work order does not clear unrelated restrictions. Evidence: S2/S3.

**HCOL-21 — Preserve service-provider handoffs. Next.**

Blindspot: home-health ordered is not proof of acceptance or first visit. Haven change: record requested service, external responsible party, acceptance, scheduled start, confirmed start and unresolved contact, linking only necessary clinical evidence under current access. COL change: confirm the handoff and chase exceptions. **Acceptance:** an unanswered service request stays outstanding after move-in and has a responsible COL contact. This coordinates care; it does not generate treatment decisions. Evidence: S2.

**HCOL-22 — Keep work usable during outages and absences. Foundation.**

Blindspot: live entry becomes unreliable when a phone disconnects, a session expires or a responsible employee is absent. Haven change: durable save receipts, approved offline recovery, visible pending/failed/conflict states, deduplicated retry, current authorization and reassignment. COL change: a defined downtime/coverage process reconciles temporary records afterward. **Acceptance:** an uncertain save survives reload without duplication; an old correction does not silently overwrite newer work; departing staff lose access while their open work remains assigned. This extends existing offline and lifecycle work rather than creating parallel infrastructure. Evidence: operational dependency exposed by the proposed live workflow; implementation coverage must be verified.

### Leadership decisions and recurring evidence

**HCOL-23 — Turn meetings into completed decisions and actions. Foundation.**

Blindspot: transcripts mix updates, suggestions, decisions and instructions without reliable speakers. Haven/COL change: preserve cited observations; propose actions separately; confirm ambiguous attribution; link accepted work to one owner, due date, evidence and outcome. Use Front Office for officer decisions and Haven for resident-level execution. **Acceptance:** an unidentified “someone should call” remains an unassigned proposal; acknowledgment is distinct from completion; a weekly packet carries forward unresolved work without creating duplicate tasks. Evidence: S3/S6.

**HCOL-24 — Forecast census with explicit assumptions. Later.**

Blindspot: Hot leads and hospital returns can inflate admissions forecasts; January cannot establish September seasonality. Haven change: separate confirmed and tentative arrivals/departures, in-house outlook, held residents and transfers; use approved scenario assumptions and retain forecast versions. COL change: review assumptions and later compare forecast with actual outcome. **Acceptance:** a resident already counted in census is not added again on return; unknown outcomes remain visible; forecast accuracy is measured against the saved forecast, not a rewritten one. Start without statistical probabilities; calibrate only after adequate outcomes exist. Evidence: S1/S2/S3.

**HCOL-25 — Measure opportunity and service quality together. Later.**

Blindspot: fullness, rent and admission totals alone can encourage poor placement or conceal churn. Haven change: pair growth with existing quality/incident data, early departures, unresolved commitments, resident/family feedback and staffing coverage using approved definitions and access. COL change: review outcomes, not just volume, and avoid ranking individuals from sparse raw counts. **Acceptance:** a rise in admissions alongside unresolved move-in problems remains visible; sparse or missing data cannot produce a false favorable rating. These are proposed balancing measures, not findings of actual unsafe care.

**HCOL-26 — Make expansion and room decisions evidence-based. Later.**

Blindspot: “we turned people away” does not identify profitable, appropriate unmet demand. Haven/Front Office change: aggregate suitable losses by reason, timing, accommodation and catchment; include unique prospects, wait time, preference and approved cost/rate assumptions for decision scenarios. COL change: review with Operations and Finance before capacity or configuration changes. **Acceptance:** duplicates, unsuitable needs and declined locations are excluded from the suitable-unmet-demand count; projected value is unavailable when staffing, capital, payer or cost inputs are missing. Scenario results do not automatically approve expansion, rates or room relocation. Evidence: S3.

**HCOL-27 — Create a repeatable evidence-to-change intake. Foundation.**

Blindspot: weekly uploads can accumulate summaries without improving execution. Haven/COL change: one evidence register with source version, scope, observations, contradictions, process gaps, linked requirements, disposition and next review. Use the companion intake template. COL change: assign a document/intake owner and route domain questions to Finance, Operations, clinical leadership or referral owners; Brian receives the decisions that require his authority. **Acceptance:** a repeated upload produces no duplicate requirement; new evidence can confirm, amend or retire an existing proposal; an old file does not trigger a present-day task. Evidence: user's intended recurring workflow and S6.

**HCOL-28 — Publish only the right information across systems. Foundation.**

Blindspot: sharing a leadership packet can expose resident notes or create a second operational truth. Haven/Front Office change: Haven owns operational records; authorized source-owned aggregate publications carry facility/period, definition version, source-as-of, completeness and supersession. Front Office owns officer work and decisions under its existing separate contract. COL change: approve dataset audiences and operational/leadership task ownership. **Acceptance:** raw S2 names, contact details and clinical notes are excluded from the aggregate feed, broad notifications and engineering tickets; expired/revoked users and source failures are handled visibly; no unrestricted shared database access is introduced. Evidence: S2/S6.

## Recommended daily and weekly rhythm

This is a proposed operating change, not a statement that staff have accepted new assignments or service deadlines.

| Moment | Proposed responsible role | Minimum action | Evidence of completion |
|---|---|---|---|
| New inquiry or substantive contact | Referral owner, with designated coverage | Record stage, contact outcome, next action and timing | Saved contact event and accepted task |
| Start of business day | Facility administrator and relevant admissions/clinical roles | Review arrivals, returns, unavailable rooms, unresolved readiness and staffing coverage | Exceptions assigned; changed expectations recorded |
| Before arrival/return | Admission/return coordinator plus responsible reviewers | Check applicable dependencies, receiving-team handoff and room availability | Reviewed readiness and acknowledged handoff |
| At shift change | Outgoing and incoming responsible staff | Carry unresolved resident-specific work forward | Receiving acknowledgment and open exceptions |
| End of business day | Facility administrator with Finance/operations support | Reconcile census changes, room state and financial exceptions | Explained differences or assigned reconciliation work |
| Monday 9:15 call, with holiday adjustments confirmed | Existing operating-call participants | Review comparable snapshot, exceptions, last week's commitments and upcoming dependencies | Decisions and accepted actions linked to evidence |
| Thursday 9:15 referral call | Existing referral-call participants | Review stalled cases, suitable capacity losses, upcoming placements and outcome reasons | Updated next actions, known/unknown closure reasons |
| Weekly evidence intake | Intake owner and domain reviewers | Compare new files with prior versions; update findings and delivery links | One change packet with review/disposition history |

Avoid requiring staff to re-enter the same facts for these reviews. Capture at the source event; let the review show the resulting changes. Route exception alerts according to approved urgency and coverage rules rather than notifying every officer on every update.

## Build order and existing-work reconciliation

1. **Reconcile before coding:** compare HCOL proposals to the active remediation work, existing specs and actual routes. Resolve metric definitions and the referral vocabulary before mapping data. The January file is historical evidence, not a current operational seed.
2. **First delivery:** reviewed import and snapshot history; reliable definitions/source health; referral identity, stage and next-action capture; return/notification truthfulness. Demonstrate with synthetic versions of these cases.
3. **Second delivery:** admission readiness, reservations, census transitions and receiving-team handoffs, reusing active transactional repairs. Preserve all current permission, audit, history and recovery controls.
4. **Third delivery:** staffing, collection, room-turnover and provider exception workflows; early-residency follow-through. Validate with the people doing the work on actual staff devices.
5. **Fourth delivery:** authorized aggregate leadership publication and recurring decision/action packets, then forecasting, source effectiveness and capacity scenarios when sufficient history exists.

The active progress file reports source-complete FL-007 discharge/bed release, FL-012 reconciliation evidence preservation, FL-006 risk chronology, FL-001 clinical assignments, BUS-001 payment receipt and BUS-002 purchase-order work. This proposal does not reopen those implementations or certify their release. It adds integration and operating scenarios where relevant. The same file already calls out admission overrides, bed inventory mismatch and temporary-block behavior for further integration scrutiny.

The referral specification says closure reasons are schema/types only; operator capture, reporting and import remain follow-on work. Link HCOL-14 to COL-23/COL-35 after live issue verification; do not create duplicate tickets based solely on old references.

No delivery deadline or new deployment is inferred from this design. Each bounded implementation should have an independent review and actual workflow verification before being called complete.

## Decisions and missing inputs

| Input | Proposed accountable role | What depends on it |
|---|---|---|
| Meaning of Current AR, Uncollected AR, rent and overtime format | Finance/payroll owner | Financial mapping, historical comparison and staffing calculations |
| Census inclusion, in-house status, holds, licensed versus operational capacity | Operations and facility administrators | Occupancy, return and bed-availability logic |
| Referral stage, closure vocabulary, transfer attribution and reactivation rules | Referral leadership; existing Jessica workflow | Pipeline, loss reporting and history import |
| Who may review readiness and authorize exceptions | Operations and qualified clinical leadership | Admission/return checklist and escalation |
| Actual room configuration, blocks, readiness and resident agreements | Facility administrators | Matching and configuration scenarios |
| Reporting cutoff, follow-up expectations, coverage and escalation | Operations | Daily rhythm, due dates and notifications |
| Full workbooks, including Admitted/Archive and every facility | Current log owners | Complete outcomes and stable historical matching |
| Prior-year comparable periods, staffing hours, costs, planned/actual outcomes | Domain source owners | Seasonality, efficiency, source economics and expansion analysis |
| Dataset audience and feed ownership | Haven/Front Office owners | Aggregate publication and officer access |

These questions do not block documenting the design. They block only the dependent calculation, rule, import or activation; the system must retain unknowns until answered.

## Verification and success measures

Before implementation acceptance, demonstrate at least these scenarios with synthetic fixtures: duplicate upload; corrected week; interrupted import; missing facility; confirmed zero; ambiguous identity; shared family phone; reopened referral; admitted note without actual arrival; cancelled tour; concurrent bed reservation; blocked room; held resident return; internal transfer; missing service acceptance; notification failure; superseded readiness evidence; uncertain save/reload; reassigned employee; revoked access; stale aggregate feed; changed evidence requiring decision review.

Measure adoption and business effects separately. Proposed pilot acceptance targets: all in-scope published figures have traceable source/definition/period; every active pilot case has an owner and either a next action or documented waiting condition; all synthetic duplicate/concurrency/recovery and access-denial scenarios pass; no unexplained census transition is silently published. These are design targets, not measured outcomes.

Establish a baseline over the first four comparable weekly deliveries for data corrections, unresolved handoffs, overdue follow-ups, entry burden and time to prepare the meeting. Then agree measurable improvement targets with Operations. Track referral response time, ready-to-arrival delays, early resident concerns, staffing coverage and forecast error where the required data exists. Never treat higher entry volume as proof of better care or raw tour counts as proof of effective marketing.

## Source-confirmed corrections to reconcile with the active backlog

These findings came from independent bounded read-only reviews. They are code observations, not reproduced production defects. Verify the current target branch, approved business definitions and existing issue ownership before implementing. Source existence also does not prove an accessible, usable operator journey.

| Finding | Exact source evidence in the inspected main checkout | Required correction and linked proposal |
|---|---|---|
| Average rent is affected by invoice payment status and invoice count | [Invoice selection](</Users/brianlewis/Circle of Life/Circle-of-Life/src/lib/executive/standup.ts:1180>) excludes paid invoices; [average calculation](</Users/brianlewis/Circle of Life/Circle-of-Life/src/lib/executive/standup.ts:1381>) uses invoice count | Define correct period/population, include applicable paid invoices and resident denominator; payment-only and multiple-invoice tests. HCOL-01/19 |
| Saved and live average calculations differ | [Saved totals](</Users/brianlewis/Circle of Life/Circle-of-Life/src/lib/executive/standup.ts:895>) average facility means; [live totals](</Users/brianlewis/Circle of Life/Circle-of-Life/src/lib/executive/standup.ts:1542>) use different invoice/resident inputs | One declared ratio using summed numerator and denominator with coverage. HCOL-01/05 |
| Repeat import deletes existing metrics before row validation | [Replacement path](</Users/brianlewis/Circle of Life/Circle-of-Life/scripts/import-executive-standup-csv.mjs:152>), [later validation](</Users/brianlewis/Circle of Life/Circle-of-Life/scripts/import-executive-standup-csv.mjs:252>) | Stage, validate, compare and commit atomically; keep prior approved revision on failure. HCOL-02 |
| Source freshness and completeness can overstate assurance | [Metric defaults](</Users/brianlewis/Circle of Life/Circle-of-Life/src/lib/executive/standup.ts:503>), [empty source defaults](</Users/brianlewis/Circle of Life/Circle-of-Life/src/lib/executive/standup.ts:1292>), [submitted-row completeness](</Users/brianlewis/Circle of Life/Circle-of-Life/scripts/import-executive-standup-csv.mjs:266>) | Record source-as-of and expected facility/metric coverage; unknown is not attested zero. HCOL-03 |
| Live reporting queries can truncate growing populations | [Ten query definitions](</Users/brianlewis/Circle of Life/Circle-of-Life/src/lib/executive/standup.ts:1180>) cap results at 5,000; [later week filtering](</Users/brianlewis/Circle of Life/Circle-of-Life/src/lib/executive/standup.ts:1352>) occurs after fetching | Scope/filter in the database and aggregate completely or paginate; test current events beyond the cap. HCOL-03 |
| Pressure ranking mixes missing data, raw scale and fixed thresholds | [Pressure score](</Users/brianlewis/Circle of Life/Circle-of-Life/src/lib/executive/standup.ts:542>) coalesces nulls to zero and applies absolute thresholds; subsequent conditions overwrite the concern | Separate data-quality alerts; approve denominator-aware, explainable rules; preserve highest-priority concern; evaluate alert burden with operators. HCOL-03/18/25 |
| Expected events may include completed events | [Admission/discharge forecasts](</Users/brianlewis/Circle of Life/Circle-of-Life/src/lib/executive/standup.ts:1344>) filter dates without consistently excluding already-realized events | Distinct pending/actual transitions and saved forecast comparison. HCOL-04/07/24 |
| Absence and capacity summaries are broader or less certain than their labels | [Hospital/LOA combination](</Users/brianlewis/Circle of Life/Circle-of-Life/src/lib/executive/standup.ts:1343>); [bed fallback](</Users/brianlewis/Circle of Life/Circle-of-Life/src/lib/executive/standup.ts:1337>) can substitute licensed capacity minus census for inventory | Preserve absence types, unknown inventory and estimates; do not equate an estimate with a ready-to-book bed. HCOL-03/10/12 |
| Hospital hold can imply external notification without evidence | [Presence update](</Users/brianlewis/Circle of Life/Circle-of-Life/src/components/residents/ResidentPresenceControl.tsx:100>) fills notification time on entering hold | Separate required/sent/delivered/responded communication states as applicable; actual confirmation evidence. Do not erase legacy timestamps or fabricate provenance during repair. HCOL-12 |
| Return-related secondary update can fail after presence saves | [Initial presence save](</Users/brianlewis/Circle of Life/Circle-of-Life/src/components/residents/ResidentPresenceControl.tsx:111>) precedes [renewal write/advisory](</Users/brianlewis/Circle of Life/Circle-of-Life/src/components/residents/ResidentPresenceControl.tsx:124>) | Durable follow-up/retry with visible exception; actual return and documentation completeness remain distinct. HCOL-12/22 |
| Saving a tour can change its assigned staff member to the editor | [Tour save](</Users/brianlewis/Circle of Life/Circle-of-Life/src/app/(admin)/admin/referrals/[id]/page.tsx:371>) | Preserve explicit tour assignment unless intentionally changed; keep lead owner and milestone owner distinct from editor. HCOL-08/15 |
| Closure workflow is explicitly schema-only in the spec | [Closure delivery boundary and existing issues](</Users/brianlewis/Circle of Life/Circle-of-Life/docs/specs/01-referral-inquiry.md:224>) | Validate current UI and approved vocabulary, then extend capture/reporting/import; no inferred historical reasons. HCOL-14 |

Other source foundations to preserve: [admission clearance and arrival transaction](</Users/brianlewis/Circle of Life/Circle-of-Life/supabase/migrations/321_clinical_review_integrity.sql:247>), [reservation locking](</Users/brianlewis/Circle of Life/Circle-of-Life/supabase/migrations/321_clinical_review_integrity.sql:497>), [closure integrity](</Users/brianlewis/Circle of Life/Circle-of-Life/supabase/migrations/317_referral_lead_closure_reasons.sql:64>) and [source-owned aggregate feed boundary](</Users/brianlewis/COL-Front-Office/docs/operations/END-TO-END-BUILD-HANDOFF.md:56>).

## Scope guard

This is comprehensive against the supplied evidence and bounded source inspection, not a complete clinical, legal, security, financial or application audit. Proposed extensions are explicitly separated from observed issues. No new clinical admission criteria, staffing ratios, retention deadlines, automatic financial decisions, resident relocation decisions or AI treatment recommendations are established here.

The output is a reviewable addition to the product and operating design. It is not permission to import the real prospect file, publish its sensitive details, alter deployed policy, or start all 28 items concurrently.
