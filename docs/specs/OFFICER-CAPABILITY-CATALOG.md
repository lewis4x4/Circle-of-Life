# Officer capability catalog (Front Office capability federation, Haven target)

Status: built on branch `codex/haven-officer-catalog`, migration `339_officer_capability_catalog.sql`, Edge Function `officer-catalog`. Not deployed. The gateway key ships **disabled** and the registry ships **empty**; nothing answers until the operator completes section 6.

Wire contract: Front Office `docs/specs/0004-CAPABILITY-FEDERATION.md`, contract version `front-office-capability-v1`, target name `haven`. That document is the single wire contract; this file describes Haven's implementation of its sections 2 and 3, the catalog's exact predicates, and the operator procedure.

## 1. What it is

Front Office (the officers' shared desk) can ask Haven a small number of **named, versioned, aggregate-only questions** on behalf of a signed-in officer, and can run one synthetic command that proves the confirm path. Haven answers from its own tables, under a scope Haven itself resolves, and audits every call.

What it is not:

- Not a query interface. There is no SQL, table name, parameter or free-form filter in any v1 request: every read is organization-wide and answers with a per-facility breakdown. The target dispatches on the capability name with `CASE`.
- Not a PHI path. Every capability has `phi_class = none` and returns counts, cents, percentages, dates and facility names only. No resident, staff or person identifier, name, note or free text appears in any response, audit row or seed.
- Not a reuse of `ai_tool_*`, `haven-ai-router`, exec-kpi functions or `haven.*` helpers. See section 8.

## 2. Shape

Everything lives in schema `officer`. No client role holds any privilege on the schema, its tables or its functions. RLS is enabled on every table with no policies; default privileges are revoked. PostgREST exposes only `public` and `graphql_public`, so `officer.*` is unreachable from the Data API by construction.

| Object | Purpose |
|---|---|
| `officer.federated_officers` | Registry of officer seats, keyed by the Front Office `user_profiles.id`. Carries `organization_id` (Haven adds this column to the contract shape): the **only** scope any read uses. `is_active`, `valid_from`, `valid_until`, `email`, `officer_role` are re-checked on every call. |
| `officer.gateway_keys` | One row per calling system key. `enabled` is the soft kill switch. `secret_env` names the Edge secret; the value is never in the database. `allowed_capabilities` is the per-key allowlist. |
| `officer.request_nonces` | Replay guard, `(key_id, nonce)` unique, inserted in the same transaction as the work, pruned after 15 minutes. |
| `officer.capabilities` | The published catalog (section 3). `phi_class` is constrained to `none`. |
| `officer.command_receipts` | Command idempotency by `(key_id, intent_id)` with the request hash and the stored result. Append-only. |
| `officer.audit_events` | Append-only (trigger raises on update or delete). One row per accepted call, written **before** the work in the same transaction, and one row per refusal written afterwards by the Edge Function. Carries capability name, version, hashes, nonce, outcome and error code. Never names, figures or parameter values. |
| `officer.facility_coverage` | Operator-maintained honesty table: `live`, `demo` or `none` per facility. Seeded Homewood = live, the other four = demo. Every read labels each `by_facility` row with its coverage and appends the fixed qualifier "Figures for facilities marked demo come from seeded demonstration data, not operations." whenever a demo facility is covered. |

Four doors in `public`, all `SECURITY DEFINER`, `search_path = ''`, executable by `service_role` only:

| Door | Called by | Does |
|---|---|---|
| `officer_key_secret_env(p_key_id)` | Edge Function, before signature verification | Returns the Edge secret **name** and `enabled` for a key, or null. |
| `officer_catalog(p_key_id)` | Edge Function, `op = catalog` | Enabled capabilities the key may invoke, in the contract's catalog document. Refuses a disabled or unknown key with `key_disabled`. |
| `officer_execute(...)` | Edge Function, `op = execute` | The checks of contract section 2.6 in order, then the audit row, then the dispatch. |
| `officer_record_refusal(...)` | Edge Function, after a refusal | Writes the refusal audit row that the rolled-back `officer_execute` could not keep. Accepts only published codes; only called once the signature verified. |

Check order inside `officer_execute`: key enabled and allowed for the capability; per-key advisory lock (`pg_advisory_xact_lock(hashtextextended(...))`, the 336 pattern); rate limits (three windows, below); clock skew 60 s; nonce insert (duplicate is `23505 replayed_request`); officer registered, email matches, role matches (`principal_unknown`), active and inside the validity window (`principal_inactive`); capability enabled (`capability_denied`) and version current (`version_conflict`); role allowed (`capability_denied`); assurance (`assurance_required`); args exact key set (`{}` for every v1 read; `invalid_args` otherwise); `catalog_hash` well formed; for commands, `intent.intent_id` present and idempotency (same intent + same request hash replays the stored result with `replayed: true`; different hash is `22023 idempotency_key_reused`). Then the audit row, then `CASE p_capability WHEN ... END`.

**Rate limits.** Three independent windows over `officer.audit_events`, all answering `429 rate_limited`, which is never recorded, so no window feeds itself:

| Window | Counts | Limit | Why |
|---|---|---|---|
| successful work per key | rows with `outcome in ('ok','replayed')` for the key in the last minute | 60 | bounds legitimate load; recorded refusals do not count here, so a caller holding the secret cannot starve the five officers by generating refusals |
| refusals per key | rows with `outcome = 'refused'` for the key in the last minute | 120 | bounds free guesses at officer refs and capability names; when exceeded the call is `rate_limited` without touching the success budget |
| any outcome per officer ref | rows with that `officer_ref` in the last minute, across keys | 30 | one compromised or looping seat cannot starve the other four |

`officer_record_refusal` is the only writer of refusal rows. It writes nothing unless the key id exists in `officer.gateway_keys` (enabled or not), the code is in the published set, and the Edge Function has verified the signature (`rate_limited` is never passed to it). The key-existence check lives inside the function, not only in the Edge Function, and the replay probe proves it.

Refusals raise with the published code as the message. SQLSTATE selects the HTTP status in the Edge Function: `42501` to 403, `22023` to 400, `23505` to 409, `P0409` to 409, `P0401` to 401, `P0429` to 429; anything else is `503 target_unavailable`. `40001` is retried once.

**Grant durability.** Migration `308_revoke_anon_security_definer_rpc_execute.sql` is an idempotent sweep that grants every public SECURITY DEFINER function it does not recognise to `authenticated`. If 308 is ever re-run, the four doors must be added to its service-role-only list first. `supabase/tests/review_officer_catalog.sql` is the tripwire and runs in every replay. `CREATE OR REPLACE FUNCTION` resets EXECUTE to PUBLIC, so the REVOKE/GRANT block at the end of 339 must run again after any future redefinition.

## 3. The catalog (`catalog_version` `2026-09-11.2`)

All reads: `kind = read`, `version 1`, `params = []`, `allowed_officer_roles = owner, ceo, cfo, coo, ctdo`, `assurance = session`, `phi_class = none`. Every read is organization-wide for the officer's registered organization (COL, `00000000-0000-0000-0000-000000000001`) over facilities with `deleted_at is null`, and returns `data.facilities_covered` and `data.by_facility` (`[{facility, coverage, value, ...}]`, facility name as the only label, at most 50 rows). `as_of = generated_at = now()`, `freshness.state = current`.

| Capability | Value and unit | Exact predicate (fixed SQL, copied from the cited source) | Validity rules | Qualifier shown under the answer |
|---|---|---|---|---|
| `occupied_beds` | count, `beds` | `residents` where `organization_id = scope`, `deleted_at is null`, `status in ('active','hospital_hold','loa')` (exec-kpi-metrics.ts:318-323; `haven.vw_v2_facility_rollup` 211:36-45). Per facility: the same over non-deleted facilities. | Counts may be zero; zero is a valid 0. | Counts residents whose status is active, hospital hold or leave of absence and who are not deleted, at the time of the read. Residents on hospital hold or leave keep their bed and are counted. |
| `licensed_capacity` | sum, `beds` | `sum(facilities.total_licensed_beds)` where `organization_id = scope`, `deleted_at is null`. `data.occupancy_percent = round(occupied_beds / capacity * 100, 1)` when capacity > 0 (exec-kpi-metrics.ts:489-499); when the licensed total is zero (the column is NOT NULL, a null sum is handled the same way) the key is present as JSON `null` and a qualifier says the percent cannot be computed, so an unknown never reads as an absent figure. `data.occupied_beds` repeats the census. `missing.count` = facilities with zero or null licensed beds. | No facilities gives `no_data`. | Sum of licensed beds across the organization's facilities that are not deleted. Occupancy percent divides occupied beds (active, hospital hold or leave residents) by this figure. |
| `open_ar_balance` | sum, `cents` | `sum(invoices.balance_due)` where `organization_id = scope` and **`deleted_at IS NULL AND voided_at IS NULL AND balance_due > 0 AND status NOT IN ('draft','void','written_off','paid')`**. Drafts never count. Aged by `due_date` against the UTC date into `data.aging_current_cents` (not yet past due), `aging_1_30_cents`, `aging_31_60_cents`, `aging_61_90_cents`, `aging_90_plus_cents`, plus `data.oldest_past_due_days` and `data.invoice_count`. Bucket SQL adapted from `ai_tool_ar_aging_by_facility` (234:721-742), which ages by `invoice_date`. | `no_data` when the organization has no non-deleted invoice rows at all. Invoices on file with no open balance is a valid 0. | (1) Sum of invoice balance_due, in cents, over invoices where deleted_at IS NULL AND voided_at IS NULL AND balance_due > 0 AND status NOT IN (draft, void, written_off, paid). Draft invoices never count. Aging buckets are by due date against today. (2) The billing AR aging materialized view and the executive KPI dashboard use different predicates (the view excludes draft and void by status only and keeps zero balances; the KPI applies no status filter), so those three figures will not agree. |
| `billed_revenue_mtd` | sum, `cents` | `sum(invoices.total)` where `organization_id = scope`, `deleted_at is null`, `voided_at is null`, `status in ('sent','paid','partial','overdue')`, `invoice_date` from the first of the current UTC month through today (exec-kpi-metrics.ts:333-341). `data.period_start`, `data.period_end`, `data.invoice_count`. The seeded `rev_mtd` metric definition (151) cites a column that does not exist and is ignored. | `no_data` when no non-deleted invoice rows at all are dated inside the period; rows in the period but none with a qualifying status is a valid 0. | Sum of invoice totals, in cents, for invoices dated <month start> through <today> with status sent, paid, partial or overdue, excluding deleted and voided invoices. Drafts are not counted. Same definition as the executive KPI dashboard. |
| `incidents_last_30_days` | count, `incidents` | `incidents` where `organization_id = scope`, `deleted_at is null`, `occurred_at >= (UTC today - 29 days) 00:00Z` and `< (UTC today + 1) 00:00Z` (exec-kpi-metrics.ts:350-357). `data.window_days = 30`. | Zero is a valid 0. | Counts incident reports whose occurrence time falls in the last 30 UTC days including today, excluding deleted reports. All severities and statuses are included. |
| `staff_certifications_expiring_30_days` | count, `certifications` | `staff_certifications` where `organization_id = scope`, `deleted_at is null`, `status = 'active'`, `expiration_date between UTC today and UTC today + 30` (exec-kpi-metrics.ts workforce predicate). `data.window_days = 30`. | Zero is a valid 0. | Counts staff certifications with status active and an expiration date between today and 30 days from today, excluding deleted records. Certifications already expired are not counted. |

Haven has three AR readers that disagree: the executive KPI (`balance_due > 0`, not voided, any status, so drafts inflate it), the billing materialized view `ar_aging_facility_daily` (060: `status not in ('void','draft')`, keeps zero balances, ignores `voided_at`, aged by `due_date`, refreshed manually) and `ai_tool_ar_aging_by_facility` (234: excludes paid/void/written_off, aged by `invoice_date`). The catalog publishes the predicate above, names it in the qualifier, and a new meaning is a new capability version plus a `catalog_version` bump.

Read envelope, exactly the contract's key set: `ok, kind, capability, version, generated_at, as_of, freshness, validity, value, unit, qualifiers, data, missing, audit_id`. `value` is a number only when `validity = valid`, otherwise `null`. `data` holds numbers, strings of at most 80 characters and the `by_facility` array (at most 50 rows, at most 8 scalar fields each; a field may be JSON `null` for an unsourced figure, which the amended contract admits).

The one command:

| Capability | Kind | Details |
|---|---|---|
| `command_ping` | command, `assurance session`, `requires_confirmation true`, `reversible true`, `params []` | `effects = ["Synthetic. Proves the confirm step; changes nothing in the business."]`, `verb_phrase = "record the test note in Circle of Life"`. Writes only `officer.command_receipts` (plus the audit row). Touches no domain table. Returns `{ok, kind: command, capability, version, receipt: {intent_id, replayed, executed_at, audit_id}, result: {pong: true, server_time}}`. |

Synonyms seeded for the router: census, heads in beds, occupancy, occupied beds, resident count; capacity, licensed beds, occupancy rate, occupancy percent, how full; AR, accounts receivable, receivables, outstanding invoices, open invoices, unpaid invoices, balance due, money owed, aging, past due; revenue, billed revenue, invoiced, billing this month, month to date, MTD revenue; incidents, incident reports, falls, safety incidents; expiring certifications, certs expiring, staff credentials, training expirations; ping, test note, connection test.

## 4. The Edge Function

`supabase/functions/officer-catalog/` (`index.ts` is a thin `Deno.serve`; `handler.ts` is the pipeline). Tests: `supabase/functions/officer-catalog-handler.test.ts` (pipeline) and `supabase/functions/officer-catalog/signature.test.ts` (signing vector derived at test time from a runtime-built low-entropy secret; nothing high-entropy is committed). `supabase/config.toml` sets `verify_jwt = false` for it. It is self-contained: no supabase-js, no `_shared/current-actor` (there is no user session on this path), no CORS import; the only import is `_shared/structured-log.ts`, and log lines carry `op`, status, error code and milliseconds only, never args or figures.

Pipeline, in order:

1. `POST` only (`405`), `content-type: application/json` (`415`).
2. Headers `x-fo-key-id` (`^[a-zA-Z0-9_-]{1,64}$`), `x-fo-sent-at` (ten digits), `x-fo-nonce` (UUID v4), `x-fo-signature` (64 hex). Anything else is `401 invalid_authentication` before any database call.
3. `|now - sent-at| <= 60 s`, else `401 expired_request`.
4. Raw body read with a streaming bound of 64 KiB (`413 invalid_size`).
5. `officer_key_secret_env(key id)`; the returned name must match `^OFFICER_GATEWAY_HMAC_[A-Z0-9_]{1,64}$`; the value is read with `Deno.env.get(name)` and must be at least 32 bytes. Unknown key, missing secret or short secret are all `401 invalid_authentication`.
6. HMAC-SHA256 over `front-office-capability-v1\nhaven\nPOST\n<key id>\n<sent-at>\n<nonce>\n` + raw bytes, verified with WebCrypto (constant time). A request signed for `cornerstone` fails here.
7. Only now: `key_disabled` if the key is off (audited), then JSON parse (`400 invalid_json`), envelope shape (`400 invalid_contract`; args shape `400 invalid_args`), dispatch to `officer_catalog` or `officer_execute` through PostgREST with the project service role (`p_intent` is sent only for commands).
8. Responses: the database document on `200`; `{"error": "<published code>"}` otherwise. No database message, header, payload or secret ever appears in a response or log.

Rate limit is enforced in the database (60 per key per minute), not with the in-memory `_shared/rate-limit.ts`, so it survives cold starts and counts across instances.

## 5. Tests

- `supabase/tests/review_officer_catalog.sql` runs after every migration in both replay paths (`npm run migrations:verify:pg`: Docker in CI, native locally) and rolls back. It asserts: seven tables with RLS and no client privilege; `anon`/`authenticated` cannot execute either door or the two helpers and `service_role` cannot read the tables directly (the 308 tripwire); `haven.stand_up_command` grants unchanged; registry empty, key disabled and coverage seeded at ship; catalog shape, the AR meaning naming its predicate, allowlist filtering; every refusal code in contract order (`key_disabled`, `principal_unknown`, `principal_inactive`, `capability_denied`, `version_conflict`, `invalid_args`, `expired_request`, `assurance_required`, `replayed_request`, `rate_limited`); refusals leave no audit row and no nonce; `occupied_beds` (2+1 fixture with a discharged, a deleted and a cross-organization resident excluded), exact envelope key set, no forbidden key, no person string, coverage labels and the demo qualifier present only when a demo facility is covered; `licensed_capacity` with `occupancy_percent`; `open_ar_balance` `no_data` without invoices, then 11000 cents from a sent, an overdue and a partial invoice while **a draft carrying a 2345 balance**, a voided, a paid and a written-off row are excluded, buckets 300 / 700 / 10000 / 0 / 0 and oldest 45 days, then a valid 0 once everything is paid; `billed_revenue_mtd` `no_data` without invoices then 20000 cents from the same rows with draft, voided and written-off excluded and the period bounds; incidents and certifications inside and outside their windows; ping writes one receipt and one audit row, replays with `replayed: true`, refuses a different request hash under the same intent; audit and receipts immutable; refusal recording accepts only published codes and only registered keys; the three rate-limit windows, including that 60 recorded refusals do not block the next legitimate call, 120 refusals close only that key, 60 successes close that key, and 30 rows for one officer ref block that seat while another seat keeps working; zero licensed beds report an unknown percent; nonce pruning.
- `supabase/functions/officer-catalog-handler.test.ts` (Deno): every gate before the database, malformed key id / sent-at / nonce / signature rejected before any secret lookup or signing bytes exist, unsigned or badly signed requests (missing signature, wrong secret, signed for `cornerstone`, tampered body) write nothing anywhere while a valid signature passes, streaming size bound, disabled key audited only after verification, parse-after-verify, exact RPC parameters, every database refusal mapped to its published code with nothing else in the body, `40001` retried once, transport failures published as `target_unavailable`. CI runs both Deno suites on every push and pull request in `.github/workflows/ci-gates.yml` (step "Officer catalog Edge Function tests", not gated behind `HAVEN_UI_GATES_ENABLED`).
- `supabase/functions/officer-catalog/signature.test.ts` (Deno): signing-bytes layout, independent HMAC agreement, every field binds, cross-target mismatch.

Run locally without Docker:

```
# one-time: a run-owned scratch cluster (PostgreSQL 17 from Homebrew, unix socket only)
RUN=~/.hermes/tmp/agent-runs/<run-id>/haven-pg   # must contain manifest.json with created_by "codex" and run_id "haven-pg"
initdb -D $RUN/pgdata -U postgres --auth=trust
pg_ctl -D $RUN/pgdata -o "-k $RUN -p 55440 -h ''" -l $RUN/logs/postgres.log start

PG_VERIFY_NATIVE_SOCKET=$RUN PG_VERIFY_NATIVE_BIN=/opt/homebrew/opt/postgresql@17/bin \
PG_VERIFY_NATIVE_PORT=55440 REQUIRE_PG_VERIFY=1 npm run migrations:verify:pg

cd supabase/functions && deno test --allow-env --allow-net=example.invalid officer-catalog-handler.test.ts officer-catalog/signature.test.ts
```

The same three variables make `npm run segment:gates -- --segment officer-catalog-v1` replay natively; the gate artifact lands in `test-results/agent-gates/`.

## 6. Operator procedure (hosted)

Nothing here is done by Front Office or by CI. Each step is a reviewed statement run by the Haven operator against project `manfqmasfqppukpobpld`. Order: private backup and PITR point, migration, registry rows, secret, deploy, enable key.

### 6.1 Apply the migration

Through the normal linked-CLI release path used for every Haven release, after `supabase migration list --linked` confirms `338` is applied. Then `npm run migrations:verify:remote` probes the `officer_catalog` door (row `migration: "339"` in `scripts/verify-remote-schema.mjs`; an unknown key raising `key_disabled` proves the door exists and refuses).

### 6.2 Insert the registry rows (five seats, one per officer)

Template: `scripts/officer/register-officers.example.sql` (placeholders only; the filled copy never enters git). Front Office profile ids come from Front Office `public.user_profiles.id`; emails must equal the officer's Front Office session email; the COL organization id is `00000000-0000-0000-0000-000000000001`, confirmed with `select id, name from public.organizations where deleted_at is null`. Rows are inserted inactive and activated one at a time when the owner of Haven says so. Revoking a seat is `set is_active = false, valid_until = now()`; rows are never deleted because audit rows join to them.

### 6.3 Set the secret from a file

Generate at least 32 random bytes, hand the same value to Front Office as `FRONT_OFFICE_TARGET_HMAC_HAVEN`, and set it in Haven's Edge secrets from a file so it never appears in shell history:

```
umask 077
openssl rand -hex 32 > /tmp/officer-gateway-hmac-front-office-v1
printf 'OFFICER_GATEWAY_HMAC_FRONT_OFFICE_V1=%s\n' "$(cat /tmp/officer-gateway-hmac-front-office-v1)" > /tmp/officer-gateway.env
supabase secrets set --project-ref manfqmasfqppukpobpld --env-file /tmp/officer-gateway.env
supabase secrets list --project-ref manfqmasfqppukpobpld | grep OFFICER_GATEWAY_HMAC_FRONT_OFFICE_V1
rm -P /tmp/officer-gateway.env /tmp/officer-gateway-hmac-front-office-v1
```

### 6.4 Deploy the function

`.github/workflows/edge-functions-deploy.yml` deploys any changed directory under `supabase/functions/` with an `index.ts` on push to `main`, and the new `[functions."officer-catalog"]` block in `config.toml` also selects it. Merging this branch deploys `officer-catalog`; the pull request shows the deploy-preview comment. Manual equivalent, only if needed: `supabase functions deploy officer-catalog --project-ref manfqmasfqppukpobpld`.

### 6.5 Enable the key (the last step)

```sql
update officer.gateway_keys set enabled = true where key_id = 'front_office_v1';
```

Verify from Front Office: a signed `{"op":"catalog"}` returns 200 with seven capabilities; `command_ping` returns a receipt visible in `officer.audit_events` and `officer.command_receipts`; a deactivated seat is refused with `principal_inactive`; `open_ar_balance` answers with the demo qualifier while the four demo facilities are covered.

### 6.6 Kill switches

- Soft (keeps grants): `update officer.gateway_keys set enabled = false where key_id = 'front_office_v1';` The Edge Function still verifies the signature (so an attacker cannot probe the flag), then answers `403 key_disabled` and writes a refusal audit row.
- Hard (revokes the doors from `service_role`, keeps every row): `scripts/officer/disable-officer-catalog.sql`. The Edge Function then answers `503 target_unavailable`. Reactivation restores only the four grants.
- Per seat: section 6.2 revoke. Per capability: `update officer.capabilities set enabled = false where name = '<name>'`, or remove the name from `allowed_capabilities`. Per facility honesty: `update officer.facility_coverage set coverage = '<live|demo|none>' where facility_id = '<id>'`.

### 6.7 Rotation

Rotation is a new key, not a new value under the old name, so Front Office and Haven never have to switch at the same instant:

1. `insert into officer.gateway_keys (key_id, secret_env, enabled, allowed_capabilities) select 'front_office_v2', 'OFFICER_GATEWAY_HMAC_FRONT_OFFICE_V2', false, allowed_capabilities from officer.gateway_keys where key_id = 'front_office_v1';`
2. Set `OFFICER_GATEWAY_HMAC_FRONT_OFFICE_V2` as in 6.3; enable `front_office_v2`.
3. Front Office switches `FRONT_OFFICE_TARGET_HAVEN_KEY_ID` and `FRONT_OFFICE_TARGET_HMAC_HAVEN`.
4. Disable `front_office_v1`; after a quiet week, `supabase secrets unset OFFICER_GATEWAY_HMAC_FRONT_OFFICE_V1`.

### 6.8 Reading the audit

```sql
select a.occurred_at, a.outcome, a.error_code, a.capability, a.capability_version, o.officer_role, a.intent_id
from officer.audit_events a left join officer.federated_officers o on o.front_office_profile_id = a.officer_ref
order by a.occurred_at desc limit 100;
```

The Front Office audit row for the same call carries the same nonce.

## 7. Deviations from the contract, with reasons

- `officer.federated_officers.organization_id` is added (not in the contract's column list). Haven is multi-organization by schema even though COL is one organization; every read must be scoped by something Haven owns, and the envelope is never allowed to be that thing.
- `officer.facility_coverage` is an extra table. Only Homewood carries live records; without it the catalog would present seeded demonstration figures as operations.
- `public.officer_key_secret_env` and `public.officer_record_refusal` are two extra service-role-only doors (the second is now an accepted pattern in the contract). The first exists because the Edge Function holds the secret by name only and the name lives in the key row. The second exists because a refusal raised inside `officer_execute` rolls its own audit row back. `rate_limited` is not recorded, so a flood cannot lock the key out through its own refusals.
- `catalog_stale` (412) is withdrawn from the contract and never raised; `catalog_hash` is shape-validated and the capability version is pinned.
- Reads take no parameters although the contract's example shows `args: {facility: "all"}`. Every read answers organization-wide with `data.by_facility`, so a facility question is answered from the breakdown without a free-text parameter ever reaching Haven.
- `officer.command_receipts` is also append-only (the contract requires this only of `audit_events`).
- Refusal SQLSTATEs `P0401` (expired) and `P0429` (rate limited) are Haven's choice; the contract names only `42501`, `22023`, `23505`, `P0409`. The Edge Function maps by the published message first, so the SQLSTATE is a fallback.
- PostgREST reproduces a JSON `null` as a jsonb null for a jsonb parameter; `officer_execute` normalizes that to SQL NULL and the Edge Function omits `p_intent` for reads.

## 8. Why nothing from `ai_tool_*`, `haven-ai-router`, exec-kpi or `haven.*` is reused

- `public.ai_tool_*` functions (migration `234`) take `p_caller_organization_id`, `p_caller_role` and `p_caller_facility_ids` as parameters and check membership only against those arrays. An adapter that filled them from a Front Office envelope would let the envelope choose the scope: any facility, any resident, under whatever role string the caller supplied. That is the SYS-001D finding again. The officer schema resolves organization from its own registry row and never reads scope from the request.
- `haven.*` helpers (`haven.accessible_facility_ids()`, `haven.has_facility_access()`, `haven.stand_up_assert()`) read `auth.uid()` or the current authorized actor, which is NULL under the service role on this path. Calling them would either refuse everything or, worse, treat owner/org_admin as organization-wide scope.
- `exec-kpi-metrics.ts` and `exec-kpi-snapshot` are Deno code run by a cron with a service-role client; their predicates are copied into `officer.read_*` as fixed SQL and cited per read so the numbers agree with the executive dashboard without sharing the code path. The one deliberate departure is AR, where the executive predicate counts drafts and this catalog does not.
- `haven-ai-router` pushes raw tool JSON into model turns and runs under service role with request-derived context. The catalog path has no model turn on Haven's side, returns fixed aggregate shapes, and has no user session to derive context from.
