# Haven InsureFlow receiver — synthetic delivery

The receiver is implemented on `codex/haven-insureflow-receiver`, stacked on the completed insurance workspace in PR #462. It adds a separate read-only agency-summary page, strict control/body validation, bounded recovery, an atomic leased database store, approved entity mapping and current-authorization reads. It reuses Haven's auth, RPC and UI patterns; it adds no dependencies or duplicate insurance/financial record pipeline.

The source ZIP hashes verified. Its authoring files are uncommitted source from Rocky's `feat/floor-v1-spine`; the surrounding checkout HEAD is not an implementation revision. Exact package hashes and synthetic fixtures are retained for review.

## Verification

- **3,658 Vitest tests passed**, zero failed, two existing skips.
- **10 packaged provider transport tests passed** with Deno's default permissions.
- Final segment gate **PASS**: `test-results/agent-gates/2026-09-09T12-28-46-623Z-INSUREFLOW-RECEIVER-VERIFIED.json` (security, lint, migration replay, production build, generic UI/a11y).
- Actual local worker → reducer → PostgreSQL RPC → authenticated projection passed initial publication, mixed validity with unrelated withdrawal, and invalid-controls unchanged-state scenarios. Final migration hashes are pinned in `test-results/insurance/insureflow/1788957204675-local-integration.json`.
- Receiver SQL probe: **21 expected rejection checks and 13 assertion blocks**, including actual rollback/retry, lease/config/expiry fences, immutable receipts/config approvals, role/raw-table denial, mapping changes, deleted entities, freshness and recovery confirmation.
- Dedicated Chromium component verification: **7 checks**, zero browser errors and zero axe violations across 5 views. Auth, API and navigation are mocked; source components/CSS are real. This is not hosted authenticated end-to-end proof.
- Independent receiver/SQL review found an omitted-snapshot case misclassified as invalid controls. The exact regression was fixed and reverified. See `independent-review.md`.

The first gate report is retained as failed evidence. Its only required failure was the repository-wide secret scan detecting two file hashes and a rejected-input test sentinel in another locally visible branch's history. Three exact historical fingerprints were added to the existing ignore file; the generic credential detector remains enabled and its regression probe passes. Three existing moderate dependency advisories remain; the required high/critical audit passes.

## Current boundary

No live source, provider patch application, production migration, credential provisioning or deployment was performed. Transport requires a test runtime, injected synthetic fetch and reserved `.invalid` origin; there is no live scheduler endpoint. The screen shows source-stated values, preserves premium without currency/cents assumptions, and hides summaries on expiry, offline state or failed recheck.

Staging origin/credentials, provider namespace, approved real account mappings, reader permissions, freshness/withdrawal timing, retention and live-use approvals remain unresolved. This delivery makes no live-readiness claim. The code and verification are reviewable while those decisions remain open.

Mission alignment: **pass** for this bounded synthetic implementation. See `receiver-contract.md`, `runbook.md`, `../insureflow-database-contract.md`, and `changed-files.txt` for details.

Final follow-up verification replayed **341 migrations and 22 SQL probes** after the last SQL audit/expiry changes; hashes are retained in `test-results/insurance/insureflow/migration-replay.json`. The staged patch secret scan passed. All run-owned database/browser processes stopped, and 1,713 exact temporary artifacts were removed through the cleanup manifest validation; private provenance records remain. Source ZIPs, Downloads, worktrees and environments were preserved.

A final four-cycle scope-return regression also reproduced and fixed retry-budget carryover from completed recoveries. New episodes reset their retry budget; unresolved episodes remain capped at three attempts. The follow-up has 92 focused passing tests and independent review.

Recovery follow-up segment gate: **PASS**, `test-results/agent-gates/2026-09-09T12-44-50-863Z-INSUREFLOW-RECOVERY-EPISODES.json`. It reran security, lint, all migration/probe checks and the production build; the unchanged UI retains its earlier browser evidence. The follow-up scratch cluster stopped and its 1,005 exact temporary artifacts were removed.
