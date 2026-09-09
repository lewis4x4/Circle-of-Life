# F03 accounting review workbench

This read-only view helps authorized operators find captured source events, local batch reviews and declared rule versions. It does not finish F03, establish verified accounting treatment, provide an immutable export or enable external posting.

The application routes are `/admin/finance/integration` and its canonical `/finance/integration` implementation. Finance navigation includes Accounting review. Existing owner/org-admin/facility-admin authority applies; no new identity or role is granted. A restricted facility administrator must use an explicitly authorized facility. Entity and facility records are loaded through caller RLS.

## Read contract

Migration341 exposes `finance_review_queue(p_entity, p_facility, p_kind, p_after_created_at, p_after_id, p_limit)`. The public function is an invoker facade over a private implementation that rechecks current actor/session/entity/facility authority. Direct application/service access to batch tables remains denied. Page size is1–100; kind is events, batches or rules. A cursor must contain both a finite timestamp and UUID, or neither. It is an ordering boundary, never an authorization capability.

Rows use descending creation time and UUID keyset ordering, preserving PostgreSQL microseconds. Each response includes its actual organization/entity/facility, kind, observation timestamp, exact string total count, returned count, next cursor and more-results indicator. Data reads share the function's statement snapshot; live authority deadlines are evaluated by the current authorization helpers. The client rejects wrong scopes, invalid cardinality, unordered/duplicate rows, invalid cursors, lost timestamp precision, unexpected states and enabled release flags.

**Responses are live pages.** Later pages and refreshed pages can change as transactions commit or authority changes. Traversing pages is not an immutable export or evidence snapshot. Use the separate audit materialization/approved evidence workflows for reproducible exports; this endpoint must not be advertised as that workflow.

Source events remain visible whether claimed or unclaimed. A claim's batch ID is omitted when that batch is outside the requested facility or the caller's scope; claim existence remains visible so the source is not incorrectly offered as unclaimed. Rejection/supersession changes current claims while preserving historical membership. Batch rows derive current invalidity instead of trusting an old stored approval status. Rule versions are declared drafts, not provider or accountant approval.

Coverage is explicitly limited to migration336 payment, invoice-post, manual-post and reversal receipts captured by339. Counts of eligible receipts without events expose missing coverage within that limited set. Earlier records, uncaptured sources, AP/payroll/trust activity and external books are not represented as a complete portfolio by this view. Active entity/facility access follows339; broader historical audit and cutover workflows remain separate.

## UI boundaries

The workbench has no prepare, approve, release, payroll or payment controls. Batch detail uses the separately authorized340 snapshot. Only selected fields enter UI state; historical session IDs and unneeded internal columns are stripped. Exact cents remain decimal strings and use integer formatting. UTC timestamps display in Eastern time; cursor precision is retained separately.

Identity/session, organization, entity, facility, record kind, page and unmount transitions invalidate requests and hide previous-scope content before new responses arrive. A transport that ignores abort still cannot display an obsolete response. Error, loading and genuine empty states are distinct. Selector keysets continue until an empty page and reject nonadvancing/wrong-scope results rather than assuming a configured REST cap equals completeness.

The disabled release/posting declarations are valid because339/340 structurally prohibit dispatch and business release. A future activation migration must update these API/runtime assertions in the same reviewed release. This view is not a live provider-connection health check.

## Evidence limits

Independent native verification passed100 SQL assertions, traversed2509 events in26 pages (2505 equal-timestamp rows) without missing/duplicate rows, and exercised actual SQL responses against the typed client. This uses native Auth adaptations and is not real PostgREST-cap execution. See `test-results/finance-integration/f03-workbench/verification.json`.

Component/transport/route-entry tests and synthetic browser fixture evidence are tracked separately from authenticated application routes. The local shared Docker/Auth blocker remains; fixture visuals and mocked journeys do not close hosted, provider, business, full F03 or full F10 acceptance.
