# F03 exact batch review and membership contract

Migration340 adds local batch preparation, independent review, invalidation and safely unsent supersession over339 immutable source events. It does not complete F03 or F05. Every batch is constrained to `accounting_classification = unverified`, `business_release_eligible = false` and `dispatch_enabled = false`. There is no recovery acknowledgment, provider acceptance, official-book binding or dispatch endpoint.

`locally_approved_dispatch_disabled` means a different authorized user reviewed the exact local artifact. It does not mean a controller accepted its accounting treatment, a privacy reviewer accepted aggregation, or a provider accepted a journal. An opaque policy hash or numeric company/account reference cannot clear these blockers.

## Records and interfaces

All six tables have RLS and explicitly deny direct application/service table access. Read current batch state through the snapshot RPC. Do not build a workbench by exposing the stored status column without deriving current validity.

| Table | Purpose |
|---|---|
| `finance_batch_rule_versions` | Immutable declared draft mapping/policy references and creator/session/version evidence |
| `finance_batch_rule_bindings` | Current per-entity draft version and monotonically increasing rules generation |
| `finance_batches` | Immutable exact payload, source controls, hashes, scope, dates, preparer and binding; controlled lifecycle status |
| `finance_batch_members` | Immutable event membership and canonical per-event contribution/source documents |
| `finance_batch_event_claims` | One current claim per event UUID; explicit rejection/supersession can release only unsent claims |
| `finance_batch_decisions` | Immutable preparation, local approval, invalidation, rejection and supersession history |

Public APIs are `SECURITY INVOKER` wrappers over private, current-authorized implementations:

```text
register_finance_batch_rules(
  p_id uuid, p_entity uuid, p_mapping jsonb,
  p_policy_sha256 text, p_expected_generation bigint
) -> jsonb

prepare_finance_batch(
  p_id uuid, p_entity uuid, p_facility uuid|null, p_date date,
  p_rules uuid, p_members jsonb, p_supersedes uuid|null = null
) -> jsonb

decide_finance_batch(
  p_id uuid, p_batch uuid, p_action approve|reject|invalidate,
  p_expected_binding text
) -> jsonb

finance_batch_snapshot(p_batch uuid) -> jsonb
```

Rules registration requires an existing current owner/org-admin. The strict mapping object has exactly these fields:

```json
{
  "companyReference": "123",
  "accountReferences": ["100", "200"],
  "accountingBasis": "accrual",
  "effectiveFrom": "2026-09-01",
  "effectiveTo": "2026-09-30"
}
```

Basis is an explicitly declared `cash` or `accrual` proposal. Both effective dates are valid canonical ISO dates, inclusive and ordered. Company/account references are decimal strings with 1–20 digits and no leading zero. Accounts are canonicalized as a sorted distinct set. The declared policy reference is SHA-256 text. All remain unverified business declarations. Rebinding a new immutable version invalidates prior active local reviews; replaying the same version ID/content/creator does not reactivate it or change the current pointer.

Preparation accepts 1–1,000 unique event UUIDs and at most20,000 contributed input lines. Each member has exactly `eventId` and `lines`; each line has exactly `accountReference`, `side` and `amountCents`. Unknown fields, including null-valued memo/filename fields, are rejected. Null side, numeric JSON amounts, exponents, leading zeros, nonpositive amounts and unlisted accounts are rejected. Batch IDs must be RFC variant UUIDv4, a conservative subset of `payload.ts` UUID validation.

Each event's debit and credit totals must both equal its339 gross control, using exact numeric accumulation within the symmetric signed64 cents bound. Final lines aggregate deterministically by account reference and side and remain within2–1,000 lines. USD is the only fixture currency. Payload amount strings retain precision beyond32-bit and JSON-safe integer limits; canonical server JSONB SHA-256 is the hash authority.

## Dates, accounting classification and exact binding

Members retain a distinct economic date. Payment/invoice/reversal dates come from immutable receipt payloads; manual-journal dates come from the protected posted journal, whose receipt alone lacks that field. No original source money row is locked while batch controls are held. This segment requires every economic date to equal the batch accounting date. Period-end aggregation, changed-period posting and other date transformations remain unsupported until a separately reviewed policy implements them. Dates serialize with explicit ISO formatting independently of PostgreSQL DateStyle/timezone.

