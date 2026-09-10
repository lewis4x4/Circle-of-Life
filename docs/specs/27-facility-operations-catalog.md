# Facility Operations — stable activity catalog

Status: PARTIAL — COL-132 / HFO-01 foundation. September 9, 2026.

This is the canonical repository entry for the September 9 Facility Operations catalog. It extends [OCE](27-operations-cadence-engine.md). Owner direction, `BUILD-SCOPE.md`, `DELIVERY-ROADMAP.md` and live bounded issue acceptance govern. Source templates are evidence of wording, not approved operating rules. Haven remains one shared application for every facility, Homewood first.

## Source contract

`src/lib/operations/activity-catalog.json` contains exactly one disposition for each of the 91 named Admin Log items, preserving the AL identifier, sheet, cell, exact label, workbook fingerprint, timing evidence, open question references and proposed capture. The independently trimmed inventory is retained in `docs/facility-operations/fixtures/admin-log-source-items.json`.

Each item maps to one or more stable activity components. Component keys and UUIDs are allocated identities: preserve them across source wording, workbook fingerprint and template revisions. A split retains the original source item and distinct component mappings. Performance, review, evidence and data fields remain distinguishable. For example, generator/CO work differs from review of those logs; hire date is a data field; FPC remains unexplained. `mapped` means that a catalog interpretation exists, not that the adapter exists or a rule is approved.

All imported items are draft, `approvedRule` and `effortMinutes` are null. Raw timing text never becomes an executable deadline. Q01/Q11, missing headers, ambiguous intervals, training durations and unknown subject scope stay explicit. Nineteen unnamed choice columns are not named duties. Worksheet Y/N choices, stale calendar dates, historical actors and performed work are excluded. This migration creates no new scheduled templates, task instances or completion records from the source catalog.

## Database contract

The executable DDL and constraints are in `supabase/migrations/336_hfo_activity_catalog.sql`.

| Object | Purpose |
|---|---|
| `operation_activities` | Organization-owned stable UUID/key; optional facility scope; immutable kind/subject identity; explicit legacy versus Admin Log origin. |
| `operation_activity_source_items` | Immutable source item and draft interpretation, one row per organization/intake/AL ID. |
| `operation_activity_source_mappings` | Attributable source-to-activity relationships with organization-consistent foreign keys. |
| `operation_activity_subjects` | Immutable validated references to existing facility, resident, staff or asset records. Contains no duplicate domain master. |
| `operation_task_templates.activity_id` | Required stable identity; a new template version inherits its predecessor's activity. |
| `operation_task_instances.activity_id` | Stable history link from the existing template. Legacy template-free work retains null rather than a fabricated identity. |

Legacy reconciliation follows only explicit `previous_version_id` chains. It preserves names, occurrences, completion states and existing schedules. A legacy root gets its own stable activity, with unknown kind/subject. No name-based match to an AL source is inferred. Cycles and cross-organization/site lineage abort the migration. New legacy API inserts receive an activity automatically; revisions retain identity. Existing instance/template identity cannot be retargeted to move history. A migration transaction makes failure atomic.

The source seed targets the existing COL organization only. It creates draft activity definitions and source mappings, without attaching them to old templates by guesswork. A future approved reconciliation must preserve both lineages and source history. Publication and facility applicability belong to COL-135; occurrence generation belongs to COL-139.

The subject registry enforces exactly one typed domain reference, real foreign keys and matching organization/facility at creation. It locks the referenced rows during validation. References preserve site-at-registration history; they are **not access grants** and must not be used as current authority after a subject transfer or termination. COL-133 must revalidate native subject permissions and scope on every future command/read. The registry has no client access or public command in the COL-132 segment. The subsequent [COL-133 authority contract](27-facility-operations-authority.md) adds current-scope readers, explicit grants and restrictive task boundaries; it does not treat these historical references as grants.

## Authorization and interfaces

RLS is enabled before seed. Catalog reads use current database actor/organization and facility scope. Legacy activity visibility additionally requires an existing visible, nondeleted template. Source and activity rows carry no resident or employee record values. Two source header labels name individuals exactly as the workbook wrote them (AL-Y02, AL-C08); they are retained as evidence of wording pending an owner ruling on redaction before deployment, after which installed source history is never rewritten. Direct authenticated catalog writes are denied, and a client request's root template insert cannot supply an activity: it receives its own legacy identity. The bind trigger runs as its definer, so it keys this rule on the request's JWT role claim; an approved binding command must set `haven.operation_catalog_bind` to `approved` for its own transaction (reserved for COL-135; no command sets it yet). Migration backfill and service paths carry no client role claim. Catalog tables reject TRUNCATE. Private trigger functions pin their search path and are not public callable commands; source mappings and identity references are immutable.

Existing template and task reads add `activity_id`. Older client response types accept its absence during transition; server shaping returns null for unknown template-free work. Template mutation payloads cannot choose or rewrite stable IDs, and a revision cannot move a template to another site (the API rejects it before the command; the database rejects it as invalid lineage scope). The eleven `needs_confirmation` source items produce draft activities whose disposition is visible only in the source payload; COL-135 carries the activity-level applicability state that makes them distinct to readers. No new staff screen, completion command, history pagination or operating rule is claimed by this catalog segment.

## Verification and regeneration

1. `npm test -- src/app/api/admin/operations src/lib/operations src/lib/admin/operations src/lib/auth/current-api-actor.test.ts`
2. `npx tsx scripts/facility-operations/sync-activity-catalog-seed.ts --check`
3. `npm run typecheck` and `npm run segment:gates -- --segment COL-132-HFO-CATALOG`
4. Migration replay executes `supabase/tests/review_hfo_activity_catalog.sql` with the existing rollback-only probes.

The seed compiler validates JSON before generating deterministic SQL. Run without `--check` only while preparing this **undeployed** migration. Once deployed, source changes require a new forward migration and a new source revision; never rewrite installed source history or recompute activity identities. Behavioral checks cover all 91 source mappings, exact provenance, split/data-field/unknown semantics, template version continuity, invalid tenant/site/subject references, direct-write denial and no source completion import.

## Delivery and rollback

This branch starts from COL-18 commit `39d41591` over main `fad17dcc`. Migration 336 is contiguous on this branch; other unmerged branches already use overlapping numbers. Its number is branch-local, **not a claim of global reservation or hosted parity**. Before merging/deploying, reconcile integration order and renumber this unapplied migration if another 336 lands first, including its compiler reference. Do not add fake gap migrations or alter concurrent worktrees.

Before apply, retain a database backup and dry-run against current source. Before any new writes, a database rollback can remove only this segment's triggers, added columns and new tables in reverse dependency order within an approved maintenance operation; restore preserved legacy state from the preflight snapshot if needed. After dependent writes, use a forward repair and retain identity/provenance history. Application rollback requires the matching pre-336 API build; new selects depend on the added columns.

Local SQL with Supabase stubs is not live Auth/Storage proof. COL-18 full-gate failures and release/security/Storage/operating acceptance remain separate. The final segment evidence and next issue are recorded in `docs/facility-operations/HANDOFF.md`. Mission alignment: PASS for the bounded foundation; Homewood readiness remains RISK until its separate gates pass.
