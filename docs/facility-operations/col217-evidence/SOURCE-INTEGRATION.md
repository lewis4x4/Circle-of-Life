# COL-217 isolated staging source integration

Mission alignment: **pass**. Combine the reviewed Finance and shared facility operations source without weakening current authorization, audit history or financial invariants. This is source integration for a separate synthetic staging target, not production, clinical, facility or provider acceptance.

Pinned inputs and every migration rename/checksum are in `integration-manifest.json`. Main through339 retains all342 migration files byte-for-byte. Finance occupies340–346; HFO occupies347–362;352 reconciles Finance immutable exports with initial HFO authority, and363 extends the export predicate to the fifteen table exclusions added by later HFO policies. Independent review discovered that missing latter protection; the expanded parity probe fails before363 and passes after363 for both site-admin and corporate-owner exports. No client or service privilege was added.

The two merges preserve source history. The manifest lists every conflict and chosen resolution. Current main UI behavior and Finance business-date fixtures were retained; the HFO clinical fixture's approved catalog-binding token remains required. Main officer tests now construct valid settled invoice history with Finance guards enabled while retaining their original aggregate assertions. No historical migration was edited, and no gap migrations were invented.

## Verification

- Fresh `npm ci` succeeded in this worktree.
- Full Vitest:613 files,4410 tests passed,2 skipped. Focused billing test:3 passed after removing the duplicate effect dependency introduced by automatic merging.
- Typecheck passed; catalog source-seed check passed with91 source mappings.
- Full native PostgreSQL replay:366 migration files and46 SQL probes passed with Supabase Auth/Storage stubs.
- Expanded audit export test proved red before363 and green after363; see `audit-export-regression.json`.
- Staging sanitizer refused without target acknowledgment and passed afterward in an isolated replay. All inherited users were banned and profiles disabled, while5 facilities and133 catalog activities remained. See `sanitizer-probe.json`.
- Strict final gate **PASS**: `test-results/agent-gates/2026-09-12T23-13-46-905Z-COL-217-staging-integration-final.json`. Initial failed evidence is retained: duplicate router dependency and invalid legacy invoice fixture settlement. Both were repaired without relaxing assertions.

## Staging boundaries

The new target is `iwcnajanvjvynolltflw`; production `manfqmasfqppukpobpld` is excluded. Only the parent integrator applies hosted changes. `staging-sanitize.sql` is a staging-only post-replay procedure, never a migration. Its explicit target acknowledgment is not independent target evidence; verify the project through the Management API first. Apply before enabling login or creating proof identities.

Historical main migration008 contains company/facility/contact/entity metadata. Auth seeds occur in033,093,161,164,165,166,170,175,182, including known demo credentials and company-domain addresses. The sanitizer neutralizes these identities and contact values without changing identifiers. No migration contains the production project reference, schedules a cron, or issues an HTTP call; the Finance credential lifecycle only permits the explicit sandbox accounting host. No provider is activated here.

Not established by local verification: hosted Auth hooks, actual Storage owner/eTag/checksum behavior, browser workflows, staff acceptance, facility cadence/policy decisions, provider integrations or production readiness. Completed-export job listing remains restricted by the reviewed HFO policy; the separate operating decision remains open.