The selected date must fall inside the declared rule window and an open accounting period. Contributions are operator proposals, not derived accounting classifications: payment gross can include unapplied funds, and a journal's gross debit control omits its account distribution. A balanced Cash/AR proposal can therefore be economically wrong. The immutable unverified/business-ineligible flags prevent this local review from being treated as F05 booking acceptance. No account-type or actual-provider capability proof is inferred.

The binding hash includes action, batch/organization/entity/facility, accounting date/currency, payload hash, complete member/source hash, grouped source-controls hash, rules ID/content hash/policy reference, rules generation, staging generation, opaque connection/capability references, and preparer user/session/scope version. Member documents include source identity/version, operation, basis, gross cents, economic date and canonical contribution lines. Gross controls are grouped by basis **and operation**: original and reversing journal debit totals are never presented as net financial position.

Repeated unchanged preparation/decision identifiers are idempotent; changed valid contents conflict. Reordered members normalize to the same identity. Material changes require a new batch, not edits to old payload/member/approval evidence.

## Authority, locks and lifecycle

Facility administrators can prepare only their currently accessible explicit facility scope; owner/org-admin may prepare broader entity scope. Approval requires a current owner/org-admin with a different stable user UUID from the preparer. Different sessions or roles for the same person do not provide independence.

Current caller and historical preparer/approver checks use active profiles, organization, claim version, nondeleted/nonbanned Auth users, actual session membership, session `not_after` when present, and current relevant facility/entity authority. Session deadlines use the wall clock so expiry during a lock wait is rejected. Mutation paths recheck authority after every advisory/control/batch/event/claim wait and before returning. Final approval validation includes both actors after its receipt write; a disappearing actor cannot silently create a zero-row or successful approval. Final preparation validates member scope/bindings again after claims and evidence writes.

Preparation locks the request identity, finance-period advisory lock, 339 entity control row, sorted source-event rows (`FOR SHARE`), existing batch or superseded predecessor rows, then unique claims. Decisions lock the request identity, period, control row and batch row; they do not lock source-event rows. The shared entity control row serializes these paths. Control/rule invalidation holds the control row and locks affected batches in UUID order; it never acquires period locks. Period closure uses 336's period lock before 340 invalidation. The 340 after-change hooks also enforce current/expiry checks for authenticated control and period changers after the inherited waits, including nested batch-row waits during invalidation.

States are `prepared`, `locally_approved_dispatch_disabled`, `invalidated`, `rejected`, and `superseded`. Control/rule/period changes persist invalidation and append immutable automatic evidence without inventing a human approver. The `STABLE` snapshot derives current invalidity for actor/session/member-scope changes from one coherent database statement snapshot without mutating on read. A decision that encounters stale authority/binding never returns a new approval: it returns invalidated or rejects the request as appropriate. Raw table status is deliberately unavailable to application callers.

Invalidation retains member claims. Explicit rejection or atomic supersession releases only claims belonging to a hard-disabled unsent batch. Old members, payloads and approvals remain immutable. A partial-overlap supersession that encounters another batch's claim rolls back the old status, claim release and new batch together. Intentional dropped members become unclaimed source events, not deleted history; future workbench coverage must show them. No existing339 intent/command is dispatched or given an external payload by this migration.

Snapshot returns `batch`, `members`, `decision_history`, `invalid_reason`, `accounting_classification`, `business_release_eligible`, `dispatch_enabled`, and `binding_claim = declared_local_only`. Its batch status is effective current status. Decision history is historical evidence, not current authority. Prepare/decision responses consistently expose the unverified/business-ineligible blocker. UI must not shorten the result to an unqualified “approved.”

## Verification and remaining scope

`supabase/tests/review_finance_batch_approval.sql` is rollback-only and uses synthetic native PostgreSQL Auth adaptation. Separate run-owned concurrency probes cover overlapping prepares, every-wait revocation, natural session expiry and final-decision actor loss. This layer is not real GoTrue/PostgREST, hosted, provider or business acceptance.

Root-owned followup341 will provide authorized, stable keyset-paginated event/rule/batch discovery and workbench integration. The snapshot RPC requires a known batch ID; no complete discovery or portfolio coverage is claimed here. Still open: source-derived accounting classification/mappings, verified provider company/accounts, approved aggregation/privacy/basis/calendar rules, provider/recovery/dispatch gates, complete source coverage/cutover, and full F03/F05 acceptance.
