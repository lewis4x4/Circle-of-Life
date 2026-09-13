# COL-157 backend verification

The four task/period readers expose native census, payment, trust and local Finance Integration context. All 22 source items / 27 components retain explicit rule/finality gaps. Native record metadata is never an administrative performance, bank deposit, provider acknowledgment or billable-day claim.

## Executed local checks

- `probe-bounded-final.log`: all four actual native families; census correction A → B → A; immutable payment replay and prior economic/service dates; linked invoice current version changes; canonical/legacy trust separation including the same UUID; DST endpoint; actual prepared batch/control invalidation; 101 batch records across native queue pages; more than 100 guarded history observations with an explicitly incomplete 100-row page; 5,001-row overflow refusal; direct order forgery, manager/native permission denial with positive HFO task access; atomic rollback after an injected source change.
- `concurrency-five.log`: observed waits for same-key requests, native permission revocation, source change, direct-insert capture revocation and history-phase revocation. Stale stronger-scope data was rejected with no forged history; HFO task access remained true in the native-only denial cases.
- `native-schema-proof.json`: actual synthetic native reply validated against the shared API schema with all four nonempty families.
- `backend-tests-final.log`: 14 focused tests passed. Supported typecheck and focused lint passed.
- Parent-owned full suite passed 639 files / 4,636 tests with two existing skips; SQL-only refinements followed.
- Mandatory gate passed with CI=true and REQUIRE_PG_VERIFY=1: all 11 required checks passed, 372 migrations and 52 SQL probes; 12 checks passed overall, zero failed and one optional skip. Exact artifact: strict-gate-final.json.

## Retained findings and limits

The first fixture attempted a nonzero initial trust balance and correctly hit the existing native guard; fixture creation now starts at zero and the native transaction trigger computes the balance. An actual prepared batch exposed that raw finance_batches deliberately has no read policy: the reader now uses the existing authorized finance_review_queue in a single recursive statement. Both failing attempts are retained.

A repeated full-refresh history setup against 101 batches exceeded the native probe budget and was canceled at the exact owned backend. This remains an expensive repeated-read observation, not a passed latency test. The bounded fixture now populates 101 history observations through actual guards with synthetic source changes before constructing the 101-batch set. It proves history bounds, not 101 complete workflows or a latency guarantee. No native guard, RLS policy, hash check or scanner was disabled.

Raw evidence remains under the private run manifest; committed log copies differ only by trailing whitespace. HFO writes only source history. Authenticated staging, provider/staff acceptance and production obligations remain separate and pending.
