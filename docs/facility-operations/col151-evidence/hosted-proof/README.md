# COL-151 synthetic hosted HTTP proof

**Prepared, not executed.** This runner performs no migration application. It requires the parent to finish source gates, independent review, staging migration readback, and local app process/source/target checks first. Only `--help` and offline compilation were executed during preparation.

Target is exactly `iwcnajanvjvynolltflw` (Haven HFO Staging). Local app origin must name an explicit localhost port. The runner reuses COL143 transport/workflow concepts through a source import, with its own initializer and `col151-fixtures.json`; it never instantiates COL143's initializer or reads its fixture state. Existing staging credentials are read only from the dedicated private `~/.config/haven-staging/col217.env`. Do not copy or print credentials into this folder.

## Parent prerequisites

1. Commit the application, migration, SQL probes and this runner. Run the strict required segment gates and obtain an independent `[PROOF PASS — CLEAN]` review on that source SHA.
2. Independently verify the explicit staging project, apply only approved pending migrations through the separate staging process, and verify migration 365 and its RPCs. No staging rebuild or seed replay belongs to this proof.
3. Start the local app from that exact committed checkout against the dedicated staging configuration. Verify the actual process, source SHA, API target, and Auth hook. The runner cannot infer process provenance from the port alone.
4. Write untracked `READY.json` with the following shape. Referenced artifacts are hashed and checked before every network call. Review and staging readiness attestations must be attributable records backed by actual evidence, never generated just to pass the checks.

```json
{
  "projectRef": "iwcnajanvjvynolltflw",
  "checkout": "/Users/brianlewis/Circle of Life/Haven Activity Export",
  "integrationSha": "<40-character committed SHA>",
  "stageReady": true,
  "authHookEnabled": true,
  "localAppSourceAndTargetVerified": true,
  "appUrl": "http://127.0.0.1:PORT",
  "gate": {"path": "<absolute strict gate JSON path>", "sha256": "<file digest>", "sourceSha": "<same committed SHA>"},
  "review": {"path": "<absolute review JSON path>", "sha256": "<file digest>"},
  "stagingReadiness": {"path": "<absolute staging readback JSON path>", "sha256": "<file digest>"}
}
```

The gate JSON must have `verdict: PASS` and all required checks `passed`. The review JSON must have `result: "[PROOF PASS — CLEAN]"`, `independent: true`, and matching `sourceSha`. Staging readback JSON must have `target`, matching `sourceSha`, and `migration365Verified: true`. Preserve supporting evidence/attribution in those documents too.

## Execution

Use Python 3.12+ without `-O`. The reused COL143 helper uses assertions as workflow checks. Execute each phase once and inspect its result before proceeding:

```sh
python3 docs/facility-operations/col151-evidence/hosted-proof/proof.py preflight
python3 docs/facility-operations/col151-evidence/hosted-proof/proof.py fixtures
python3 docs/facility-operations/col151-evidence/hosted-proof/proof.py proof
python3 docs/facility-operations/col151-evidence/hosted-proof/proof.py cleanup
```

`fixtures` creates fresh synthetic Auth actors, two facilities, one entity and a facility subject. It uses no previous fixture actors or credentials. A partial fixture setup sets `fixtures_pending` and stops automatic retries; inspect the exact new IDs privately before recovery. Phase checkpoints similarly stop on uncertain command responses instead of silently creating duplicate writes.

`proof` uses current HTTP requirement publication, configuration publication, generation, work recording, evidence upload/finalization and correction contracts. It generates one current occurrence plus 1,000 future weekly occurrences in batches of 100. Each batch spans under the service's 800-day limit. These dates are synthetic export-volume fixtures, not real facility schedules or a production scheduling acceptance claim.

Assertions cover:

- The actual authenticated download response is CSV, an attachment and `no-store`.
- All 1,001 unique occurrence rows reconcile to the manifest, with receipt/evidence totals.
- Original and correction receipts, correction lineage, and a finalized PNG evidence reference survive export.
- Appending a further correction leaves the original downloaded snapshot byte-for-byte unchanged; a fresh export sees the new receipt.
- Anonymous, another requester, another facility, and the previously valid cookie after grant revocation cannot download the saved export.
- No private object path, signed URL or access token appears in the CSV.

Actual synthetic CSV bytes and redacted JSON results are saved here. A `SUMMARY` PASS describes only this synthetic authenticated hosted API proof; it is not independent review or facility/customer acceptance. This script does not replace the source tests for concurrency, multi-version history or native authorization edge cases.

`cleanup` revokes the exact new actors' grants, deactivates their profiles and synthetic sites/entity, and bans their synthetic Auth users. Immutable receipts, export snapshots, audit history and finalized evidence objects are retained. It never deletes clinical/history rows or modifies earlier fixtures. Record any interrupted setup or cleanup as incomplete and retain the exact private state for narrow recovery.
