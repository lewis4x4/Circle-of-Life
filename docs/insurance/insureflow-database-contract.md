# Synthetic InsureFlow receiver database contract

Migration `338_insureflow_synthetic_receiver.sql` is an isolated summary receiver, not an insurance-system write path. It never inserts or updates policies, claims, premiums, documents, search, AI, exports, or offline records. Provider withdrawals remove disclosure; they do not cancel a Haven policy.

## Persistence and authority

`insureflow_receiver_connections` holds one complete JSON `ReceiverState` per connection plus configuration, lease, revision and trusted receipt timestamps. Identity is unique by organization, explicit `synthetic:<namespace>` provider instance, and pinned source integration UUID. Another environment with the same UUID is a different connection. Mode is constrained to `synthetic`; there is no live enable value, origin, credential, or token column.

Browser and service roles have no raw table privileges or RLS policy granting raw reads. `public.insureflow_receiver_service(p_action text,p_payload jsonb)` is a service-role-only invoker wrapper around a restricted implementation. `create` and `configure` also require a server-derived current owner/org_admin actor, checked under retained Auth/profile locks after domain waits. Workers use only the service role and the explicit connection/organization/fence. Manager summaries use a separate authenticated invoker RPC and live actor revalidation after any locks.

The private immutable receiver audit records action, connection, revision, configuration generation, actor when applicable and timestamp. Create/configure also record the exact safe configuration `{provider_instance,source_integration_id,mappings,ttl_seconds,enabled}`. Previous mapping approvals remain reconstructable after remapping. Bodies, receipts, failures and unknown input values are never copied into the generic audit log or configuration audit.

## Service actions

All responses are direct connection rows for the trusted worker/configuration adapter. Raw state is never a manager-response field.

- `create {id,organization_id,actor_id,name,provider_instance,source_integration_id,ttl_seconds,enabled:false,mappings}` creates a disabled synthetic connection. `provider_instance` is lowercase `synthetic:` followed by 1–64 letters/digits/underscore/hyphen. TTL is explicit, 1–86,400 seconds; these limits support synthetic testing and do not approve a production freshness decision.
- `configure {connection_id,organization_id,actor_id,expected_revision,enabled,ttl_seconds,mappings}` compares revision, invalidates the lease, increments configuration generation/revision, clears authorization freshness and resets health to `never_synced`. Identity cannot be edited. Changing mappings additionally clears every cached snapshot, marks confirmation required, resets replay cursor and queues selected releases for fresh recovery. Immutable first hashes and conflict receipts remain.
- `claim {connection_id,organization_id,lease_token,lease_seconds}` accepts a fresh token and a 1–120 second lease only when enabled and credentials have not been rejected. New claims increment revision; use the returned revision as `expected_revision`. Repeating the same active token returns its existing lease without extending it. A different active token conflicts. Replacing an expired lease increments revision, fencing delayed callbacks even if a caller mistakenly reused a token.
- `commit {connection_id,organization_id,lease_token,config_generation,expected_revision,state}` validates and atomically replaces the entire state, including normal/replay cursors, manifest, receipts, quarantine and recovery. All four fence elements must match, the connection must remain enabled/synthetic, and expiry is checked both before and after validation. Only accepted page commits refresh authorization time: SQL assigns `clock_timestamp()` rather than trusting the worker timestamp. The lease clears and revision increments.
- `fail {...same fence,state,error_code}` commits failure bookkeeping under exactly the same fences and clears the lease. Generic transport/control failures must preserve state byte-for-byte at the JSON value level, including cursor and freshness. `http_401`/`credential_rejected` may only set health `credential_rejected` and authorization time null. They cannot change membership or bodies. Delayed failures from older leases/configurations conflict and cannot disable a replacement configuration. Credential rejection blocks new claims until explicit configure resets it.

Stale/replaced/disabled/expired leases and revisions return SQLSTATE 40001. Invalid state/configuration returns 22023; missing scoped connections return P0002. Manager authentication uses 28000, role denial 42501. SQL exceptions roll back all mutation/audit work in the statement.

