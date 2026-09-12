# F03 receipt event and outbound staging contract

This segment implements durable local staging. It does not complete F03, establish an approved accounting mapping, enable network dispatch, or establish provider acceptance. Source authorizations and migration targets remain subject to the release contract.

## Transaction and origin

Migration `339_finance_event_outbox.sql` attaches `finance_receipt_stage` to the immutable `finance_command_receipts` introduced by migration336. The original source mutation, allocation or journal, receipt, source event, and outbound intent commit in one PostgreSQL transaction. Failure to insert the event or intent aborts the originating financial command. No network operation occurs in that transaction.

| Authoritative receipt | Event operation | Amount control | Outbound staging |
|---|---|---|---|
| `payment` | `payment_received` | Gross recorded payment cents, including any unapplied portion | One intent for that receipt; later policy must classify allocated and unapplied amounts correctly |
| `invoice_post` | `invoice_posted` | Invoice gross cents | One intent; opening/unclassified invoices remain blocked by336 |
| `manual_post` | `manual_journal_posted` | Sum of posted native journal debit cents | One intent for accountant/policy review |
| `reversal` | `journal_reversed` | Sum of reversing journal debit cents | One distinct correction intent linked through the original receipt/journal provenance |
| `payment_post` | None | Already represented by `payment` | Excluded to prevent a second representation of the same received cash |
| `payment_cancelled` | None | No money was recorded | Receipt/tombstone retained; no financial outbound intent |

Unknown receipt command types fail closed until their economic origin is explicitly implemented. Drafts do not create these receipts or events. Resident-money, AP, payroll, provider mirror and other sources outside336 are not automatically covered by this trigger; their reviewed source commands and ownership mappings remain open work.

These amounts are coverage control totals, not booked balances or approved provider journal lines. Totals are grouped by basis. In particular, debit totals for an original and reversing journal add as gross audit controls; they must not be interpreted as net financial position.

## Identities and immutable provenance

`finance_source_events` records organization, entity, facility, source class/ID, operation and source version. The source version is SHA-256 of the complete immutable receipt as canonical PostgreSQL JSONB text, with its creation timestamp normalized to UTC microseconds. The event has a UUID primary key generated once at insertion and a separate unique `identity_sha256` that hashes the versioned identity tuple `haven-finance-event-v1:organization:entity:source_type:source_id:source_version:operation`.

The event references the whole original receipt by its `(command_type,id)` foreign key. Resident/payer names, notes, resident membership and detailed payloads remain on the original Haven receipt and source records; the event does not duplicate them. The unique receipt and economic-origin constraints prohibit a second event for the same operation. Changed-content reuse is rejected by the authoritative336 command before an additional event can be produced.

`finance_outbound_intents.id` is a generated UUID primary key. Its separate unique `identity_sha256` hashes `haven-outbound-stage-v1:event_identity_sha256`; each event UUID has exactly one intent. These stable hashes remain provenance/deduplication identities independently of the relational UUID keys. Queue APIs accept the intent UUID. `external_payload` is constrained to NULL and `dispatch_enabled` to false. Neither field can be filled or enabled through the staging APIs. Internal receipt/source UUIDs and hashes are Haven evidence references, not an approved external payload allowlist.

All event, intent, queue command, attempt and control-receipt rows reject UPDATE/DELETE. Application and service roles have no direct INSERT privileges. Database administrators can still change DDL or disable protections; independent anchoring and recovery against privileged tampering remain F09/F11 requirements.

## Operator controls and queue

All public operator APIs are `SECURITY INVOKER` facades over private authority functions. Reads and mutations recheck the existing authoritative user/profile/session/claim-version chain. Owner/org-admin may control or queue only within their current organization/entity/facility scope. Facility administrators may read their explicit accessible facility scope but cannot queue or change entity controls.

