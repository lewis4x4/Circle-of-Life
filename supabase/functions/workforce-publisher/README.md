# Haven workforce publisher (COL-721)

This function publishes one private, complete workforce roster to Front Office. It is separate from the aggregate Stand Up feed and delegated officer catalog. Source code and disabled scheduling are not evidence that a feed is active.

The exact destination is `https://wecsjfiituxlityaacba.supabase.co/functions/v1/workforce-ingest`. The function accepts only POST with an empty body or `{}`, authenticated using its dedicated `x-cron-secret`. Callers cannot choose a source organization, destination, employee or arbitrary payload. The Edge entrypoint requires Haven's project URL `https://manfqmasfqppukpobpld.supabase.co` and uses its own injected service role only for Haven RPCs; neither credential travels to Front Office.

## Native source mapping

- `organizations`, `entities`, and `facilities`: minimal names and typed source relationships; no FEIN, contact data or inferred employee legal employer. Unknown free-text entity types become null.
- `staff`: stable staff-row ID and composed first/last name, native `staff_role`, employment status, hire date and raw termination date. A staff row remains a source employment record; same names and repeated user links never merge identities. `job_title`, legal employer, pay basis, last day worked, effective employment end and processing time are null because no corresponding verified typed source fields exist. Hourly rates, full-time flags, email and other personnel data never enter the export.
- `staff.facility_id`: one `staff_home` assignment per staff record, with the staff ID in that distinct namespace.
- `staff_facility_assignments`: native ID, home-independent additional facility, role, `is_primary`, and raw dates. The native end date is inclusive, as established by the `end_date >= current_date` checks in migrations 408 and 468. An additional assignment with `is_primary=true` still does not replace the home assignment.
- `facility_executives` (migration 459/COL-571): facility responsibility and its effective start. A unique nondeleted staff row linked to the source `user_id` resolves the holder. Zero or multiple rows preserve an unresolved opaque user reference. No profile name/title or line-manager edge is invented. `reporting` is empty.
- Soft-deleted native records are explicit deleted source assertions, including their minimal required identity/name and deletion time. They are not employment terminations. This roster tombstone projection is intentionally different from ordinary operational reads, which filter soft-deleted records. Snapshot omission also cannot terminate anyone.

One export SQL statement supplies all collections from one MVCC snapshot. Broken tenant references reject the full export. Limits are 5,000 staff records, 500 units, 20,000 total source assertions and 2 MiB final UTF-8 body. SQL and the shared validator enforce bounds; oversized data is never truncated.

## Private durable delivery

Migration `496_workforce_roster_publisher.sql` creates `haven.workforce_publisher_state` and `haven.workforce_publisher_receipts`. Both have RLS and no direct grants to anonymous, member or service roles. Service-only security-definer RPCs independently require the service JWT role and a live lease token/run/generation for every sensitive step.

The queue stores exact serialized bytes and their SHA-256 before sending. One lease fences simultaneous jobs. Retry retains the batch ID, sequence, observation time and bytes, while using a fresh signed timestamp. Every failure retains pending data. The runtime revalidates even persisted bytes before signing. Only a 200 receipt matching batch, sequence, source observation and body hash advances the sequence; completion records opaque receipt IDs/hashes/counts and clears the queue and lease atomically. Configuration changes invalidate leases, and an established source organization cannot silently be repointed.

The roster body exists only in the private pending state and authorized network calls. Names, compensation, source rows and receiver error bodies are absent from publisher logs, audit metadata, model input, Notion and notifications. The script and tests below use synthetic data only and print counts/status rather than roster bodies.

## Configuration and activation

Migration defaults: no organization, no key ID, `enabled=false`. No real tenant is guessed or seeded. The daily `workforce-publisher-daily` cron scaffold uses `0 10 * * *` UTC and is created with `active=false` when pg_cron exists. Its function independently checks the disabled state before reading Vault or sending anything.

