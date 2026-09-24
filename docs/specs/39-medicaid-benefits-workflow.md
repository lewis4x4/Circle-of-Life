# Medicaid benefits workflow — COL-504

Status: Implementation authorized by Brian on 2026-09-21. Staff/provider acceptance remains separate.
Source: Jessica discussion, 2026-09-16; New Admits Medicaid Pending Criteria, seven-page forms packet, Grande Cypress MCD master packet. Insurance loss files excluded.
Mission alignment: pass — one resident identity, current authority, attributable evidence and actionable work.

## Outcome and acceptance

A persistent benefits case starts for an existing resident or admission and survives move-in. Authorized staff can see the next action, person and deadline; collect and review private evidence; record independent screening, CARES, DCF, enrollment and authorization outcomes; assemble a submission and record delivery/receipt; hand verified funding facts to billing; track renewal, denial, closure and reopening. Documents and submission histories are immutable evidence, not inferred approval.

P0: current session/facility authority, explicit financial access grants, no direct anonymous data access, optimistic revision and idempotent commands, append-only history, private verified uploads/downloads, requirements and source-specific review, separate agency milestones, submission manifests and receipts, staff queue, resident/admission navigation, reviewed billing handoff, renewals and exceptions. P0 includes honest unknown/error/empty states. No automatic notices, resident admission, payer changes, retroactive dates or agency approval.

P1: scoped family upload collection using existing family financial/decision authority; generated case cover sheet and reviewed packet export; exact form/template version tracking with manual signed-document return when provider configuration is unavailable. E-signature: Haven has no BoldSign (or other) e-signature integration today, so signed documents come back as manual signed-document returns with `signature_status` reviewed and `signed_on` recorded by the reviewer; if an e-signature provider is ever configured, it may only send exact approved Medicaid templates, never a default template.

AI extraction is optional and remains under the existing parser's provider/BAA policy. Manual classified input is fully supported; AI may not decide eligibility, sign, issue notices or change finances.

## Design and integration

Create a benefits case linked to the canonical resident and optional admission, not another person, CRM or admission. Reuse current actor/session authorization and facility relationship checks. Financial documents use a dedicated private benefits evidence bucket because the general resident document policy permits wider staff access. The benefits case is linked from the resident/admission and staff operations navigation. Its requirements are specialized case work; do not insert unclassified operations occurrences or widen operation financial authority. A future classified operations occurrence may reference the case with minimal metadata.

Owner/org admin may administer explicit benefits access for current staff with facility scope. Other allowed staff roles require a current unexpired grant; financial data are not broadly available to coordinators, marketers, family contacts or general chart readers. Separate write and review capabilities. Family evidence collection must check the current financial/decision linkage, not just portal access.

## API contract

- GET /api/admin/benefits/cases?facility_id=&resident_id=&status=&before=&limit= : bounded currently authorized queue, case identity and labels, next actions/deadlines, pagination. Unknown data never become zero.
- POST /api/admin/benefits/cases: resident_id, optional admission_case_id, program, request_id. Derive organization/facility from resident. One active case per resident/program; no history backfill that opens residents or invoices.
- GET /api/admin/benefits/cases/[id]: case, requirements, documents, events and submissions; current permissions.
- POST /api/admin/benefits/cases/[id]/commands: action, payload, request_id, expected_revision. Atomic current-authority command and audit, payload-bound idempotent replay, 409 on stale revision.
- POST /api/admin/benefits/cases/[id]/documents: multipart file and expected_revision/request_id, server verifies size, MIME signature and hash; creates immutable evidence using a private bucket and current authority. Download through checked API only, no public links.
- GET /api/admin/benefits/cases/[id]/documents/[documentId]: current scoped checked immutable bytes, no-store.
- GET/POST /api/admin/benefits/access: owner administration, current facility staff only, expiry/revocation, no proxy approvers.
- GET /api/admin/benefits/options: authorized facilities, residents and allowed assignees; queryable bounded resident selection.

