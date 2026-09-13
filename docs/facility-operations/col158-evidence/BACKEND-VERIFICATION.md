# COL-158 backend verification

Native resident-document intake stores files once in the private native bucket and creates the canonical resident_documents row only after trusted server-byte verification and current authenticated finalization. HFO stores provenance and native references, not report copies. Source types, observed signatures, actual receipt, administrative review and renewal remain distinct; unknown policies remain unknown.

## Executed local proof

- Final native matrix passed: contact creation/retry, date-only service/receipt/signature, unknown due and future-effective due, actual byte-attestation requirement, no Storage UPDATE grant, lost-finalization replay, native header/object replacement currentness, exact native read/write roles, two monthly tasks sharing one expectation/file, separate current-task review, three independent signature roles/correction, supersession without signature/review carry-forward, native retirement privacy and wrong resident/site/request scope.
- Seven actual blocked-connection cases passed: same-key event and finalization; native reference loss after wait and after capture; actor revocation; native loss during history read; concurrent event append during history read. No stale stronger-scope result or forged event was accepted. Native-only cases retained HFO access; actor revocation removed it.
- Actual serialized native reply passed the shared Zod schema: one expectation, two versions, date-only service, new version unreviewed.
- 19 focused model/byte/API tests passed. A deliberately exercised lost-success response initially returned409; the retained red/green logs show the correction to503 uncertainty and exact retry without a duplicate native document. Supported typecheck and focused lint passed.
- Parent full suite passed644 files /4,669 tests and two existing skips. Seven new API tests and the later UI resource precheck regressions are separately verified; no larger full-suite count is claimed.
- A real370 migration attempt against an owned369 clone with an existing public resident-documents bucket was correctly refused; existing configuration remained unchanged and new schema rolled back.

Native SQL Storage rows and service-byte attestations are synthetic stub evidence, not actual hosted file transport. Hosted authenticated upload/hash/finalize/download and browser proof remain pending until independently bound source readiness.

Initial compiler/fixture failures are retained privately: SQL quote repair, fixture date union cast, legacy Storage owner-field compatibility, fixture table-owner context and refreshed claims after adding facility access. Native soft-delete through the authenticated fixture path was refused; the privacy test uses a controlled privileged native retirement rather than granting a new archive capability. No production policy, native permission, checksum assertion or scanner was waived.

Exact raw evidence and four owned native compile baselines are recorded in /Users/brianlewis/.hermes/tmp/agent-runs/col158-native-ff910631/manifest.json. Committed log copies differ only by documented whitespace normalization. No production action is authorized by this proof; the user stop boundary is COL158 and COL160 through verified main, then stop.

Mandatory gate passed all11required checks:373 migrations/53SQL probes, build, lint, design and axe. Overall12passed/0failed/1optional skip. Exact result: strict-gate-final.json. All3264pre-start source hashes remained unchanged.