- `finance_staging_summary(entity_id, facility_id)` returns exact decimal-string control totals, event count and `unrepresented_eligible_receipts` from one stable caller snapshot. It does not conflate missing historical coverage with complete export coverage.
- `set_finance_staging_control(request_id, entity_id, expected_generation, stopped, connection_generation_ref, capability_reference_sha256, worker_id)` records an immutable control receipt, uses optimistic generation checking and increments the staging generation on change. New entities start stopped. Replaying the same request/content returns its earlier control receipt without reapplying it; inspect the current control row for current state.
- `queue_finance_outbound(command_id, intent_id, retry_of)` freezes the current staging generation and opaque connection/capability references. It returns `staged_dispatch_disabled`, which is a local queue result, not acceptance or readiness to dispatch. The root command is unique per intent, and a retry predecessor can have one successor, so retry history forms one chain.
- A retry requires an earlier attempt recorded as blocked by disabled dispatch. A stale-generation predecessor with zero attempts can instead receive an explicit `supersede` successor, preventing a rebind before the first attempt from stranding the intent. Both operations create a new immutable command and keep the same economic intent. A current-generation command with no attempt cannot be retried, and neither path can fork the predecessor chain. There is no representation of a sent, unknown, accepted, posted or reconciled provider outcome in this segment. Those outcomes require a separately reviewed command/attempt state machine before dispatch exists.

`connection_generation_ref` and `capability_reference_sha256` are opaque declared references only. They are not verified company bindings, capability approvals, credential references or mapping approvals. The local `staging_generation` fences stop/rebind/worker changes; it must not be described as proof of a provider connection generation. Binding these references to an authoritative provider registry and approval evidence remains open.

Stopping retains all prior source events, intents, commands, attempts and control receipts. New authorized source financial commands continue to record inbound evidence while stopped. Queueing and worker observations fail while stopped. Rebinding invalidates prior queued generations; old commands remain unchanged for review.

## Worker separation

`record_finance_staging_attempt(attempt_id, command_id, worker_id)` is executable only by `service_role`, independently of human operator authority. It also requires the entity's currently registered worker UUID, active entity/facility scope, clear staging stop, and matching current generation/connection/capability references. A human JWT cannot execute this function merely by supplying a worker ID.

The worker endpoint records an idempotent, numbered attempt whose only possible outcome is `blocked_dispatch_disabled`. It exposes no source receipt contents, provider payload, success/ACK input or dispatch action. Service-role callers have no direct table access to enumerate the source events through this feature. The shared service-role credential remains a broad platform trust boundary; the registered worker UUID is not a secret or an independent worker authentication credential. Dedicated worker identity/leases, hosted credential protection and dispatch authorization remain prerequisites for an operational dispatcher.

## Migration boundary and remaining gates

The trigger captures receipts created after installation. Existing receipts are not retrospectively re-authored or attributed to a currently active user. `unrepresented_eligible_receipts` reports eligible prior receipts lacking an event. A reviewed backfill/cutover command, complete membership reconciliation and recovery evidence are required before any dispatch activation.

Still open: stable aggregation membership across multiple events; approved mapping, accounting basis and privacy policy; payload construction and allowlist enforcement; preparer/independent approver decisions and invalidation; authoritative connection/capability binding; bounded worker leases/order/retry; signed provider inbox and outside-book changes; reconciliation; external protected recovery acknowledgment; restore-before-source/provider-post recovery; provider-controlled tests; hosted Auth/PostgREST verification and business acceptance. No endpoint in339 can bypass these open gates by turning on dispatch.

## Verification

The executable regression is `supabase/tests/review_finance_event_outbox.sql`, selected by the existing `review_*.sql` replay convention. Run only in disposable test databases: it adapts Auth stubs and injects transaction failures. It covers56 assertions including atomic event/outbox rollback, content replay, economic-origin exclusions, four-billion-cent journal controls/eight-billion-cent grouped controls, immutable rows, queue/retry/control idempotency, worker authority and generation fencing, stop preserving inbound evidence, historical coverage gaps, and A/B/null/other-organization read boundaries.

Native PostgreSQL with Auth stubs is distinct from hosted Supabase Auth/PostgREST/Edge execution. SQL state and source inspection do not establish provider or release acceptance.
