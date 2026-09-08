# Native integration runtime (2026-09-08)

Mission alignment: pass for isolated synthetic integration preparation. No customer readiness or hosted release claim.

Run ownership: `/Users/brianlewis/.hermes/tmp/agent-runs/haven-native-integration-20260908-01a080c2` (0700). All downloaded sources, Go caches, binaries, databases, logs, scripts and secrets are beneath that root. `manifest.json` records exact artifact paths, process IDs, ports, runtime pins and archive/binary SHA256 values. No global installs, Docker changes, hosted mutations, or application configuration changes occurred.

## Running endpoints

- Browser-compatible local gateway: `http://127.0.0.1:59993` (routes `/auth/v1` and `/rest/v1`, local CORS).
- GoTrue Auth: `http://127.0.0.1:59991`.
- PostgREST: `http://127.0.0.1:59992`.
- PostgreSQL: `127.0.0.1:55444`, database `haven_native_acl`, admin role `postgres`; loopback-only TCP, Unix sockets disabled. This isolated cluster uses local trust authentication. The parent's port 55443 is untouched.

## Versions and evidence

- Haven snapshot: `47bd04a8e633b98a488507629c6e860cc1495bd9`.
- All 342 committed SQL files through numbered migration 339 replayed successfully; per-file hashes/results are in run-root `evidence.json`. Migration 340 was not included.
- Supabase Auth `v2.189.0`, built from the official pinned release using installed Go 1.26.2 and run-owned dependency/build caches.
- PostgREST `14.4`, official macOS arm64 release binary.
- PostgreSQL `17.9` Homebrew. Cached target metadata referenced 17.6.1.084; this native patch difference remains explicit. Auth/PostgREST pins match cached metadata, not a newly queried hosted target.
- Real GoTrue applied its own schema migrations and official `auth.uid`, `auth.jwt`, and related helpers. No authorization helper stubs.
- Real password grant returned signed claims including `session_id`, `app_role=owner`, and `auth_claim_version`. Real PostgREST `haven_current_edge_actor` returned 200 with the synthetic user identity.
- Deleting that synthetic Auth session made the same signed token fail the current Haven request guard with HTTP 401. A fresh login is retained for browser work.
- Public signup returned HTTP 422 `signup_disabled`. SMTP is unconfigured; GoTrue reports its no-op mail client. Only synthetic `.invalid` admin-created users are used for runtime acceptance.

Private secrets and session details (never commit): `private/auth-env.json`, `private/postgrest-env.json`, `private/status.json` (API URL, anon/service keys, DB URL), `private/fixture.json` (synthetic owner credentials and fresh session). Nonsensitive concise proof: `private/verification.json`. Runtime startup logs: `logs/auth-2.189.0.log`, `logs/postgrest.log`, `logs/postgres.log`.

## Continue against this runtime

Read `private/status.json` programmatically to populate browser server environment (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY`). Keep environment values in private run files and do not print them. Synthetic owner login is in `private/fixture.json`. Start the application on a free local port using the parent's normal owned process procedure.

Apply future **committed** migrations only after checking the new source SHA. Extract each exact file with `git show <committed-sha>:supabase/migrations/<file>` to a recorded private artifact, then use `/opt/homebrew/opt/postgresql@17/bin/psql -h 127.0.0.1 -p 55444 -U postgres -d haven_native_acl -v ON_ERROR_STOP=1 -f <private-file>`. Record its SHA256 and result. Finally run `NOTIFY pgrst, 'reload schema';` in that database. Do not replay all historical migrations against the populated database.

`verify.py` creates a new synthetic owner and repeats the password/current-actor/revocation checks; it updates private credentials. It is an infrastructure smoke test, not the full staging harness.

## Limits and ownership end

Storage tables/functions are compatibility scaffolding solely for migration replay. No real Storage service, Realtime service, Edge runtime, provider integrations, email delivery, or full browser/customer UAT is proven. Historical migration seed rows are present in this isolated DB; they are not copied customer data. An earlier attempt using latest Auth v2.196.0 remains in the unused `postgres` database and downloaded artifacts; that Auth process is stopped. Active services target `haven_native_acl` with the parity pins above.

Keep these run-owned services active until the parent explicitly completes browser/integration work. At final cleanup verify PID command identity and root, stop only recorded current services, and validate exact artifact cleanup with `jarvis-storage-steward cleanup-run --manifest <absolute-path>`. Never touch prior containers, sibling runs, worktrees, or the parent PostgreSQL instance. Cleanup manifest schema may need conversion to the steward's documented schema before invocation; do not assume the provenance inventory itself is accepted.

Official references: [Auth v2.189.0](https://github.com/supabase/auth/releases/tag/v2.189.0), [PostgREST v14.4](https://github.com/PostgREST/postgrest/releases/tag/v14.4), [self-hosted Auth hooks](https://supabase.com/docs/guides/self-hosting/self-hosted-auth-hooks).


## Browser fixture v2 and platform ACL correction

Current private browser bundle: `private/browser-fixtures-v2-acl.json`; verification: `private/browser-fixtures-verification-v2-acl.json`. Both are under the private run root above. Six confirmed synthetic `.invalid` users (owner, facility_admin, nurse, med_tech, caregiver, family) have real password-grant sessions and current-actor proof. Five non-family users have active staff rows. Dedicated Synthetic Harbor Care organization, Synthetic Harbor Operations entity and Synthetic Harbor A/B facilities isolate screenshots from historical seeds. Family resident link is intentionally absent.

A real table probe exposed missing native Supabase default table ACLs despite passing current-actor RPCs. Corrected by creating another fresh `haven_native_acl` database, applying official Supabase initial public default privileges **before** real Auth migration and all 342 Haven migrations. No late broad grants were applied. `haven_native` and its original fixtures remain retained; `private/browser-fixtures-pre-acl.json` preserves the earlier browser bundle. The initial `private/fixture.json` belongs to the earlier database and must not be used with current endpoints. Current endpoint keys remain in `private/status.json`, now naming the ACL-corrected database.

Verified through real PostgREST: owner sees exactly synthetic facilities A/B (2 rows); facility_admin sees only A (1 row). Direct INSERT to resident_observation_logs, payments and purchase_orders returns 403 / 42501 permission denied. Official role budgets are configured: authenticated 8 seconds, anon 3 seconds. Current detached Auth PID 91782, PostgREST PID 91783, gateway PID 85603 (verify process identity before stopping). Logs: `logs/auth-acl.log`, `logs/postgrest-acl.log`; replay proof `logs/acl-replay.json`.

Official platform ACL reference: [Supabase initial schema](https://github.com/supabase/postgres/blob/develop/migrations/db/init-scripts/00000000000000-initial-schema.sql), downloaded privately as `official-initial-schema.sql`. Authentication and data services remain the pinned versions documented above.
