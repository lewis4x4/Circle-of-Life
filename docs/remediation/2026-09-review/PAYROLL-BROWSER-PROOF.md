# Payroll freshness browser proof — 2026-09-08

**PASS for the bounded synthetic local payroll workflow.** This is actual rendered Playwright Chromium interaction with Haven, real signed GoTrue owner claims, real PostgREST 14.4 and PostgreSQL 17.9. It is not hosted release or customer acceptance proof.

## Verified behavior

1. Opened `/admin/payroll/dbf796e0-55d6-4feb-9ade-7c84f978eb5e` as the synthetic owner in Synthetic Harbor A. The draft showed one approved punch.
2. Clicked **Refresh approved punches**. The UI reported `1 added; 0 refreshed`. Stored line `3574ce97-6a8a-4988-98ca-c11c0b1023b5` contained 8 hours, source revision 1.
3. Corrected that synthetic punch to 9 hours, invalidated its approval, then reapproved it using SQL fixture actions in the isolated database. Without refreshing the page's existing line, clicked **CSV (full)**. Real snapshot RPC returned HTTP 400, the UI displayed “Payroll punches changed…” instructions, and no browser download occurred.
4. Clicked **Refresh approved punches** again. UI reported `0 added; 1 refreshed`. The **same line UUID** now contained 9 hours and source revision 3. CSV download succeeded.
5. Marked the batch exported using SQL with the signed owner's claims, then corrected and reapproved its source punch to 10 hours. Reloaded the browser: the historical exported-batch explanation was visible. **CSV (full)** succeeded and was **byte-for-byte identical** to the earlier 9-hour file. Stored exported payload remained unchanged.

Import, refresh, error rendering and download actions were browser interactions. Punch correction/reapproval and exported-status transitions were controlled SQL fixture actions; their editor workflows were not exercised.

## Exact source and environment

- Migration `341_payroll_source_freshness.sql` SHA-256: `4801112cc77b0922807bf81685aa40908e3b6887a74a93cb0749d14d970ef285`.
- Payroll detail page SHA-256: `9a0141e61191067db35bc23fda835afd3ee807a6ba0a6c2b6a669e80f178a5fb`.
- Private source snapshot used separate Next development server port 3198; it did not share the parent build's `.next` output.
- Dump/restore cloned the existing synthetic native runtime into owned database `haven_payroll_browser_01a08175`; original database and sibling services were untouched. Clone already contained migration 340; migration 341 applied successfully.
- Separate PostgREST 59982 and gateway 59983 used the clone. Existing real Auth service provided verification of the copied, unexpired owner session.
- Local HTTP gateway required Playwright `bypassCSP` because current application CSP assumes HTTPS Supabase. Local gateway added `accept-profile` and `content-profile` to CORS. Neither application CSP nor hosted transport configuration is proven by this run.
- `agent-browser` CLI was unavailable; installed Playwright Chromium provided the actual browser coverage without installing dependencies.

## Evidence and cleanup

Private evidence root: `/Users/brianlewis/.hermes/tmp/agent-runs/haven-payroll-browser-20260908-01a08175`.

Retained proof: `proof.json`, `imported.png`, `stale-blocked.png`, `refreshed.png`, `historical.png`, `current.csv`, `historical.csv`, source setup/verification scripts and concise runtime logs. This synthetic evidence contains no customer data. Secrets and session material must not be committed.

Owned process IDs/ports and exact disposable paths are recorded in `manifest.json` and `cleanup-provenance.json`; steward manifests/logs record exact-path cleanup validation. Run-owned services were stopped and the owned database dropped after proof. Shared native runtime remains available to its owner.

Cleanup limitation: `jarvis-storage-steward cleanup-run --manifest <run-root>/cleanup-0.json` failed closed with `StateSafetyError` (exit 2). The source snapshot remains in the 0700 run root alongside proof; its rejected cleanup was not bypassed. A separate ordinary-file manifest, `cleanup-private-files.json`, containing only the run-owned `clone.dump` and `storage.json`, passed steward validation (exit 0, `planned_count: 2`). Those two exact files were then removed. The root manifest inventories ownership; the sibling `node_modules` symlink target was never changed or deleted. Removal of the retained source snapshot needs resolution of the first steward validation failure.