The scheduler uses `cron.schedule` without a username override, then `cron.alter_job` in the same migration transaction. Managed `postgres` has no direct update privilege on `cron.job`. An existing same-name job is retained only when its command, schedule, owner, database, host, port and inactive state exactly match; a mismatch fails with `workforce_scheduler_name_conflict` without overwriting or disabling that job. Investigate the existing job's ownership before retrying; the migration never takes it over.

Required dedicated configuration:

| Name/location | Purpose |
| --- | --- |
| Edge `WORKFORCE_PUBLISHER_CRON_SECRET` | Authorize only this publisher; use at least 32 random bytes |
| Vault `workforce_publisher_cron_secret` | Same dedicated cron secret for the source-owned tick |
| Edge `WORKFORCE_INGEST_SECRET` | Dedicated source/dataset HMAC key, at least 32 bytes; matched to the receiver's private key registry |
| `haven.workforce_publisher_state.organization_id` | Verified native Haven organization UUID |
| `haven.workforce_publisher_state.key_id` | Receiver-registered workforce key ID, bound to Haven/organization/workforce_roster |

Never reuse Stand Up, officer federation, browser or another source's keys. Do not place source database credentials in Front Office. Missing secrets/configuration fail closed. Administrative refresh is a server-side invocation of this same endpoint with the scoped cron secret; no new browser refresh permission is created.

Release coordination must first verify migration ledger and deployed function content/version, configure matching source/receiver scope privately, enable the source state and invoke one controlled publication. Inspect the source receipt ledger and receiver's matching receipt/body hash, observation time and counts without exporting names into tracker artifacts. Enable the daily job only after that readback. Root owns activation and verification for COL-716; this worktree does not perform live configuration or publication.

Rollback: disable this source's state and daily job, and disable the receiver key if immediate admission must stop. Preserve pending bytes, receipts and canonical Front Office records. Do not reset sequence, clear ambiguous pending batches or drop the tables as a rollback.

## Verification

- `deno check --no-lock --config supabase/functions/deno.json supabase/functions/workforce-publisher/index.ts`
- `deno test --no-lock --config supabase/functions/deno.json supabase/functions/workforce-publisher/`
- `supabase/tests/review_workforce_publisher.sql`: actual native schema fixtures, private-field exclusion, same-name identities, cross-facility facts, executive ambiguity, soft-deletion semantics, role denials, bounds, leases/generation, exact replay, receipt ledger and cross-tenant refusal.
- `scripts/workforce/verify-source-contract.mjs`: runs that transactional probe, pipes its synthetic export in memory to the frozen v1 signed receiver validator, and prints only counts/byte size/outcome. The migration replay runner calls this once for native and Docker paths. It accepts only a named isolated local verification database or the runner's own container.
- `WORKFORCE_SCHEDULER_CONTAINER=supabase_db_col721-scheduler-<owned-run> node scripts/workforce/verify-scheduler.mjs`: requires a dedicated local Supabase provider stack with pg_cron installed, verifies its CLI project label and managed non-superuser caller, and executes the exact scheduler block from migration 496. Covers atomic inactive creation, exact replay and command/schedule/database/active/owner/host/port collisions. Administrator access arranges only synthetic local metadata fixtures; scheduler calls use `postgres`, refuse direct table-update privileges, and leave no jobs. Never point this probe at a shared or hosted stack.
- Required Haven segment/repository/CI/hosted gates remain separate. On 2026-09-24, this publisher's unchanged SQL moved from 486 to 496 after approved sequence placeholders occupied 486/487; current main ends at 487, so 488–495 remain prerequisites. No copied pending work or contiguity bypass is allowed.

The vendored `contract/types.ts` and `contract/protocol.ts` are byte-identical to Front Office's `src/backend/workforce/` contract on 2026-09-23, including native Cornerstone organization `closed` status. SHA-256: types `cb99d7e95ef7ec225d2807044f667c7a46e57cb89471520b33673d0811e8c516`; protocol `3b7ee2b65f703a957194bb3e8892cbb174bfebf89b27557f2363c6c7bf7188c8`. Re-vendor only as a reviewed cross-repository contract change.