All routes require current authenticated actor, deny stale/disabled/password-change actors, return 400 invalid, 401 session, 403 role (from the session layer), 404 unavailable subject, 409 conflict, 503 unverified dependency. Deliberately, a missing benefits grant and an unknown case both answer 404 at the RPC layer so that case identifiers cannot be enumerated by an ungranted staff account; the UI distinguishes "no access" from "no cases" with its own copy. Lists/downloads are no-store. The database RPC repeats authority and subject checks; a service key does not supply staff identity for mutations.

## Data and invariants

Canonical implementation DDL is the COL-504 migration, with RLS, private schema helpers, explicit execute grants, case/requirement/document/event/submission/access tables, indexes by facility/current status/due date, and immutable audit events. All resident, admission, document and assignee references must belong to the same current organization/facility. A resident transfer fails closed until an explicit reviewed rebind preserves history. Actor, time and organization are server-derived.

Case revision increments atomically for commands; a request UUID is bound to actor, action, case and payload. Same request returns original result only while the actor still has authority. Closure requires a reason and preserves every child. Reopening cannot imply renewed coverage. Every screen can save partial facts. Required evidence blocks only its submission stage. Acceptance requires reviewed evidence or explicit reasoned not-applicable; uploaded does not equal accepted.

Screening captures income/assets in integer cents, knowledge state for property/policies/burial/POA/marriage, notes and rule reference. The 2026 DCF standard is source context, not a universal automatic decision. Record gross/countable/unknown basis explicitly. Staff review over-limit/unknown cases. Agency events and funding dates are independent. No hardcoded score-to-approval transition.

Submission stores exact immutable document IDs/hashes at preparation, destination/method, sent time, external reference, received time and receipt evidence. Unreviewed/rejected evidence cannot silently become a ready submission. Signature validity is a distinct review, not image presence. A 45-day notice requires explicit recorded issuer/reviewer and evidence, never automatic creation or delivery. Signed dates must reflect actual signatures; no copied signature image or undated-template convention is automated.

Funding handoff records plan, reference, coverage dates, resident contribution, expected benefit and renewal date, with reviewed agency/enrollment/authorization evidence. It opens the existing resident billing workflow for authorized billing staff; no invoice or payer write occurs from a benefits stage change. Received payment remains the billing ledger's fact.

## UI and failure behavior

Routes /admin/benefits and /admin/benefits/[id]. Shared Haven UI primitives; laptop queue and detail sections, tablet stacking, phone single column with accessible labels and 44px actions. Tabs: overview/screening, requirements/documents, agency history/correspondence, submissions, funding/renewal. Actions preserve drafts on failure, display conflicts and permit refresh. Access denied is distinct from successful-empty. Case needs action versus waiting on agency distinguish staff time from external delay. Attachments never show in broad operations notifications.

## Rollout, verification and recovery

Additive backward-compatible migration; the existing admission Medicaid selector (`admission_cases.medicaid_pipeline_stage`) remained untouched at first release (superseded 2026-09-24 — see *Amendment A*, which retires it): production held zero admission cases on 2026-09-22, so there is nothing to migrate, and existing Medicaid residents enter through the queue's "Medicaid residents without a benefits case" list instead. Rollback = `scripts/benefits/rollback-write-rpcs.sql` (revokes the public write wrappers, keeps every table, bucket and history); destructive DROP is not a production rollback. A down script may drop only an empty disposable verification database, never live evidence.

Verify SQL current-authority/grant revocation/cross-facility references/direct API bypass, optimistic concurrency and payload-bound replay; API malformed body/upload checks; UI happy/error/empty paths; real local browser sequence and a11y; segment gates; PR required CI; post-merge CI; production migration ledger and exact revision; hosted role/scoped smoke. Technical release is separate from Jessica/provider acceptance. Do not send resident data to third parties during synthetic verification.

## Operating rules (COL-504 quality review, migration 451)

