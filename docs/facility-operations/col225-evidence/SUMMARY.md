# COL-225 canonical database UUID compatibility

Source HEAD `2e84c2b6a99646bc88ab340188920795e864a0f0` plus owned source diff SHA-256 `cbe42f3a0a4c9c08e020a88e775cec828a5f9a554528681f7eab74e81557be45`; unchanged through both HTTP proof attempts.

## Change and local proof

Added one canonical PostgreSQL UUID-text schema for database identities and reused it across the affected operations schemas and export create/download routes. It accepts deployed zero-version/zero-variant identifiers without rewriting them. Malformed/nonhex/missing-hyphen/whitespace/injection-shaped inputs remain rejected. Existing authorization is unchanged.

Export request_id and reminder revision/expected_revision remain explicit generated-token contracts; they were not broadened. Correct existing regex-based GET guards were not rewritten.

Red tests reproduced three failures: canonical Homewood and entity IDs rejected by existing operation schemas, and real export POST handler returned400 before reaching RPC. Green:151 tests across13 relevant files passed, including malformed IDs, route authorization/revocation and retained request-token restriction. npm typecheck, targeted ESLint and diff check passed.

## Real authenticated HTTP proof

Verified staging `iwcnajanvjvynolltflw`, schema365; local application port4325. Created a new synthetic actor and new entity, two facilities, activity and subject with random UUID values whose version and variant nibbles are zero. No existing canonical facility/entity IDs were inserted, changed or retired.

`http-initial-report.json` retains HTTP200 central requirement draft/publication, facility requirement draft/publication, manual occurrence/record and export creation. Returned facility/activity/subject and manifest filter IDs equal the exact input IDs. Manual occurrence due_at is null. These were real application requests under the fresh authenticated session.

`http-report.json` records the complete CSV download: one manifest and one occurrence, exact occurrence identity and checksum in the report; artifact `legacy-shape-export.csv`. Cross-site requirement/manual requests returned404 and export returned403. After grant revocation, requirement/manual/export and existing export download were denied (actual statuses retained).

The initial download already returnedHTTP200, but the harness attempted JSON parsing because it looked up a case-sensitive Content-Type dictionary key. Preserved that failure/log; corrected header normalization in the harness and retried the existing export. No application code change or duplicate creation was needed.

## Cleanup and limits

`cleanup.json` verifies fresh actor banned/inactive, zero live grants, both owned synthetic facilities and entity retired, and port4325 closed. Retained records, receipts and exports preserve history. Private retired fixture state: `~/.config/haven-staging/col225-fixture.json`; never reactivate it.

No schema migration, RLS change, ID remapping, dependency or production mutation occurred. This is authenticated stage-backed local HTTP proof; parent owns independent review, full/strict gates and integration/release.
