# COL-158 provider report workflow handoff

## Delivered source behavior

AL-H01 remains one resident review component with unconfirmed applicability and review/renewal rules. The workflow records explicit operator-attested service and native contact provenance, an expected document type/version, actual receipt, administrative review, signature observations and chase ownership separately. Form1823, hospice, community support and support plans are distinct types. Hope/Plantation identity, required signer sets and six-month renewal rules remain unactivated.

Service, receipt, approval and signature facts retain date-only precision when the source has no clock time. Unknown due rules never create overdue. An explicitly documented due approval requires its native source reference, named approver, actual approval date and effective date; future-effective approval remains pending. A follow-up commitment remains an issue follow-up, not an invented report deadline.

The private native resident-documents bucket uses fixed facility/document/version UUID paths. Preparation reserves identity without claiming an uploaded native document. Current-caller byte download and actual hash/size/type validation produce a service-only byte attestation; current authenticated finalization independently rechecks permissions and object identity before creating one canonical resident_documents row. No clinical file is copied into HFO. Repeated/lost responses reuse exact request identity without duplicate documents.

Native read access preserves the actual013 policy: organization/site/resident access, excluding dietary and maintenance roles. Native intake writes remain owner/org_admin/facility_admin/nurse; manager and housekeeper read do not become write permission. HFO resident authority is additionally required. Finalized objects and native headers are checked against stored versions; overwrite/delete grants were not added. Existing incompatible bucket configuration causes a clean migration refusal.

A later monthly H01 task for the same resident reuses the existing plan and expectation without another service attestation or upload. Original provenance remains intact, each review records its current task, and the current monthly task starts unreviewed even if an earlier task reviewed that plan. A superseding plan keeps previous signature/review evidence in history and receives no copied review or signature completion.

Signatures are version/page-bound operator observations, not provider-verified cryptographic signatures or signing on behalf. PDF page numbers are explicitly unverified; image page observations are bounded. Actual signature dates remain separate from recording timestamps and may be unknown. Native contact changes preserve the originally observed label/hash. Generic chase issues reuse353/354 ownership and next-action machinery without copying clinical details into the broader issue ledger.

## Executed local proof

- Parent full suite:644 files /4,669 tests passed, two existing skips. Separately,19 focused backend/API tests passed and the final UI resource-precheck/intake set passed7 tests. UI integration evidence is recorded in the evidence directory.
- Native matrix passed: date precision, due effectiveness, contact creation/replay/currentness, verified intake/rollback, exact native roles, monthly reuse, signatures/correction/supersession, header/object replacement, retirement privacy and wrong resident/site/request scope.
- Seven actual blocked-connection cases passed for event/finalize replay, native access loss before/after capture, actor loss and native/concurrent history changes. No stale stronger-scope result or forged event was accepted.
- Actual serialized native reply passed the shared API schema. A real incompatible-bucket migration attempt preserved the old configuration and rolled back new schema.
- All11required strict checks passed, including373 migrations/53SQL probes, build, lint, design and axe. Exact artifact: col158-evidence/strict-gate-final.json. All3,264source hashes matched the manifest captured before the gate.

Earlier compiler/fixture failures and the lost-response409 regression are retained. The final route preserves uncertainty as503 and retries the original finalization request. Raw logs remain privately preserved with independently reviewable whitespace-only committed copies; no guard, RLS policy, checksum or scanner was waived.

## Remaining delivery steps

Authenticated staging upload/finalize/download, full workflow/browser proof and exact fixture cleanup remain pending. Local SQL uses synthetic Storage metadata; it is not hosted transport proof or human/provider acceptance. No PR is opened until that evidence is complete. Production and operating-policy gates remain separate.

The user stop boundary is to complete COL158 and COL160 through verified main, then stop and report. No production cutover or later section is authorized after that boundary.