No business value is fixed in code. `public.benefits_rules` holds effective-dated, append-only, organization-scoped rules an owner or org admin records with a reason under **Benefits access → Operating rules**; a change takes effect today or on a future date and never rewrites the past. Cases already open keep the requirements they were created with.

| Rule | Meaning | Seeded value (source) |
|---|---|---|
| `checklist.smmc_ltc` / `checklist.oss` / `checklist.other` | Requirements seeded on a new case for that program | 18 items from Jessica's 2026-09-16 packet (also the built-in default for a new organization); OSS and other start empty |
| `screening.standard_individual` | Review-aid income/asset limits shown beside saved screening facts; never an eligibility decision | DCF 2026 Appendix A-9 individual ICP/HCBS: $2,982 income, $2,000 assets, effective 2026-01-01 |
| `screening.admission_gate` *(Amendment A)* | Circle of Life's own admission-time Medicaid gate: which answers mean "does not qualify now" and the income line used by question B | Q-A (non-primary property) or Q-B (income over $2,829/month) = does not qualify now; Brian, 2026-09-24 |
| `screening.recheck_days` *(Amendment A)* | Days between admin rechecks of a resident who answered yes to Q-A or Q-B | 90 (quarterly); Brian, 2026-09-24 |
| `score.reapply_days` *(Amendment A)* | Days after a score below 5 before Haven prompts Jessica to reapply | 30; Brian, 2026-09-24 |
| `family_collection.max_days` | Longest a family upload request stays open | 90 days |
| `renewal.warning_days` | The queue flags a case this many days before its recorded renewal date | 60 days |

Also from the review: the queue orders by due date (undated last) with a keyset cursor and flags overdue, due-soon, renewal-due, resident-moved and resident-departed cases; a case whose resident changed facilities stays readable and flagged and is moved by an explicit **rebind** requiring review authority on both facilities; every download or packet export of financial evidence is appended to the case history (`document_download`, `document_packet`) without moving the revision; residents who already carry a Medicaid payer but have no active case are listed on the queue so renewals for existing residents enter the workflow; reopening may state the next action in the same command.

## Decisions and open operational questions

- Dedicated private benefits evidence storage prevents general-chart access leaking financial files; reuse the current byte validation and server download patterns.
- Separate case lifetime from admission to cover existing private-pay residents, long review times and renewals.
- Manual agency submission/confirmation is a supported complete workflow while APIs are unconfirmed. No invented integrations or silent successful delivery.
- **Ruled 2026-09-22 (Brian):** the telephone assessment score is assigned by the agency assessors, not a Circle of Life rule of thumb; five or higher is the agency's own result that moves the resident forward, and Haven records it as the agency's reported outcome.
- Still open: exact current form acceptance/signature conventions (undated ACCESS pages, signature image), financial-exposure approval policy for Medicaid-pending admissions, facility-specific master packets (only Grande Cypress supplied), and Jessica's designated backup. Questions sent to Jessica 2026-09-22. Core case work remains available.
- Size: large, delivered through bounded independently verified changes; timing depends on CI, migration and hosted provider verification, not an invented hours estimate.

## Amendment A — admission-led screening and the Medicaid board (2026-09-24)

Status: direction ruled by Brian on 2026-09-24; not yet implemented. Supersedes the conflicting lines above where noted.
Source: New Admits Medicaid Pending Criteria (photo, `IMG_3696`); Jessica's *Medicaid Log* workbook (per-facility tabs, Completed, Murphy Notes, Contacts); DOEA 701S telephone screening form and staff cheat sheet; DOEA 701B CARES on-site assessment; Brian's review of the shipped `/admin/benefits` screens.
Mission alignment: pass — the answers staff already ask at admission drive the case, so a candidate is never missed and nobody types the same fact twice; humans still make and own every agency-facing step.

### Why

