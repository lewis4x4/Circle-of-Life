# COL-328 — Referral authority and sensitive-data boundary

## Delivery boundary

This delivery establishes the minimum current-authority boundary for the
existing referral experience. It does not approve COL's future operating
policy, activate the Homewood pilot, import production workbooks, or prove a
hosted/staff outcome. Those remain separate operating, migration, and release
acceptance work.

The application remains in gradual dual operation. Authenticated browser
clients no longer have direct lead insert, update, or delete privileges. The
current referral screens use scoped commands that derive the actor and
organization from the current database session; service-role admission and
move-in workflows remain separate server-side integrations. COL-329 owns the
durable command/history model that builds on this boundary.

## Effective authorization trace

The effective referral boundary is the result of these migrations in order:

| Migration | Effective responsibility |
| --- | --- |
| `075_referral_inquiry_schema.sql` | Lead/source tables and sensitive fields |
| `076_referral_inquiry_rls_audit.sql` | Original facility RLS, audit, and timestamps |
| `191_referral_outreach_activities.sql` | Existing referral/outreach operator roles |
| `253_referral_leads_preferred_contact_inquiry.sql` | Intake date and contact preference |
| `317_referral_lead_closure_reasons.sql` | Closure vocabulary and sensitive closure detail |
| `326_sys_001_authoritative_actor_state.sql` | Database-current role, session, claim-version, and facility access |
| `378_hfo_corporate_withdraw_revision_fast_refusal.sql` | Current-main corporate withdrawal correction; remains independently owned |
| `379_referral_current_authority.sql` | Explicit referral capabilities, protected projections, guarded writes, and triage |

`haven.current_authorized_actor()` is authoritative. JWT role and organization
metadata do not grant referral access. An active Auth user, active Auth
session, active user profile, matching claim version, current database role,
and non-revoked facility access are all required.

## Minimum capability mapping

This mapping preserves the roles already named by the referral lead and
outreach policies. It is a security baseline, not an operator-approved or
configurable policy.

| Capability | Current roles |
| --- | --- |
| Lead and contact read | `owner`, `org_admin`, `facility_admin`, `manager`, `admin_assistant`, `coordinator`, `nurse` |
| Clinical/free-text read | `owner`, `org_admin`, `facility_admin`, `nurse` |
| Lead write | `owner`, `org_admin`, `facility_admin`, `nurse` |
| Export | Lead/contact read roles, with the same field masking as screen reads |
| Duplicate review | `owner`, `org_admin`, `facility_admin`, `nurse` |
| Triage submit | Lead/contact read roles |
| Restricted triage read | `owner`, `org_admin` |
| Source management | `owner`, `org_admin` |

Unknown capabilities and roles deny. Organization-wide role names do not
bypass explicit facility access for a facility-scoped referral.

## Data exposure rules

Authenticated clients no longer have direct `SELECT` privilege on:

- date of birth, phone, email, notes, and external reference;
- closure note and competitor chosen.

The `referral_leads_authorized_read` projection combines role capability with
the lead's PII tier. `public_summary` hides contact and clinical data;
`standard_ops` permits contact data to contact-read roles; and
`clinical_precheck` permits clinical/free-text data only to clinical-read
roles. New manual leads are created as `standard_ops` and the create command
does not accept clinical notes. Later tier changes require a separately
controlled approval path. Clinical notes are read-only at this boundary;
COL-329 owns the history-bearing clinical-note command. The generic update
command cannot enter `converted`, `merged`, or `lost`, and it cannot modify a
lead already in one of those closed states. Conversion remains a move-in
command; archive and reopening remain explicit history-bearing commands in
COL-331. Authenticated clients have no direct table mutation grant.
`referral_leads_authorized_export` applies the same projection and a 500-row
bound.

The screen loads 201 authorized rows only to detect overflow, retains the 200
most recently updated, and displays at most 60. When overflow is present, the
UI labels the roster as limited and withholds KPI values and historical
comparisons rather than presenting incomplete calculations as facts. A
separate minimum-column query obtains the next six scheduled tours. Complete
reporting and larger-cohort behavior remain COL-334. Read, export, and triage
RPCs reject null, zero, negative, or over-limit pagination rather than allowing
PostgreSQL's unbounded `LIMIT NULL` behavior.

