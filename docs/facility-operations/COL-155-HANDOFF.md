# COL-155 resident and admission source review

## Bounded behavior

The36 requested Admin Log items are mapped to41 canonical components. The supported resident record-review subset can select version-pinned native rounding observations, vital observations, receivedForm1823 metadata and contact metadata. Each source family has explicit resident/site, period and qualification predicates. Unsupported native actions, signing/DNR sufficiency, external medication and admission/finance steps remain visible with their existing native or manual pathway; no care or provider approval is fabricated.

A user records a current/self administrative performance through existing HFO receipt rules, including findings, outcome, evidence and separate verification. The period describes the records being reviewed, not the review timestamp. Late/on-behalf work remains on the manual pathway without claiming current source versions prove historical review.

Native rows are read as the actual authenticated invoker. Immutable HFO references retain source ID/version and review period; changed, expired, replaced or unavailable sources require review without rewriting original receipts. A readable but ineligible source retains its citation. Actual native-access loss masks citation details while preserving authorized HFO history. Recheck events are explicit and idempotent; no clinical-write triggers or continuous-monitoring claim.

Private HFO receipt issuance witnesses bind references to receipts created by the current transaction. Direct DML cannot attach today's version to an old receipt after a mutable projection update. This avoids inference from PostgreSQL xmin/subtransaction behavior. The witness is private, server-written and never coupled to native clinical tables.

Activity identity is resolved from authorized activity_key metadata, supporting a fresh organization and new IDs without relying on one seeded UUID. Failed identity reads report partial rules rather than silently hiding context.

## Executed local evidence

- Full suite4586 passed with2 existing skips before final focused changes; changed files have subsequent targeted verification.
- Backend/workspace53 focused tests; source/UI22 focused tests; final typecheck/lint recorded by owners.
- All four native families exercised, including prior-period late-entered observations, replacement and expiry, native permission denial and retained history.
- Four actual concurrent-session/attack cases passed: same-key replay after a real wait, native access revoked during a task lock, source version changed during a task lock, and historical receipt projection updates denied new reference issuance.
- Audit failure rolls back the HFO review; source contents are not copied into replies/history. Clinical records are untouched by the review command.

Canonical evidence is in col155-evidence/backend-verification.json, native-source-review.log, native-source-review-concurrency.json and the focused/UI logs. The integrated mandatory gate `2026-09-13T14-24-47-334Z-COL-155-RESIDENT-SOURCES.json` passed all required checks, including370 migrations/50 native probes. Source hashes remained unchanged during that gate. Final independent clean binding and hosted proof remain pending.

## Staging plan and limits

Migration367 is not applied hosted yet. Guarded runners require exact committed source, passing mandatory gate, independent review and fresh target identity. They create an isolated synthetic organization, entity, sites, resident, activity and approved synthetic requirement. Existing shared canonical rules are not published or replaced. Real HTTP and browser proofs exercise source selection, explicit review, retry, source change/recheck, native-read denial with HFO access retained, cross-site/revoked requests and unchanged native tables. Fixtures will be retired with grants revoked and history preserved.

Q13/Q15/Q23 and relevant other source questions remain unapproved. Received1823 metadata is not a provider signature, resident-contact existence is not emergency-packet completeness, and visitor/admission events are not arrival or external acknowledgments. Signed-contract finality remains conditional on the documented SYS005/006 provider-handler integrity work. No provider, clinical, staff or production acceptance is claimed.

## Recovery

This adds HFO review metadata and readers, not clinical writes. Preserve all receipts, reference/check history and native data on recovery. Suspend the new command surface or restore a compatible prior frontend if needed; do not drop history or widen native RLS. Production still requires the separately coordinated compatible schema/app/Edge release and recovery proof.
