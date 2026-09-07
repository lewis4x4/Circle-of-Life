# SYS-001 database authorization remediation

Status: source implemented and locally verified on 2026-09-06. Not deployed.

## Authority contract

Migration `326_sys_001_authoritative_actor_state.sql` uses the existing `user_profiles.auth_claim_version` contract. It does not add another authorization column.

- Existing version-1 profiles accept a legacy JWT without `auth_claim_version` so the migration itself is nonbreaking.
- Role, organization, active-state, soft-delete, and facility grant/revoke changes monotonically increment `auth_claim_version` in the same transaction.
- Once the database version exceeds 1, a missing or different version claim fails closed. A JWT containing the new integer version is accepted immediately; authorization no longer depends on second-resolution `iat` ordering.
- `public.haven_custom_access_token_hook(jsonb)` emits the current integer version, role, and organization as top-level and `app_metadata` claims. `supabase/config.toml` enables the official `pg-functions://postgres/public/haven_custom_access_token_hook` form.
- The database uses JWT `sub`, `session_id`, and `auth_claim_version` only as signed identity/session/version inputs. Current managed role and organization always come from the active, nondeleted profile. The session must belong to the same user, and the current Auth user must not be banned or deleted.
- A dedicated onboarding Auth identity without a profile remains supported only when its current `auth.users.raw_app_meta_data.app_role` is `onboarding`, its current Auth row/session is valid, and its metadata version matches. JWT role metadata is never authoritative.
- Anonymous and machine-only service identities retain their existing grant and BYPASSRLS behavior; they do not need fabricated profile/session rows.

All new privileged helpers use `SECURITY DEFINER`, an empty `search_path`, qualified objects, and revoked default execution. The custom Auth hook is executable only by `supabase_auth_admin`. The internal actor resolver is not executable by API roles.

## Covered database surfaces

The final Haven role, organization, facility, resident, and onboarding helpers all derive from the current actor. Migration 326 also replaces these final policies:

- high-cardinality resident SELECT/INSERT/UPDATE policies;
- daily-log SELECT/INSERT/UPDATE policies used by caregiver, resident-detail, vitals, infection-control, and survey workflows;
- `report_runs` SELECT/INSERT/finalization policies used by report hubs, report history/detail, PDF generation, and the scheduler;
- user dashboard preference owner policies that previously used only `auth.uid()`;
- onboarding question/response policies;
- workspace-file metadata owner, administrator, and break-glass policies;
- all four workspace-files Storage owner policies plus Storage break-glass SELECT.

The new policies use scalar `SELECT haven.helper()` forms so PostgreSQL can build InitPlans instead of evaluating current-actor/session/version lookups per candidate row. The rollback probe loads 500 scoped `daily_logs` rows and 500 scoped `report_runs` rows, then captures `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, VERBOSE)` for residents and both hot paths. For each helper and path, it requires `haven.organization_id()`, `haven.app_role()`, or `haven.accessible_facility_ids()` plus `loops=1` inside the same named InitPlan block, bounded before the next InitPlan marker; an unrelated InitPlan cannot satisfy the assertion. `accessible_facility_ids()` also materializes its actor CTE so its owner and ordinary-role branches resolve the actor once.

Other Storage policies were scanned. Competency-certificate self-service already combines `auth.uid()` with current Haven organization/facility authority; report exports, knowledge-base objects, and facility documents already use Haven helpers. The auth-uid-only workspace owner policies were the non-Data-API gap corrected here.

The final migration also replaces the service-only `complete_operation_task_review` implementation without changing its signature. While the task row is locked, it reloads and locks the active profile, live facility, and current nonrevoked facility grant; it rejects a stale claimed role, changed organization, or actor who is neither the task assignee/current assigned role nor a current operations mutation role. The bulk-completion RPC composes this command and inherits the same per-task atomic check.

Task defer now uses the service-only `defer_operation_task_review` transaction instead of a route-side insert/update/audit sequence. The command locks the original task and current authority rows, validates current mutation scope, inserts exactly one replacement, marks the original deferred, and writes its audit receipt atomically. Hashing uses core `pg_catalog.sha256(pg_catalog.convert_to(...))` plus `pg_catalog.encode`, so the command does not depend on an extension schema appearing in `search_path`. A stable actor/task SHA-256 request key plus normalized payload hash and stored replacement ID resolve lost responses: exact committed retries return the stored replacement even after the requested defer time has passed, while changed payload under the same task request is rejected. Strict `deferred_until > clock_timestamp()` validation applies only to brand-new requests. The partial unique request-key index and original-row lock serialize concurrent retries.

## Rollback-only matrix

`supabase/tests/review_authoritative_actor.sql` proves:

| Case | Result |
|---|---|
| Version-1 token missing the custom claim | Accepted for backward compatibility |
| Missing claim after any authority increment | Rejected |
| Old version after role, active, deleted, or facility change | Rejected |
| Immediate fresh integer version | Accepted |
| JWT owner metadata after current caregiver demotion | Current caregiver role; owner-only onboarding DML denied |
| Current active owner | Organization-wide facility/resident access retained |
| Missing session or session belonging to another user | Rejected |
| Malformed UUID or overflowing/malformed version | Rejected without cast leakage |
| Managed or onboarding Auth ban/delete | Rejected |
| Dedicated onboarding identity | Question read and same-organization response write allowed |
| Family linked, unlinked, and revoked resident | Only current nonrevoked link allowed |
| Workspace Storage owner SELECT/INSERT/UPDATE/DELETE | Current exact version required; stale version cannot read or mutate |
| `SET ROLE service_role` plus service-only AI RPC | Preserved |
| Service operation RPC with current caregiver falsely claimed as owner | Rejected atomically; task remains pending |
| Same service operation RPC after current owner restoration | Accepted with current role recorded in audit |
| Atomic defer identical replay | Returns the same replacement ID; one replacement and one operation audit exist |
| Atomic defer exact replay after requested timestamp passes | Returns the same stored replacement receipt |
| Brand-new past or equal-now defer | Rejected before replacement, original update, or audit |
| Atomic defer retry with changed time/reason | Rejected as changed content; committed receipt remains unchanged |
| Atomic defer audit failure injection | Replacement insert, original update, and receipt all roll back |
| Representative resident policy plan | `InitPlan` present |
| 500-row daily-log and report-run policy plans | Named Haven helper InitPlans execute with `loops=1` |

The representative user RPC remains `allocate_incident_number(uuid)`, which composes current role, organization, and facility helpers. Existing rollback fixtures were changed only to add real `session_id` and integer `auth_claim_version` claims.

## Verification evidence

- `npm run migrations:check`: PASS, 329 files, numbered sequence `001..326`.
- Native PostgreSQL 17 full replay: PASS, 329 migrations and 11 SQL probes.
- Dedicated authorization/onboarding/Storage/version matrix: PASS within the full replay.
- Dedicated scaled authorization/performance probe: PASS after applying all 329 migrations.
- Production-like replay with `authenticator`: PASS; exact `pgrst.db_pre_request=public.haven_assert_authorized_request` installed.
- Conflicting pre-request configuration: migration fails instead of overwriting it.
- `git diff --check`: PASS.
- `npx tsc --noEmit -p tsconfig.typecheck.json --pretty false`: PASS.

## Deployment gates

Migration 326 configures PostgREST only when `authenticator` is absent or already exact. If a different `pgrst.db_pre_request` exists, or the migration role cannot run `ALTER ROLE`, deployment fails. A deliberate composition decision is required for any existing pre-request function; migration 326 will not silently replace it.

Require this read-only check after deployment:

```sql
SELECT 'pgrst.db_pre_request=public.haven_assert_authorized_request' = ANY(rolconfig)
FROM pg_roles
WHERE rolname = 'authenticator';
```

Also verify the hosted Auth Custom Access Token hook is enabled for `public.haven_custom_access_token_hook`. The checked-in `config.toml` configures local/CLI environments, but source presence alone does not prove the hosted dashboard configuration. Sign in or refresh, decode a sanitized JWT, and confirm `auth_claim_version` is a JSON number matching the profile row.

PostgREST invokes `db_pre_request` once after role impersonation and before the main Data API/RPC query. It does not cover Realtime, Storage, or other products, which is why the RLS helpers and Storage policies independently enforce current authority. Supabase references:

- Custom Access Token Hook input/output and required claims: <https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook>
- Postgres Auth Hook registration and grants: <https://supabase.com/docs/guides/auth/auth-hooks>
- Session-row validation for immediate JWT invalidation: <https://supabase.com/docs/guides/auth/sessions#how-to-ensure-an-access-token-jwt-cannot-be-used-after-a-user-signs-out>
- Data API pre-request scope: <https://supabase.com/docs/guides/api/securing-your-api#pre-request-checks>

Hosted verification must reuse a signed-in JWT after disable, delete, demotion, facility revoke, and session deletion, then verify a refreshed hooked JWT immediately receives the intended current access. Measure resident, daily-log, report-history, Data API, and Storage latency at production cardinality and realistic concurrency. The local 500-row `EXPLAIN ANALYZE` evidence proves named helper InitPlan placement and one-time execution in PostgreSQL 17; it does not establish hosted cache behavior, production latency, or Auth/Storage end-to-end performance.

## Mission alignment

**Pass at source level.** The design strengthens Haven's role-governed data layer while preserving onboarding, family, specialist, owner, and machine-service identities. Operational alignment remains **risk** until migration 326, the PostgREST hook, the hosted Auth hook, and real signed-token tests are verified on the matched deployment.