The shipped case workspace is a sound evidence file, but it is not how Circle of Life works Medicaid. Jessica runs one row per resident per facility with a date in each step column; the owner report (Murphy Notes) is built from those rows. Haven today asks nothing about Medicaid at admission except an optional payer dropdown, keeps a second, disconnected Medicaid stage on the admission case, and opens every benefits case at "Unknown" financial fields. A resident who could be applied for is only found when someone remembers.

### Rulings (Brian, 2026-09-24)

1. **The six questions are asked at admission** and carry into the benefits case. They replace the "Anticipated payer source" dropdown's Medicaid role in `admissions/new`.
   - A. Do you own any property that is not your primary residence?
   - B. Is your income over $2,829 per month?
   - C. Do you have a life insurance policy?
   - D. Do you have a burial contract?
   - E. Do you have any assets (IRAs, CDs, stocks, bonds)?
   - F. Do you have a power of attorney?
2. **A yes to A or B = does not qualify now.** A yes to C, D or F never disqualifies; each becomes a document to gather. E (assets) with a countable balance above the asset limit ($2,000, stored in the gate rule) also means does not qualify now (Brian, 2026-09-24, COL-759); a balance at or under the limit is gathered as evidence.
3. **Holding Medicaid is not the same as long-term-care Medicaid.** A resident with a regular Medicaid ("gold card") or MMA-only coverage is still a candidate to apply for. Intake records current coverage separately: none / Medicaid (gold card, MMA only) / SMMC-LTC enrolled (plan) / application already pending.
4. **Quarterly recheck, only for A/B = yes.** Every 90 days the facility administrator is alerted to re-ask the resident. If nothing changed, one confirmation schedules the next check. If an answer changed, the administrator re-enters the six answers and supplies the updated documents in the same form, and the resident moves to Jessica's queue as a candidate.
5. **Only a CARES/DOEA score of 5 moves forward.** The agency does not explain scores below 5; Haven records the number only and never interprets it. Below 5: the case waits and Haven prompts Jessica to reapply 30 days later. (Replaces "five or higher" in the 2026-09-22 ruling above — 5 is the maximum, so the effect is the same; wording aligned.)
6. **Roles.** Jessica Murphy owns, tracks and submits every case. The facility administrator gathers the resident's documents (bank statements, POA, life policies, burial contract, asset statements) and answers rechecks.
7. **Income line is $2,829**, owner-confirmed. It is stored as an effective-dated `benefits_rules` value (`screening.admission_gate`), not code. The DCF review-aid row (`screening.standard_individual`, $2,982) stays as source context on the case detail only and is not used for the admission gate.
8. **This gate is COL-575's preliminary review.** The 2026-09-22 ruling (Brian / Michelle, DEC-2026-09-22-08) stands: a resident expected to rely on Medicaid cannot be marked moved-in until the six answers are recorded and a person has marked the result, or a Facility Executive overrides with a reason. Intake coverage values reconcile with COL-575's *Already has Medicaid / Will apply after move-in / Private pay*.
9. **Eastside was sold.** Its tabs in the Medicaid Log are history and are not imported. The $600 "lowest income" line on the criteria sheet is obsolete and is not modelled.

### Behavior

**Admission intake (`/admin/admissions/new`).** A Medicaid section: current coverage (ruling 3), the six answers as Yes / No / Unknown, and monthly income in integer cents (optional; Unknown stays unknown). Answered-by (resident / POA / family / staff from records) and answered-at are recorded. Saving is allowed with unknowns.

**Classification** (on save, and on every later re-answer), evaluated against the `screening.admission_gate` rule in effect on the answer date, stored with the rule row id:

| Answers | Result | What happens |
|---|---|---|
| Coverage = SMMC-LTC enrolled | Already enrolled | No candidate case; appears on the existing "Medicaid residents without a benefits case" list for renewal tracking |
| A = yes or B = yes | Does not qualify now | Recheck scheduled `screening.recheck_days` after the answer date; administrator alerted then |
| A and B = no | **Candidate** | An SMMC-LTC benefits case opens (or the existing active one is reused), assigned to Jessica, first step *Intake requested*; one requirement per C–F = yes is added and assigned to the facility administrator |
| A or B = unknown (and neither yes) | Needs answers | Administrator task to complete the missing answer; no case yet |

