# Finance and audit architecture

Design contract, with implementation status tracked by acceptance ID. This document does not claim every component exists.

Haven retains operational detail, source versions and resident-money evidence. The verified external accounting company owns official books. Mirror and native journal totals must never be added as independent economic activity. One event has one posting owner and one active aggregate membership. Entity IDs and company connection generations bind all mappings; facility names cannot supply identity.

## Monetary and privacy boundary

`src/lib/finance-integration/payload.ts` provides strict summary validation and exact decimal conversion. JSON monetary values are canonical integer-cent strings; checked bigint arithmetic has a symmetric maximum magnitude of 9,223,372,036,854,775,807 cents, within PostgreSQL bigint. Existing source integer columns retain their existing limits until specifically migrated. No Number coercion at accumulator/provider boundaries. Currency conversion is unsupported; USD is the synthetic fixture contract, pending verified entity policy.

The current structural schema accepts numeric provider references, generated batch UUID, valid accounting date, USD and balanced debit/credit amounts. It rejects unknown fields recursively. Resident membership and source crosswalk never enter this payload. Structural validation cannot establish de-identification or suitability of a company/account reference. Approved aggregation policy, account mapping and current dispatch authority remain separate gates; production outbound is disabled.

## Transaction contracts

F01 repairs payment/allocation and source journals inside single database transactions. Authoritative business receipts persist with mutations or everything rolls back. Public RPCs remain invoker boundaries; privileged implementations live in the private Haven schema and revalidate current authorization. Existing current-actor/session/claim-version helpers are reused. SQL guards protect alternate mutation paths, posted history and closed periods.

F03 extends those boundaries with immutable source financial events, outbox commands and exact member-set approval. No network action runs inside a source transaction. Commands and attempts have distinct identities. Provider uncertainty becomes OUTCOME_UNKNOWN and prevents blind retry. Dispatch requires approved payload/member hash, current mapping/policy/connection generation, current authority, open period, stop controls clear and verified independently recoverable evidence acknowledgment.

## Evidence and recovery

F01 audit exports must bind current scope at creation, processing and readback, materialize a complete stable snapshot and retain count/hash/schema/range evidence. A financial auditor has no implied clinical chart rights. Database snapshots are durable operational evidence, not independent privileged-tamper anchoring or pre-restore recovery storage. F09/F11 must implement/test separate anchors, protected attachment versions, legal holds, missing segment detection, recoverable metadata/keys and recovery before source creation.

Restore starts outbound paused. Recover source versions, immutable membership, mapping/policy, approvals, payload, command identity and provider receipts from independently durable evidence. Reconcile external effects before resuming. Restoring Haven cannot undo provider transactions. Never replay historical invoices as rollback.

## Thin vertical scenario

Synthetic two-org/three-entity setup includes two facilities within one entity. An eligible current-period charge creates local immutable event plus outbox intent. An approved non-identifying aggregate balances independently calculated AR/revenue totals. Independent approver binds payload/member/mapping hashes. A recovery acknowledgment precedes release. A selected-provider controlled test returns a receipt; read-only mirror and reconciliation prove exactly one economic effect. A simulated receipt exercises the local contract only. Repeat with a timeout after commit, revoked approver authority, closed period, mismatched company and restore before source creation. No opening AR is mapped as current revenue.
