# Medicaid benefits workflow — COL-504

Status: Implementation authorized by Brian on 2026-09-21. Staff/provider acceptance remains separate.
Source: Jessica discussion, 2026-09-16; New Admits Medicaid Pending Criteria, seven-page forms packet, Grande Cypress MCD master packet. Insurance loss files excluded.
Mission alignment: pass — one resident identity, current authority, attributable evidence and actionable work.

## Outcome and acceptance

A persistent benefits case starts for an existing resident or admission and survives move-in. Authorized staff can see the next action, person and deadline; collect and review private evidence; record independent screening, CARES, DCF, enrollment and authorization outcomes; assemble a submission and record delivery/receipt; hand verified funding facts to billing; track renewal, denial, closure and reopening. Documents and submission histories are immutable evidence, not inferred approval.

P0: current session/facility authority, explicit financial access grants, no direct anonymous data access, optimistic revision and idempotent commands, append-only history, private verified uploads/downloads, requirements and source-specific review, separate agency milestones, submission manifests and receipts, staff queue, resident/admission navigation, reviewed billing handoff, renewals and exceptions. P0 includes honest unknown/error/empty states. No automatic notices, resident admission, payer changes, retroactive dates or agency approval.

P1: scoped family upload collection using existing family financial/decision authority; generated case cover sheet and reviewed packet export; exact form/template version tracking with manual signed-document return when provider configuration is unavailable. Existing BoldSign only for configured exact approved templates; default-template fallback must not send Medicaid releases.

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

All routes require current authenticated actor, deny stale/disabled/password-change actors, return 400 invalid, 401 session, 403 role, 404 unavailable subject, 409 conflict, 503 unverified dependency. Lists/downloads are no-store. The database RPC repeats authority and subject checks; a service key does not supply staff identity for mutations.

## Data and invariants

Canonical implementation DDL is the COL-504 migration, with RLS, private schema helpers, explicit execute grants, case/requirement/document/event/submission/access tables, indexes by facility/current status/due date, and immutable audit events. All resident, admission, document and assignee references must belong to the same current organization/facility. A resident transfer fails closed until an explicit reviewed rebind preserves history. Actor, time and organization are server-derived.

Case revision increments atomically for commands; a request UUID is bound to actor, action, case and payload. Same request returns original result only while the actor still has authority. Closure requires a reason and preserves every child. Reopening cannot imply renewed coverage. Every screen can save partial facts. Required evidence blocks only its submission stage. Acceptance requires reviewed evidence or explicit reasoned not-applicable; uploaded does not equal accepted.

Screening captures income/assets in integer cents, knowledge state for property/policies/burial/POA/marriage, notes and rule reference. The 2026 DCF standard is source context, not a universal automatic decision. Record gross/countable/unknown basis explicitly. Staff review over-limit/unknown cases. Agency events and funding dates are independent. No hardcoded score-to-approval transition.

Submission stores exact immutable document IDs/hashes at preparation, destination/method, sent time, external reference, received time and receipt evidence. Unreviewed/rejected evidence cannot silently become a ready submission. Signature validity is a distinct review, not image presence. A 45-day notice requires explicit recorded issuer/reviewer and evidence, never automatic creation or delivery. Signed dates must reflect actual signatures; no copied signature image or undated-template convention is automated.

Funding handoff records plan, reference, coverage dates, resident contribution, expected benefit and renewal date, with reviewed agency/enrollment/authorization evidence. It opens the existing resident billing workflow for authorized billing staff; no invoice or payer write occurs from a benefits stage change. Received payment remains the billing ledger's fact.

## UI and failure behavior

Routes /admin/benefits and /admin/benefits/[id]. Shared Haven UI primitives; laptop queue and detail sections, tablet stacking, phone single column with accessible labels and 44px actions. Tabs: overview/screening, requirements/documents, agency history/correspondence, submissions, funding/renewal. Actions preserve drafts on failure, display conflicts and permit refresh. Access denied is distinct from successful-empty. Case needs action versus waiting on agency distinguish staff time from external delay. Attachments never show in broad operations notifications.

## Rollout, verification and recovery

Additive backward-compatible migration; existing admission Medicaid selector remains untouched until case migration is reviewed. No automatic migration of stage='approved' into approved evidence. Rollback disables new routes and revokes write RPCs while retaining case evidence; destructive DROP is not a production rollback. A down script may drop only an empty disposable verification database, never live evidence.

Verify SQL current-authority/grant revocation/cross-facility references/direct API bypass, optimistic concurrency and payload-bound replay; API malformed body/upload checks; UI happy/error/empty paths; real local browser sequence and a11y; segment gates; PR required CI; post-merge CI; production migration ledger and exact revision; hosted role/scoped smoke. Technical release is separate from Jessica/provider acceptance. Do not send resident data to third parties during synthetic verification.

## Operating rules (COL-504 quality review, migration 451)

No business value is fixed in code. `public.benefits_rules` holds effective-dated, append-only, organization-scoped rules an owner or org admin records with a reason under **Benefits access → Operating rules**; a change takes effect today or on a future date and never rewrites the past. Cases already open keep the requirements they were created with.

| Rule | Meaning | Seeded value (source) |
|---|---|---|
| `checklist.smmc_ltc` / `checklist.oss` / `checklist.other` | Requirements seeded on a new case for that program | 18 items from Jessica's 2026-09-16 packet (also the built-in default for a new organization); OSS and other start empty |
| `screening.standard_individual` | Review-aid income/asset limits shown beside saved screening facts; never an eligibility decision | DCF 2026 Appendix A-9 individual ICP/HCBS: $2,982 income, $2,000 assets, effective 2026-01-01 |
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

## Progress

- 2026-09-21: isolated current-main worktree created; COL-504 active; architecture and existing access boundaries inspected.
- 2026-09-22 00:39 UTC: shipped — PR #644 (`39a1a67a`), migrations 445/446 on staging and production, hosted 59-step smoke on staging, COL-504 Done.
- 2026-09-22 02:17 UTC: review hardening — PR #649 (`6592c174`), migration 449: bounded lists, closed-case immutability, signature review, granted assignees; COL-539 Done.
- 2026-09-22: quality review follow-up — migration 451: operating rules, due-date queue with flags, rebind for moved residents, evidence-access audit, Medicaid residents without a case.