Names, status, source identity, timestamps, tour milestones, conversion link,
and closure classification remain available under referral row RLS. This
preserves the existing admissions and approved aggregate/reporting queries
without granting protected free-text or contact columns. Referral audit rows
remain in the existing restricted audit store; application and migration
messages do not include prospect values.

The following current UI paths now use the protected RPC surface:

- referral pipeline bootstrap and upcoming-tour derivation;
- lead detail read and optimistic-concurrency update;
- CSV export;
- manual lead creation and referral-source creation;
- processed HL7 lead creation and inbox linking as one atomic command that
  parses the patient name from the locked inbound payload;
- admission intake lead lookup through the same masked projection.

The database derives organization and actor identity. The selected facility is
an input only and must be present in current `user_facility_access`. Update
commands require the last observed `updated_at`, so a stale screen receives a
conflict and retains its draft for reconciliation rather than silently
overwriting newer work. The command rechecks current authority after acquiring
the row lock. Admission intake links its admission case to the lead but does
not set lead conversion fields; conversion remains the completed move-in
workflow's responsibility.

## Duplicate and no-facility behavior

`referral_duplicate_candidates` requires clinical duplicate-review authority.
It compares normalized phone plus date of birth only after loading an
authorized source lead. Candidate rows must be in the same organization and a
currently accessible facility. An inaccessible match produces no row, count,
or alternate response that reveals its existence.

Intake without an authorized saving facility is not stored as an org-wide
lead. `referral_triage_submit` writes to `referral_triage_inbox`, which has no
direct authenticated table privileges. Only owner/org-admin actors can use its
read projection. Surfacing the triage inbox in staff UI belongs to later
workflow delivery; COL-328 establishes the safe route and proves its boundary.

## Search, links, and documents

Grace has a deterministic referral-pipeline route backed by a service-role
query. COL-328 gates that route to the exact lead-read role set, uses only the
resolved current-actor facility scope, and revalidates current authority before
and after the query, including an exact comparison of the current accessible
facility set. A wrong-role request returns an access-restricted result with zero
tables and rows examined. Query errors or a missing exact count fail closed. Results use an exact total;
when more than 25 rows match, the status breakdown is explicitly labeled as the
25 most recent leads rather than an exact population claim. The repository
currently has no referral-lead document index or document-link route. Future
search or document linking must use a separately reviewed non-PHI projection;
unrestricted reuse of `referral_leads` is prohibited.

## Verification

`supabase/tests/review_referral_authority.sql` uses synthetic, rollback-only
fixtures to prove:

- role and sensitive-field masking;
- wrong-organization and wrong-facility denial;
- direct-table sensitive-column and all-mutation denial plus RPC grant posture;
- null-pagination rejection for every bounded referral projection;
- client actor/facility spoof refusal;
- database-current revocation and stale claim-version denial;
- duplicate matching without cross-site leakage;
- write-only ordinary triage and restricted triage read;
- generic conversion/merge/archive/reopen and protected-note update denial;
- trusted-payload patient parsing plus atomic processed-HL7 lead creation and linking;
- compatibility of status/tour columns used by approved aggregates.

The TypeScript adapter tests prove application calls do not send client actor
or organization identity and do not replace authority/concurrency errors with
empty success. The knowledge-agent test proves blocked roles cannot reach the
service-role referral query. The hub component test proves capped data cannot
produce apparently complete KPI claims.

## Recovery and forward correction

Before any hosted apply, record the target project/ref, current migration
ledger, release revision, and authorized non-production environment. Apply
only after migrations 377 and 378 are present; 379 intentionally does not take
ownership of either independently delivered migration.

If 379 fails before commit, PostgreSQL rolls back the entire migration. If it
applies but must be corrected before referral traffic uses the new endpoints,
restore the prior referral policies/grants and drop the new RPCs/triggers in a
reviewed forward migration. Do not drop `referral_triage_inbox` after it holds
records; retain its audit history and correct forward. Once clients depend on
the RPCs, prefer a compatible forward correction over rollback.

No hosted apply, deployment, staff acceptance, Homewood pilot acceptance, or
production-data validation is evidence of this source delivery unless it is
recorded separately with environment, revision, evidence date, and authorized
result.
