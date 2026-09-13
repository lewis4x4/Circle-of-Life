# Facility operations versioned applicability, evidence rules and local procedures — COL-135

Status: PARTIAL — HFO-02 foundation. September 10, 2026. Extends the [catalog](27-facility-operations-catalog.md) and [current authority](27-facility-operations-authority.md) contracts under BUILD-SCOPE sections 4, 5 and 7. This is source implementation: it does not approve a requirement for any facility, confirm a schedule, generate an occurrence, activate an adapter or establish hosted or operating acceptance.

## What a version is

A **central requirement version** (`operation_requirement_versions`) belongs to one stable activity and holds immutable title, wording, procedure/help, source authority, subject kind, allowed recorder and reviewer roles, review requirement, typed inputs (readings) and evidence rules. Exactly one draft and at most one open published version exist per activity.

A **facility requirement configuration** (`operation_facility_requirements`) belongs to one activity at one site and holds effective-dated applicability (`applicable`, `not_applicable`, `needs_confirmation`), reason, override source, local procedure, local recorder roles, local inputs and evidence, owner and backup, and an independent schedule-confirmation state with an optional rule object. Exactly one draft and at most one open published configuration exist per activity and site.

**Published is not the same as in force.** A published row governs only inside its effective window, from `effective_from` until `effective_to` (open when null). Publishing a successor with a later effective time closes the predecessor's window at that instant; both stay published, and `haven.operation_requirement_in_force(activity, at)` and its facility counterpart resolve the version that governs any instant. A version scheduled for next week is visible as scheduled, not current.

Rules that never bend:

- `needs_confirmation` is an explicit, publishable, audited state. A new draft starts from the latest published row, never from an invented answer. Nothing here confirms a schedule: `schedule_status` defaults to `needs_confirmation`, a `confirmed` draft must carry a rule object, and confirmation cannot be published until the COL-137 evaluator defines and validates rule shapes. The open questions Q01, Q02, Q07, Q08 and Q10 remain unapproved.
- `not_applicable` and any local override need a reason. A local override names its source. `applicable` must reference the central version in force at the configuration's effective time. Local rules constrain and never widen: local recorder roles are a subset of the central roles, local inputs and evidence keep every central requirement, and none replaces COL-133 site, subject or recorder authority.
- A central version cannot be published for an activity whose subject kind is unclassified; a version never classifies an activity through a side door.
- Published rows are immutable in every column except the closing time, which only the publish command may set. Drafts are editable only through the commands. No client, and no service identity, holds direct insert, update, delete or truncate on either table; the transaction-local publication setting is honoured only inside the commands, which run as the definer.
- Occurrences (`operation_task_instances.requirement_version_id`, `facility_requirement_id`) record the versions that governed them. Once set they cannot change; they must be published versions of the occurrence's own activity and site, in force on the occurrence's local date, and the site configuration must agree with the central version. A version-backed occurrence without a legacy template carries the version's activity identity. Publishing a later version leaves existing snapshots untouched; the preview reports how many future occurrences keep the latest snapshot.
- Recording actual work does not depend on a version. Completion of an existing task with no version, or with a closed snapshot, remains available under current permissions.

## Commands and reads

Six session-only commands (`*_review` invoker wrappers over private fixed-search-path implementations): save central draft, preview central publication, publish central version, save site draft, preview site publication, publish site configuration. Each locks the actor's profile, session and site grant, checks current authority before and after DML, whitelists editable fields, validates rule shapes strictly (unknown keys, types and duplicates are rejected) and derives version numbers, approver identity and timestamps on the server. Central commands require owner or org_admin; site commands require owner, org_admin or facility_admin with a current site grant. The service identity cannot call them.

Reads follow RLS: published versions follow activity visibility; drafts are visible only to the roles that may publish them; site configurations require the current site grant. The invoker view `operation_activity_requirements` exposes each visible activity with its source disposition (`mapped` or `needs_confirmation`, resolving the COL-132 review's deferred finding), the version in force now and any scheduled successor.

API: `GET/POST /api/admin/operations/requirements`, `POST /api/admin/operations/requirements/[id]/preview|publish`, `GET/POST /api/admin/operations/facility-requirements`, `POST /api/admin/operations/facility-requirements/[id]/preview|publish`. Routes use the session client only, revalidate the actor before a command, gate site reads and site drafts on the current grant, and return bounded messages: authority denials hide existence; rejections of the request itself are client errors; state conflicts carry their bounded message; everything else is generic. For preview and publish the draft identifier carries no site, so the site gate is the database command itself. No administrator screen is claimed by this segment.

## Verification

1. `npm test -- src/app/api/admin/operations src/app/api/admin/meetings src/lib/operations src/lib/admin/operations src/lib/auth/current-api-actor.test.ts`
2. `npm run typecheck` and `npm run segment:gates -- --segment COL-135-HFO-APPLICABILITY --ui`
3. Migration replay executes `supabase/tests/review_hfo_applicability.sql`: draft and rule validation, preview problems, publication with approver and effective time, immutability of published rows for clients, privileged paths and the service identity, an unclassified activity that cannot be published, needs_confirmation as its own published state, reason and source requirements, subset and keep-every-central rules, schedule confirmation draftable but not publishable, site-scope denial and invisibility for another site's admin, a second version scheduled for tomorrow that keeps today's version in force and preserves an occurrence's snapshot, snapshot window and agreement checks, a stale central reference not publishable, recording of work with and without a version, and the catalog view's dispositions.

## Migration and rollback

`338_hfo_requirement_versions.sql` follows this branch's unapplied 336 and 337 and replaces the 336 instance-binding function to admit version-backed occurrences. Numbers are branch-local; integrate after COL-133 in the recorded Finance-first order and re-read the hosted ledger before assigning final numbers. Before application, rollback is reverting this segment. After application, retain the additive tables and history; roll back the application with the requirement routes disabled and use a reviewed forward repair. Never edit or delete a published version to reopen a rule.

Mission alignment: PASS for the bounded foundation. Operating readiness: RISK pending the evaluator, occurrence generation, hosted release and Homewood configuration.