Jessica may override a result with a written reason (for example a trust that changes question B); the override and its author are in the case history. Classification is Circle of Life's screening policy, not an eligibility decision, and the screen says so.

**Quarterly recheck.** Due rechecks appear on the facility administrator's work list and as a Haven alert on the due date; overdue rechecks are flagged on the facility Medicaid board. Outcomes: *No change* (reschedules), *Changed* (re-answer form, documents, re-classify; if candidate → Jessica's queue, labelled "Resubmit — answers changed"), or *Resident discharged* (recheck closes). Every recheck is append-only.

**Medicaid board (`/admin/benefits` default view).** One board per facility (facility switcher honours current access), one row per open case, columns mirroring Jessica's log:

> Intake requested (45-day notice when converting a private-pay resident) → Intake & notice emailed → Assessment complete → Score → 3008 requested → 3008 returned → Medicaid app requested → App returned → CARES processing → CARES appointment → Approved / Denied → Plan enrolled → Plan authorization → **First payment received**

The row is not finished at approval. It ends when the billing ledger shows the first plan payment, and the resident returns to the board automatically `renewal.warning_days` before the annual redetermination.

- Each cell shows the recorded date; the next open step is highlighted with one action that records it (default today, editable, never future-dated). Dates come from the existing agency events, requirement status and submissions — the board is a view over the case, not a second store.
- **Dollars.** Each row shows days pending × expected rate (the plan's configured rate, e.g. UHC $1,600) as *revenue not yet collected*; the board sorts by it by default. Rates are owner-entered values, never inferred.
- Row badges: *waiting on administrator* (open gathering requirements) vs *waiting on agency* (submitted, awaiting outcome); DCF caseworker name; stalled step (configurable age, starting at 14 days); score below 5 with reapply date.
- A separate strip lists "Does not qualify now — recheck due" and "Needs answers" residents for that facility.
- The existing five-tab case detail stays as the *details* view behind each row.

**Private-pay runway (the real trigger).** Most cases in the log begin with a 45-day notice to a private-pay resident whose money is running out, not at admission. Intake therefore also asks *about how many months can the resident private pay?* and stores a runway date. Haven prompts Jessica to start the case `runway.lead_days` (starting value 75) before that date, and flags private-pay residents whose billing ledger shows two consecutive late or short payments. Both prompts are suggestions for a person; nothing is sent to the resident or family.

**Current-resident sweep.** At launch every current private-pay resident gets a one-time task for their facility administrator to record the six answers, coverage and runway. Until the sweep is complete for a facility, the board and owner summary say so rather than showing a partial picture as complete.

**Agency letters (revised 2026-09-24 — see [Document Intake Decision](DOCUMENT-INTAKE-DECISION.md)).** Agency and plan letters arrive through the single company intake address (`docs@circleoflifecommunities.com`, read at the real mailbox through Microsoft Graph), not per-facility or per-purpose inboxes. They are matched against the sender's open obligations; Medicaid case requirements (`benefits_requirements`) are Haven register rows feeding the `open_obligations` view. Resident documents are read and decided by Claude only (never Jev), are never filed automatically, and a person confirms the proposed filing; confirming records the agency event and sets the response deadline as the case due date, shown on the board. Haven intake starts after Homewood settles and copies the engine proven in Cornerstone. Until then, Jessica records letters on the case by hand (manual entry always works).

**Document freshness.** Each requirement type carries a *good for* period in operating rules (for example bank statements); an accepted document past its period becomes *expiring* and the gathering task returns to the administrator, or to a linked family member through the existing family collection, before the submission that needs it. Periods are set by Jessica, not assumed. These expiring requirements are open obligations in Haven's register (Document Intake Decision); the re-request uses the in-app and family-collection paths now and the decision's Requests accelerator once Haven intake exists.

**Coverage continuity.** Michelle Norris is Jessica's designated backup (Brian, 2026-09-24, COL-760), recorded in operating rules; the board, queue and alerts go to both.

**Over-income prompt (Brian, 2026-09-24, COL-758: on).** B = yes stays *does not qualify now* and shows Jessica a one-line prompt to consider a Qualified Income Trust; a *changed* recheck where A went from yes to no shows a look-back reminder (property transferred). Neither prompt decides anything.

**Caseworker and contacts.** The case carries the DCF caseworker (name and phone) as a field, chosen from an organization contacts list seeded from the log's Contacts tab (Elder Options, Elder Affairs, DCF caseworkers). No messages are sent from Haven.

**Owner report.** A per-facility Medicaid summary replaces Murphy Notes: census, open candidates by step, approved this month, plan/rate/start of newly funded residents, and current Medicaid billing read from the billing ledger. Revenue goal and the "if we add N Medicaid-pending beds" projection are P1 and use owner-entered goal and rate values; nothing is projected from unreviewed data.

**701S telephone screening aid (phase 2).** A printable sheet pre-filled from the resident's chart (every 1823's diagnoses, ADL/IADL assessment, medication count, facility as living situation). Answers must come from this resident's record; Haven offers no default answers.

