# COL-159 independent review (Haven GATE package)

**Status: APPROVED AFTER FIXES** (source-only SQL/runtime review; every fix re-verified)

An independent, read-only reviewer seat examined migration `348_hfo_dietary_admin_sources.sql`, its probe, the widened COL-154 and COL-147 probes, the race script, the schemas, the trusted fragments and the four routes against the three acceptance criteria, running twenty-three of its own scenarios inside rolled-back transactions on the native clone `col159_base348`. Its verdict before fixes was **APPROVE WITH FIXES**: no blocking finding, two should-fix, eight notes.

| # | Finding | Disposition |
|---|---|---|
| F1 | Corrections re-validated references they did not touch (certificate, approval document, vendor link), so an archived certificate froze the record | **Fixed for documents**: a certificate or approval document is re-checked only when the correction restates it; probed (archive after recording → note-only correction chains; restating to the archived document is refused). **Kept for the vendor link, documented**: the 344 statement rules re-check the vendor's site link at every 346 delivery, so relaxing the command would only turn a clean up-front refusal into a rewritten record under a refused delivery; probed (link ended → note-only correction refused by name, record unchanged; re-linked → chains). 3l(xiii) |
| F2 | A corrected version whose delivery landed `unmatched` left the earlier version's receipt effective on the old occurrence (inherited 346 behaviour, reachable through every new adapter) | **Fixed 348-locally**: the three 348 correct commands refuse by name (`Corrected record no longer matches the occurrence it satisfied; void the record and record it again`) when the record held an effective receipt and the delivery is `unmatched`; the whole command rolls back; probed (record, occurrence, ledger and receipts unchanged; void then re-record leaves the reversal and a visible unmatched delivery). The `conflict` case keeps COL-154 3k(xi). The 346 fix (invalidate on unmatched as the moved path does) is recorded as the owner's preferred alternative, which would also cover drill-log corrections (347, unchanged here). 3l(xv) |
| F3 | A performer restated vendor→staff (or a changed performer) inherited the earlier `entry_reason` | **Fixed**: a changed performer drops the earlier reason unless the correction states one, so the on-behalf rule asks for a fresh one; probed. 3l(xiv) |
| F4 | An actor outside the recorder list can correct a record (rewritten) while the delivery is refused with attention | **Accepted** (COL-154 policy, unchanged) |
| F5 | The COL-147 probe fails 23:00–23:59 America/New_York on every base database (fixture anchored on `current_date` minus 23 hours) | **Documented** (pre-existing time window, not a 348 effect); the gate's native replay is run outside that window |
| F6 | No COL-159 gate artifact existed at review time | **Resolved by the strict gate run** recorded in `verification.json` and `GATE.md` |
| F7 | `vendors.status` and `meal_services.status` are not consulted | **Documented** in the contract (matches the 344 hand recording) |
| F8 | Replay hash taken before the performer defaults to the recorder | **Accepted** (347 parity; clients resend the identical body) 3l(xvi) |
| F9 | Contract said `next_due_on` "must not precede" while the code refuses equality | **Fixed** (contract now says "after the service date") |
| F10 | `haven.*` commands executable by `authenticated` beside the wrappers | **Accepted** (347 parity; documented) 3l(xvi) |

| Requirement | Result |
|---|---|
| Every remaining item has an accessible capture/source path or a specifically identified question; no silent omissions | PASS |
| Meal-level records and audit/performance distinct; equipment/site applicability controls tasks | PASS |
| Composite checks preserve components; service recording does not advance unrelated lifecycle; outbound content not auto-published | PASS |

Re-verification after the fixes: the 348 and 347 probes PASS on a fresh `col159_base348`, race script **6/6 PASS** with observed waits, focused vitest 7 files / 67 tests PASS, typecheck and lint PASS; the reviewer seat re-ran its F1/F2/F3 scenarios and new bypass attempts (conflict-then-unenrolled, move back, void-then-correct, never-linked record, refused-path unchanged, one-effective-receipt invariant) against the fixed migration and returned **APPROVE** (RV-F1, RV-F2, RV-F3 closed; RV-N1 the gate artifact, resolved below); see `independent-review.json`. Strict segment gate: see `verification.json`.

Machine-readable: `col159-evidence/independent-review.json`.