## State and bounds

`ReceiverState` matches the reducer: version 1, decimal-string `cursor` and `replay_cursor`, `recovery_active`, authorization/source timestamps, manifest, receipts, recovery and health. PostgreSQL bigint progress is never represented as a JSON number. Decimal strings are canonical, nonnegative and at most 9,223,372,036,854,775,807; release sequences must be positive. Normal progress never regresses.

State is bounded to 8 MiB serialized JSON, with at most 10,000 manifest entries, receipts and recovery entries. Mappings are bounded to 1,000. Exceeding a bound rejects the complete state transaction, leaving prior cursor and membership intact. Receipts preserve validator version, event identity/sequence/time, immutable first nonnull hash, sticky conflict, safe quarantine code and confirmation flag. The SQL body whitelist is the eleven provider snapshot fields; unsupported/raw fields cannot be retained. Strings allow up to 4,096 characters, while the reducer's UTF-16 limit can be stricter for astral characters. Premium remains an informational finite JSON number, with no assumed currency, period or cents conversion.

A private `receipt_received_at` map records SQL time when the first valid nonnull snapshot for a release commits. Replay and remapping do not rewrite that provenance. It does not alter the reducer receipt schema.

## Explicit mappings and manager reads

Mappings are `[{account_id,entity_id,approved:boolean}]`: one source account maps to one explicitly selected current same-organization entity. No name matching or inferred grouping exists. Creation/configuration validate entities under locks; reads recheck entity existence and organization so later deletion immediately removes eligibility.

`public.insureflow_receiver_read('list',{connection_id?,entity_id?})` derives organization/actor from the current session. Only owner/org_admin can use this synthetic reader. Caller organization fields and raw-state actions are rejected. Response:

```text
{
  live_connection_enabled: false,
  connections: [{
    id, name, provider_instance, source_integration_id, mode: "synthetic",
    enabled, revision, state: "disabled"|"healthy"|"degraded"|"unavailable",
    last_authorization_check_at, authorization_valid_until,
    incomplete_summary_count,
    summaries: [{
      source_policy_id, release_id, source_sequence, source_released_at,
      received_at, mapped_entity_id, mapped_entity_name,
      summary: {policy_number,carrier,line_of_business,named_insured,
                effective_date,expiration_date,premium,status}
    }]
  }]
}
```

SQL reads require enabled synthetic configuration, nonrejected health, a nonfuture authorization timestamp within the explicit TTL, exact manifest-to-receipt release/policy/sequence identity, valid body, first hash, no conflict/quarantine/confirmation requirement, resolved or absent recovery work, and an approved current account mapping. Only eligible summaries are projected; raw receipts, hashes, recovery reasons and error values stay private. The freshness deadline is checked again after actor/domain waits. There is no silent result truncation.

## Executed evidence and limitations

`supabase/tests/review_insureflow_receiver.sql` runs in a rollback transaction and covers disabled/live denial, scoped mapping and environment identity, bigint precision, bounds, independent lease-token/revision/generation/expiry fences, atomic cursor/manifest/quarantine/recovery rollback and same-candidate retry, deduplicated receipts/recovery, read-time TTL, future timestamp replacement, raw-table/role denial, failed transport immutability, delayed 401 after configuration, remapping without cached-body reuse, replay confirmation, entity deletion, immutable first hash, withdrawal and credential recovery. Safe configuration audits preserve both mapping versions and reject mutation.

Reusable synthetic fixtures are in `scripts/insurance/fixtures/insureflow-receiver.sql`; callers own their disposable database and transaction. `haven.insureflow_receiver_fixture` exposes organization_id, entity_id, actor_id, session_id and claims for the local worker integration harness. Root's reducer → worker → real PostgreSQL → authenticated read scenario is separate from these SQL probes.

All evidence is local/synthetic. Live mappings, source credentials, production reader permissions, TTL/withdrawal timing, retention and staging approval remain unresolved; this migration provides no live-provider activation path.
