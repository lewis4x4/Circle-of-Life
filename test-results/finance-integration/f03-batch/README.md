# Migration 340 local batch evidence

The frozen SQL engine supports exact immutable local review. Accounting classification remains `unverified`, business release is false, and dispatch is disabled. These results do not complete F03/F05 or establish provider, privacy, accounting, hosted or real GoTrue/PostgREST acceptance.

- `fresh-final-replay.json`: successful fresh native PostgreSQL replay of 343 migration files (numbered through 340 plus three legacy timestamp files), followed by 24 SQL probes.
- `replay-source-manifest.json`: exact input hashes captured for that replay, including the native Auth stub. Later source changes are not covered by this result.
- `sql-assertions.json`: 53 executed batch assertions extracted from that successful raw replay log, with source/log hashes and a standalone reproduction invocation.
- `concurrency.json`: nine author assertions with observed blocking waits, exact outcomes and migration/harness hashes.
- `concurrency.py`: the exact run-specific author harness. It targets the manifest-verified run-owned native database and commits synthetic fixtures there. It is retained for reproduction review, not a general-purpose or hosted test command. Reproduction requires a separately owned native database and an explicitly adapted manifest/target; do not repoint it at an existing application database.

Raw logs, including earlier failures, remain in the private run manifest at `/Users/brianlewis/.hermes/tmp/agent-runs/hfa-20260908-01a08335/f03-batch-340/manifest.json`. The native databases are retained for reviewer/parent use. No Docker or hosted infrastructure was changed for this batch slice.

`independent-auth-review.json` and its exact run-specific `independent-auth-probe.py` retain the separate reviewer's APPROVE evidence: 53 regression assertions, 18 controlled races, three invalidation-receipt rollbacks and 72 direct privilege checks. Review counts overlap the author regression suite and must not be summed as unique coverage. The independent probe likewise targets only its manifest-owned native fixture.
