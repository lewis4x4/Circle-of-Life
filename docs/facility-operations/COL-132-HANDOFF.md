# COL-132 — catalog implementation handoff

Source implementation is complete, independently reviewed twice, strict-gate PASS and committed on the feature branch. **Review closed September 10; the issue may move to Done as a reviewed, unmerged source segment.** No merge, hosted migration, production deploy, schedule activation or operating acceptance occurred.

Worktree: `/Users/brianlewis/Circle of Life/Haven Facility Catalog`; branch `codex/hfo-col132-catalog`, based on COL-18 commit `39d41591` over origin/main `fad17dcc`. COL-133 stacks on this branch. Preserve all concurrent work.

## Review closure (September 10)

The two release-gate blockers were pre-existing and were cleared by carrying COL-133's gate-fix commit onto this branch (`6cc1bfd7`, identical patch); the unchanged catalog source then passed the full strict gate. A second independent review of `64cc31b8` (SQL and TypeScript/seed) found no blocker; its findings and dispositions are in [review closure](col132-evidence/review-closure.json). Remediated on this branch: a client request's root template insert can no longer adopt a catalog activity or another lineage (database guard keyed on the request role claim, with an approved-bind setting reserved for COL-135); catalog tables reject TRUNCATE; a site change on template revision is rejected explicitly by the API; stable-identity tests for POST and PATCH; seed check runs from any directory. **Open for the owner:** two source header labels (AL-Y02, AL-C08) name individuals as the workbook wrote them; rule on redaction before deployment. **Deferred to COL-135:** activity-level exposure of the eleven `needs_confirmation` dispositions.

## Delivered

- Exactly 91 source mappings and 110 stable components; 11 explicit unresolved dispositions. All entries remain draft. Exact sheet/cell/text/fingerprint, composite splits, data fields and questions are retained. No unnamed duty, historical completion, approved schedule or effort estimate was inferred.
- Migration `336_hfo_activity_catalog.sql`: organization-owned catalog/provenance, immutable source mappings, stable OCE template/instance links and version lineage, private typed references to existing facility/resident/staff/asset masters. Existing writers receive identities automatically; task/template reads expose `activity_id`.
- Canonical contract: [27-facility-operations-catalog.md](../specs/27-facility-operations-catalog.md). Source: `src/lib/operations/activity-catalog.json`. Deterministic seed check: `npx tsx scripts/facility-operations/sync-activity-catalog-seed.ts --check`.

## Evidence

**66 focused tests, required typecheck, lint/build/stress, 339-migration replay and 20 SQL probes PASS.** Six additional backfill/concurrency cases prove completed evidence survives, invalid chains roll back atomically, instance binding adds no wait and session revocation during a template wait prevents mutation. Independent review: **APPROVE**.

[Verification](col132-evidence/verification.json) · [backfill and concurrency](col132-evidence/backfill-and-concurrency.json) · [source preservation](col132-evidence/source-preservation-after.json) · [cleanup](col132-evidence/cleanup.json).

The final strict [gate artifact](../../test-results/agent-gates/2026-09-09T23-22-05-537Z-COL-132-HFO-CATALOG-VERIFIED.json) is **FAIL**, with no waiver: npm audit reports 1 critical/2 high/3 moderate; shared-ref gitleaks repeats the Finance-history matches documented in COL-18. The initial catalog gate is retained separately; its service-RPC compatibility failure was repaired and the original SQL tests subsequently pass. Raw whole-project diagnostics also identify existing test-file typing debt, distinct from the passing required typecheck and changed-file diagnostics.

## Integration and rollback

Migration 336 is contiguous only on this branch. Other active branches reuse numbers. Reconcile merge order against current main and renumber this unapplied migration plus compiler reference if necessary. Do not add fake gap migrations, copy unrelated DDL or alter installed history. Apply the final migration **before** deploying APIs that select the new columns. This PR stacks on COL-18's baseline branch.

The private subject registry validates historical references; it is never sufficient current authority after transfer or termination. No new subject reader or completion command is exposed yet. Rollback and activation boundaries are in the canonical spec. Run-owned PostgreSQL services were stopped and exact temporary files cleaned; retain the source worktree and dependency/build environment.

## Next bounded issue

**COL-133 / HFO-05 — enforce site, subject and current-person authority on every operations surface** is next dependency-ready through completed COL-18. Read live acceptance/blockers, BUILD-SCOPE sections 4/5/7 and the current [integration manifest](INTEGRATION-MANIFEST.md). Preserve authority after waits/retries and test each subject/read/write/list/count/export/evidence path before exposing the private registry.

COL-135 / HFO-02 follows catalog review closure for versioned applicability, evidence and procedures. Keep Q01/Q11 and other unknowns unapproved. Select one issue; neither was implemented here. Source/local, hosted, provider, staff and operating-cycle acceptance remain separate. Mission alignment **PASS**; operating readiness **RISK**.
