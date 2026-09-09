# Agency summary browser verification

Set `INSURANCE_BROWSER_RUN_DIR` to the explicitly owned current run directory, then run `node scripts/insurance/agency-summary-browser-smoke.mjs` using the existing workspace dependencies. There is no default run directory. The script renders the real read-only agency component and Haven CSS in full Chromium. Its auth, navigation and API are explicit fixtures; no product module imports fixture data and no live provider is configured or contacted.

The run verifies the disabled empty state, unconverted source premium/provenance, mobile width, degraded completeness, expiry hiding, offline hiding and failure hiding. Axe covers the empty, desktop, mobile, degraded and expired views. Screenshots and machine results are in `test-results/insurance/agency-summary-browser/`; all screenshots carry a visible synthetic-test label.

This is browser component evidence, separate from actual SQL reconciliation, API session enforcement, provider transport and hosted acceptance. It does not validate a live connection or approve readers, mappings, freshness timing or retention.

The run directory must resolve directly beneath `~/.hermes/tmp/agent-runs/`, with a private regular manifest whose `created_by` is `codex` and whose `run_id` matches the directory name. Disposable harness files, Vite cache and browser profile use a fresh timestamped directory under that run and are appended to its existing manifest. Evidence uses a fresh timestamp/run-ID folder on every invocation; `latest.json` explicitly points to its result without overwriting earlier evidence. Browser/server close when the run finishes. The owning run performs exact-path cleanup with its storage steward.
