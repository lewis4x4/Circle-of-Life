# COL-133 — current site, subject and actor authority

**Implemented, independently reviewed, strict gate PASS, committed and pushed on the feature branch. Leave In Review until integration.** No hosted migration, deployment, provider transmission, access grant or operating acceptance occurred. Nothing was merged to `main`.

Worktree: `/Users/brianlewis/Circle of Life/Haven Facility Authority`; branch `codex/hfo-col133-authority`, based on COL-132 `64cc31b8` over COL-18 `39d41591` and origin/main `fad17dcc`. Local `main` is nine commits behind origin/main and was never the build authority; it was left untouched. Other worktree heads and their dirty files were preserved.

## Gate resolution (September 10)

The two blocking findings were pre-existing and unrelated to this source. They were resolved without waiving a check, in a separate commit ahead of the implementation commit; see [gate resolution](col133-evidence/gate-resolution.json).

- **Dependency audit:** Next pinned to 16.3.4 with sharp 0.35.4, vitest ^4.1.11, hono ^4.13.7 and js-yaml ^4.3.2, matching the Finance and Insurance branches. npm audit now reports no vulnerabilities.
- **Shared-ref gitleaks:** the three Finance-history fingerprints were ported verbatim from the owning branch's `.gitleaksignore` (Finance `cbd94135`). No rule/path suppression; no history rewritten.
- **Next 16.3 consequences:** six pre-existing `window.location` navigations became `router.push` (same as Finance `1e0a36ee`), and the production build now type-checks with `tsconfig.typecheck.json`, matching `npm run typecheck`.

The COL-133 implementation files were not modified: all 46 manifest hashes still match. After the dependency change the 131 focused tests, typecheck and the four Edge Deno checks were re-run and PASS.

## Delivered

- Migration `337_hfo_current_authority.sql`: explicit site grants for corporate and local roles, expiring coverage, native current subject checks, separate domain read/record permission, immutable subject classification, session-authenticated commands and post-wait/post-DML revalidation.
- Restrictive reads cover task identifiers/text/counts, registry subjects, native assets, template links, meeting/card copies, audit payloads, deliveries and aggregate versions. Service aggregate readers use the same native subject/link boundaries through a restricted projection.
- Operations API reads use the current session. Completion, dual signature, defer retry, start and reinstate are protected in the database. Complete audit CSV export checks every page and current authority before returning bytes.
- Canonical contract: [current authority](../specs/27-facility-operations-authority.md). Exact changed-file hashes: [implementation manifest](col133-evidence/implementation-manifest.json).

## Material compatibility boundaries

Unclassified legacy tasks and arbitrary evidence paths remain stored but hidden until approved reconciliation. Their absence from a classified list does not mean no work is outstanding. No raw evidence upload/download command is introduced.

Bulk completion, unclassified meeting-task creation, manual escalation, vendor booking edits and the legacy escalation/notification transports are explicitly unavailable pending scoped commands. Template publication works only for explicitly facility-typed activities with valid current links. The session staffing assessment returns unverified coverage; service scoring rejects incomplete populations, and old unversioned aggregates are withheld. No user/site/domain grants or recorder approvals were invented.

Do not apply this migration by itself to an operating facility. Reconcile legacy classification, required commands and affected consumers before a coordinated release. The complete workflow remains the subsequent core issues' responsibility.

## Executed evidence

**131 focused tests, required typecheck, lint, production build, stress, 340-migration replay, 21 SQL probes and seven observed-lock concurrency cases PASS.** Independent local-source review: **APPROVE**. The races cover revoked session/site/recorder grants, coverage expiry, resident transfer, a grant-row wait and expiry during the linked meeting AFTER-trigger wait; all deny with no committed task/audit/signature changes.

[Verification](col133-evidence/verification.json) · [Concurrency](col133-evidence/concurrency.json) · [Independent review](col133-evidence/independent-review.json) · [Source preservation](col133-evidence/source-after.json) · [Cleanup](col133-evidence/cleanup.json).

