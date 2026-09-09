# Durable insurance authority race regressions

Run the real PostgreSQL concurrency suite from this checkout against an already running, run-owned native cluster:

```sh
PG_VERIFY_NATIVE_SOCKET="$HOME/.hermes/tmp/agent-runs/<run-id>" \
PG_VERIFY_NATIVE_PORT=55449 \
PG_VERIFY_NATIVE_BIN=/opt/homebrew/opt/postgresql@17/bin \
node scripts/insurance/verify-authority-races.mjs
```

Use the same socket, port, PostgreSQL binary directory and private provenance manifest as `scripts/pg-verify-migrations.mjs`. The socket must resolve beneath `~/.hermes/tmp/agent-runs/`; its directory's `manifest.json` must have `created_by: "codex"` and `run_id` matching the directory name. There is no database URL, hosted-host fallback, migration-path override or existing-database option. Inherited `PG*` connection settings are removed from child processes, and the initial server check requires a Unix-socket connection (`inet_server_addr()` null).

The runner creates one uniquely named `insurance_authority_*` database, replays the current complete migration chain with the repository Supabase stubs, and seeds only its synthetic fixture. It drops only that database in `finally`, including when a check fails. Each child process, SQL statement and synchronization wait has a timeout; the test work has a three-minute budget followed by bounded cleanup. Interrupted or failed runs return a nonzero exit status and retain a JSON result, including cleanup failure details if the database could not be dropped.

## What is proved

1. **Servicing actor revoked while queued:** connection A holds the organization's servicing advisory lock. Authenticated connection B queues a new save with no assignee, isolating actor authorization. Connection C disables B's actor and commits before A releases. B must return SQLSTATE 28000 and create zero records.
2. **Policy reviewer revoked while queued:** A holds the draft row. B queues approval; C disables the reviewer and commits. After release, B must return 28000, create zero policies and leave the draft unapproved.
3. **Trusted processing actor revoked while queued:** A holds the source document. B calls `start_extraction` as `service_role`; C disables the server-derived actor and commits. B must return 42501 after release, leaving processing state and run ID unchanged. This deliberately does not use an end-user JWT for the service call.
4. **New assignee disabled while qualification waits:** A updates the prospective manager assignee to inactive without committing. B queues a save on the assignee's scope lock. A commits the disable. B must then return 22023 and create zero records. This proves qualification happens after the retained profile lock, rather than against the earlier visible active row.

The runner observes the actual blocked PostgreSQL backend through `pg_stat_activity`; it does not approximate races with arbitrary sleeps. Assertions check the expected SQLSTATE and error, the observed lock wait, and zero forbidden mutations. Deterministic blocker release and process/database cleanup are part of the result.

## Evidence

Every execution writes a new JSON file under `test-results/insurance/authority-races/`; previous results are retained. Each result includes runner/migration/stub/fixture SHA-256 hashes, the validated native run identity, PostgreSQL version, per-case wait event, rejection code, mutation counts, elapsed time, and database cleanup status. A run is a pass only when all four checks pass and its database was dropped.

Initial durable run: `test-results/insurance/authority-races/1788921853574-51829-d37c1e11.json` — all four cases passed; scratch database dropped.

Final runner verification: `test-results/insurance/authority-races/1788922157122-58584-3c08b477.json` — all four cases passed, runner/source hashes recorded, scratch database dropped. JavaScript syntax and explicit ESLint checks also passed.

This is local database authorization evidence using real current-profile/session helpers and Supabase stubs. It does not prove hosted authorization, browser behavior, actual uploads/malware scanning, extraction accuracy, or clinical/customer acceptance. The source's ready status is seeded solely to isolate the processing-authorization race.