### Phasing (Linear parent and issues listed in *Progress*)

- **Phase 1 — find every candidate and stop losing them:** admission questions and classification (with COL-575's move-in gate); quarterly A/B recheck; current-resident sweep; private-pay runway trigger; facility Medicaid board with dollars, score/reapply, caseworker and stalled flags; retire the duplicate admission stage; log import. (Agency letters moved to Haven document intake, which follows the Document Intake Decision and starts after Homewood settles.)
- **Phase 2 — carry it through to money:** board through first payment and renewal; document freshness; owner Medicaid summary (Murphy Notes); over-income/look-back prompts once decided.
- **Phase 3 — convenience:** 701S pre-filled screening sheet; packet-readiness gate (COL-520).

### Data (sketch; the migration is canonical)

- `benefits_admission_screenings`: append-only answer sets (resident, admission case, coverage, A–F knowledge states, income cents, answered_by, answered_at, rule row id, result, override reason/actor). Current = latest by answered_at.
- `benefits_rechecks`: resident, due_on, assigned role (facility administrator), outcome, screening id produced, completed_by/at.
- `benefits_cases`: add `agency_score smallint CHECK (agency_score BETWEEN 1 AND 5)`, `reapply_on date`, `caseworker_contact_id`; board step dates derive from events.
- `benefits_contacts`: organization-scoped agency contacts.
- `benefits_rules`: add the keys in the operating-rules table plus `runway.lead_days`, `document.valid_days` (per requirement type), `coverage.backup_user_id`, and plan rates.
- Agency letters: no Module 39 mail tables. Haven document intake (envelope, sender authentication, obligations) owns received mail per the Document Intake Decision.
- `benefits_admission_screenings` also stores `private_pay_months` and the derived runway date.
- `admission_cases.medicaid_pipeline_stage`: stop writing; the admission page shows the linked benefits case's current step instead. Column dropped only after a release with no readers.
- RLS, audit trigger, soft delete and facility checks follow the existing COL-504 helpers; financial answers use the existing explicit benefits access grants. The facility administrator needs a benefits grant scoped to their facility (write + gather, no review).

### Import

A one-time, reviewed import of the Medicaid Log's five current facility tabs (Plantation, Homewood, Oakridge, Rising Oaks, Grande Cypress) and the Completed tab into cases, step dates, scores, caseworkers and funded plans, matched to existing residents by a human-reviewed mapping. Unmatched rows are listed, never auto-created. Eastside is excluded. Import runs on staging first and requires Jessica's sign-off on the resulting board before production.

### Acceptance

1. Admitting a resident with A = no, B = no opens one candidate case assigned to Jessica, with administrator gathering requirements for each C–F yes.
2. A = yes or B = yes creates no case and schedules a recheck 90 days out; on the due date the facility administrator is alerted; a *Changed* recheck with A and B now no puts the resident on Jessica's queue.
3. Coverage = Medicaid gold card with A/B = no is a candidate; SMMC-LTC enrolled is not.
4. Recording score 4 sets reapply 30 days out and shows it on the board; score 5 advances to 3008.
5. The Joseph Thompson (Homewood) row imported from the log shows the same dates on the board as in the workbook.
6. Changing the income line in operating rules affects only answers dated on or after its effective date.
7. The admission page no longer offers a separate Medicaid stage selector.
8. Existing COL-504 guarantees (authority, idempotent commands, immutable evidence, no automatic notices or payer changes) still pass.
9. A resident admitted private pay with a 6-month runway appears on Jessica's queue as *runway — start case* 75 days before the runway date; two consecutive late ledger payments raise the same prompt earlier.
10. Until a facility's current-resident sweep is complete, its board and summary show *sweep incomplete (n of m residents answered)*.
11. (Moved to Haven document intake.) A DCF letter sent to the company intake address lands as a proposed filing against the resident's open Medicaid obligations; after a person confirms, the deadline shows on the board and queue.
12. A funded row stays on the board until the ledger shows the first plan payment, and returns before renewal.
13. The board shows revenue not yet collected per row and sorts by it.

### Decisions

- Resolved 2026-09-24 (Brian): trust prompt on (COL-758); assets over the limit stop the case (COL-759); backup Michelle Norris (COL-760).
- Jessica: the items below, plus document *good for* periods and plan rates.

### Open (Jessica)

- The first administrator-facing wording of the six questions (read to resident/POA as printed, or plain-language variant).
- Stalled-step thresholds per step (14 days is a placeholder for Jessica to adjust).
- Whether the facility administrator also records *Intake & notice emailed*, or that stays Jessica's.


## Progress

- 2026-09-21: isolated current-main worktree created; COL-504 active; architecture and existing access boundaries inspected.
- 2026-09-22 00:39 UTC: shipped — PR #644 (`39a1a67a`), migrations 445/446 on staging and production, hosted 59-step smoke on staging, COL-504 Done.
- 2026-09-22 02:17 UTC: review hardening — PR #649 (`6592c174`), migration 449: bounded lists, closed-case immutability, signature review, granted assignees; COL-539 Done.
- 2026-09-22: review findings — migration 452: reviewed funding is a review fact; notice events need review + the notice document; requirements gain `expired` and `signed_on`; misfiled documents can be voided once with a reason; queue filters by assignee and flags assignees who lost authority; family collection stops for discharged/deceased residents.
- 2026-09-22: quality review follow-up — migration 451: operating rules, due-date queue with flags, rebind for moved residents, evidence-access audit, Medicaid residents without a case.
- 2026-09-24: Amendment A ruled by Brian and planned in Linear for Claude Code — parent COL-757 (build queue); delivery COL-763, COL-764, COL-765, COL-766, COL-767, COL-771, COL-772, COL-773, COL-575, COL-774, COL-768, COL-775, COL-769, COL-770; decisions COL-758, COL-759, COL-760, COL-761 (non-blocking; defaults ship as operating rules).
- 2026-09-24: built and live on production — COL-763 (#879, migration 507), COL-764 (#881, 508); queued with production migrated — COL-765 (#886, 511), COL-766 (#889, 515), COL-767 (#892, 519).
- 2026-09-24: course change — Document Intake Decision adopted (single company intake address, obligations register, first-hop sender authentication, Jev only for phi = false senders, Haven intake after Homewood settles, engine proven in Cornerstone first). COL-771's AgentMail receiver (#893) closed unmerged; migration 520 removed from staging and production (empty objects, ledger row deleted). COL-771 re-scoped to Haven document intake.
