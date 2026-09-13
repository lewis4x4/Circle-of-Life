# COL-140 facility profile engineering checkpoint

Source `dfae9cc5c41256166a79d05266c075104329aef7` prepares shared profiles and unresolved drafts; this is not an approved Homewood operating profile. The exact source is pushed in PR498. Main integration and production release remain pending.

## Implemented and verified locally

The profile reads the current organization-scoped persisted catalog, checks all 91 sources and 110 components, and preserves recorded publication/source claims without promoting them to independently verified approval. Homewood identity is data; another facility uses the same model and UI. Existing drafts and publications are preserved. The prepare command creates missing drafts only, leaves unknown schedules and approvals unresolved, and cannot publish rules.

The independent local review reports `[PROOF PASS — CLEAN]`: 4,559 tests passed with two existing skips; all 11 required strict checks passed, including 369 migrations and 49 native SQL probes. Actual two-connection tests cover concurrent draft creation/edit preservation and access revocation after a wait. Native synthetic approved requirements with unknown scheduling permit actual recording without due judgment.

Evidence: `col140-evidence/independent-local-review.json`, `concurrency-result.json`, `vitest-full.log`, and `test-results/agent-gates/2026-09-13T04-43-34-353Z-COL-140-FACILITY-PROFILE.json`.

## Hosted proof checkpoint

The first guarded inspect stopped without mutation because three known historical timestamp migration identifiers were treated as future numbered migrations. The corrected exact-version-set check passed 10 local tests and independent review; runner commit `fbafd6f829d760a8a7b1d9336f1773adf10eb64b` is independently bound to unchanged application source. Migration 366 was then applied atomically and its ledger/RPC posture verified on staging `iwcnajanvjvynolltflw`. Real authenticated HTTP proof covers all 91 sources/110 components, preserves 17 pre-existing rows bytewise, prepares 97 activity dispositions and leaves 13 unresolved, and retries with zero new drafts. No rule is activated. Authenticated browser proof at1440/375 passed with zero axe, console or HTTP failures; actual prepare retries returned zero new drafts. Cross-site and revoked requests were denied; the exact fixture actor was banned/deactivated with zero live grants and its sites/entity retired. Parent inspected all four screenshots. Independent hosted review reports `[PROOF PASS — CLEAN]`.

## Unfinished issue criteria and release boundaries

No complete attributable Homewood rule approval was found. Actual applicability, evidence, procedure, performer/backup, source answer, authorized approver and effective dates remain configuration gates, routed by Decision / Approval COL-226. `HOMEWOOD-PROFILE-REVIEW.md` records the verified identity, unresolved answers, reviewer/device slots and source-attributed old-step inventory. No old step was retired. Missing staff names do not block this engineering; actual walkthrough and operating acceptance remain COL-20/COL-21.

Production publishing remains held on old revision 50bc07c4 while reviewed source is integrated. The inherited finance schema/application/Edge transition requires compatible recovery and release verification. Neither synthetic staging nor local proofs establish production or operating acceptance.

## Recovery

Before publication, source can be reverted without removing retained records. Do not delete prepared drafts or audit history as a rollback shortcut. Additive staging migration 366 must remain compatible with the preceding application; production rollback must also account for inherited migrations 340 onward and cannot simply restore the old application against incompatible write guards.