The original [strict gate artifact](../../test-results/agent-gates/2026-09-10T00-23-57-980Z-COL-133-HFO-CURRENT-AUTHORITY.json) was **FAIL** on the pre-existing npm audit and shared Finance-history gitleaks findings. After the gate resolution above, the [current strict gate artifact](../../test-results/agent-gates/2026-09-10T00-51-37-592Z-COL-133-HFO-CURRENT-AUTHORITY.json) is **PASS** on every required check (audit, gitleaks, lint, migration sequence, native 340-file replay with 21 probes, build, stress, design review, axe). Later template-link/projection changes received a fresh full SQL replay, focused regressions and Edge checks. Public login screenshots/axe passed; authenticated Kanban, live Auth/Storage and actual staff workflow acceptance were not established. PostgreSQL tests use synthetic fixtures and Supabase stubs.

## Integration review (September 10)

Hosted ledger re-read read-only through the Management API: 344 records, numbered versions through 335, no entry from any unmerged branch; see [hosted ledger](col133-evidence/hosted-ledger.json). Next free number on hosted and on origin/main is 336.

The two Finance conflicts were rehearsed on a local scratch merge (origin/main + Finance + COL-133, Finance-first numbering, branch `scratch/hfo-col133-finance-integration`, not pushed) and resolved without dropping either side; see [resolution](col133-evidence/finance-integration/resolution.json).

- **Audit export Edge function:** Finance's database-materialized snapshot handler is kept. Its definer read would have bypassed COL-133's restrictive audit rows and legacy-site scope, so a [proposed reconcile migration](col133-evidence/finance-integration/proposed_audit_export_current_authority_reconcile.sql) re-applies the identical COL-133 row predicate and explicit current site grant inside materialize and retrieve, and revokes the superseded COL-133 completion command. Its [probe](col133-evidence/finance-integration/review_audit_export_current_authority.sql) proves the snapshot equals the RLS-visible set for a site admin and an owner, that an expired current grant denies both steps while legacy access still holds, and that an owner cannot export another site without a current grant.
- **Clinical integrity probe:** union of both sides' fixtures and assertions.
- **Finance's own export suite** passes with two fixture adaptations (explicit owner site B grant; forge assertion on a still-visible job) and no weakened assertion. COL-133's Edge harness test is retired because the source it compiled is replaced; its guarantees moved to the database probe.
- Merged tree: 348 migrations and 29 probes replay PASS, Deno checks and Finance handler tests PASS, typecheck PASS, 122 focused tests PASS. [Migration reconciliation](col133-evidence/migration-reconciliation.json) records the numbering rule.

Commit-level review of `8e52a197` and `afe24111`: [integration review](col133-evidence/integration-review.json). The gate-fix commit had no findings. The feature review found no source blocker; its one blocker is an ordering constraint, reproduced on PostgreSQL: Finance's export-job column type change must apply before COL-133's export-job policies, which the Finance-first order satisfies. Clear-cut should-fix items were remediated in the follow-up commit on this branch: explicit unavailable responses for meeting-task creation and manual escalation before any database work, export completion accepting failed jobs with the current-authority assertion moved ahead of the completion command, fixed error strings in the risk scorer, revoked site and subject grant cases added to the SQL probe, and negative export tests. Recorded without change: whole-run fail-closed automation behaviour on population mismatch (owner decision), org-wide templates becoming unwritable and invisible under explicit facility typing, and the per-row policy cost on list queries.

COL-133 stays In Review; COL-135 stays blocked until COL-132's review closes.

## Resume and rollback

Integrate this reviewed source deliberately. Migrations 336–337 are branch-local, unapplied and overlap five other unmerged branches; the [migration reconciliation record](col133-evidence/migration-reconciliation.json) lists every competing claim, the absence of schema object-name overlap, the two source files that conflict with the Finance branch (`export-audit-log/index.ts`, `review_clinical_integrity.sql`) and the renumbering rule. Re-read origin/main and the hosted ledger (last read September 9: all source migrations through 335 installed) before assigning final numbers. Schema/RPC installation must precede the matching API/Edge release. Never rewrite installed history or drop classification/audit data to reopen access.

COL-135 / HFO-02 is the subsequent catalog/applicability issue, but its live blocker COL-132 remains In Review. It is not yet dependency-closed. No next feature issue was started here. Preserve Q02/Q03 and all unapproved source policy questions.

Before deployment, rollback is reverting the owned source diff. After any future deployment, retain the additive schema/history and use a reviewed forward repair, keeping affected operations unavailable if necessary. Mission alignment: **PASS**; hosted and operating readiness: **RISK**.
