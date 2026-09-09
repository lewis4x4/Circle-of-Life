# InsureFlow receiver contract and activation boundary

This implementation is stacked on Haven insurance PR 462. It is a separate read-only agency-summary namespace. Provider source was supplied as uncommitted working-tree files from `/Users/rocky/insureflow-ops`, branch `feat/floor-v1-spine`, surrounding HEAD `0fe071965db6391cd795c3c4fb101df47522f944`. That HEAD is not an implementation commit. All package SHA256SUMS entries were verified before inspection. The retained manifest identifies exact source bytes; no provider patch was applied to Haven or the existing InsureFlow checkout.

## Controls and bodies

`validateFeedPage` checks the wrapper, schema, pinned integration, complete manifest, unique policy/release/sequence membership, event identities, order, kind and cursor relationships before any mutation. Decimal cursors remain strings through PostgreSQL bigint maximum. Invalid controls reject the whole page. A release event must be selected by its manifest; withdrawn events have null bodies and cannot be selected.

`applyFeedPage` returns one candidate state without mutating the previous state. The worker submits that entire state to the fenced database transaction. For trustworthy controls, membership replacement and redactions are applied even if a snapshot is malformed. Valid bodies remain visible only under the exact current manifest and approved account mapping. Bad bodies become safe hash/identity/reason receipts with deduplicated recovery work; raw unknown fields and offending values are discarded. The progress cursor advances only with the transaction. A failed commit leaves the old state available for retry.

The first non-null body hash is immutable, including a body rejected by the validator. Different non-null bodies for the same event create a sticky integrity conflict and hide every variant. Same-ID withdrawn/null authorization redaction is expected and retains the original hash. Identity/sequence/timestamp reuse is a control error. Hashing uses sorted object keys, preserves array order, and does not depend on wire key ordering.

Snapshot schema 1 has exactly eleven provider fields. Money stays the source JSON number, including negative/fractional values; no currency, period, cents conversion, totals or billing interpretation is added. Source status and line are free text. Dates must be real calendar dates; date order is not inferred. Local string safeguards cap each text field at 4,096 UTF16 code units and reject NUL/unpaired surrogates because PostgreSQL cannot store them. No truncation/coercion occurs. Snapshot validation failures quarantine the body.

## Recovery and publication

Every accepted normal or replay page replaces the entire current membership manifest. Removed/superseded bodies are discarded while safe receipts remain. Returning authorization for an earlier release queues replay from zero with a separate replay cursor. Replay never rewinds the normal cursor. Recovered bodies carry a confirmation gate; a fresh accepted normal-cursor manifest must still select them before they can be displayed. At most three recovery passes are attempted per unresolved recovery episode. Once an episode is resolved, a later scope return starts a new retry budget; successful recovery does not permanently exhaust a release. Exhausted work remains degraded and requires investigation; no automatic mutation of an immutable provider release is attempted.

If the provider data is wrong, correct source data and approve a new release. If the Haven validator was wrong, update it and explicitly reset exhausted recovery for the unchanged authorized release in a reviewed maintenance change. Integrity conflicts cannot be cleared by ordinary replay. Authorization freshness and body completeness are distinct. A valid manifest with unresolved bodies reports degraded completeness; it is not a healthy import.

Per-connection leases, revisions and configuration generations fence success and failure writes. A delayed401 from a prior configuration cannot disable its replacement. A current401 disables visibility. Other failures preserve the previous manifest/cursor and cannot extend authorization freshness. Reader checks enforce current entity mapping, current authorized manager, enabled synthetic connection, explicit freshness cutoff, selected receipt identity, quarantine/conflict and replay confirmation at query time.

## Local-only activation

There is no live scheduler endpoint or credential setup UI. Transport requires an injected fetch, synthetic mode, test runtime and an HTTPS `.invalid` origin. There is no global fetch fallback. The provider path is fixed; only after/limit parameters are emitted, no redirects followed, no browser credentials or persistent response cache. The local response cap is 3 MiB (above the provider SQL 2 MB guard to accommodate envelope/UTF8 overhead); timeout covers transport and stream. These are receiver safeguards, not provider SLA claims.

The database stores synthetic connections only, with explicit TTL and account-to-one-Haven-entity mappings. No default live reader grant, TTL, entity mapping or retention approval is invented. No provider secrets are stored in the projection. The imported namespace is excluded from core policies, financials, renewals, claims, document ingestion, AI, global search, exports and offline data.

Live activation still needs: safe staging origin and credential provisioning; namespace/integration identity; approved account/entity crosswalk; reader permission decision; authorization freshness/withdrawal timing; retention/removal policy; provider deployment and gateway verification; reviewed live-use approvals. No real policy data or hosted migration was used by this implementation.

Configuration approval history is immutable: create/configure audits retain the exact provider identity, explicit account/entity mappings, enabled flag and TTL with actor/revision/generation. They contain no policy body or provider secret. A post-validation lease check prevents an operation that outlives its lease from committing.
