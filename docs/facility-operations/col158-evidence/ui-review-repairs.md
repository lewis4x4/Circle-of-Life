# COL158 UI review repairs

- Lost finalize response: upload success is retained in Attempt.uploaded before finalize. Exact retry skips Storage upload and resends the same finalize key/body. Regression deliberately makes a second upload return403 and asserts it is never called;5intake tests pass.
- Monthly reuse: current report reply must match current task, resident and site; finalized native versions may retain a different origin task. Prepared intake/finalize remains origin-bound. Current task review is distinct from last_review historical evidence. Native-current=false versions remain readable provenance but are excluded from current attach/review/download/supersession selection.
- Date precision: date-only service/receipt/approval/due/signature entry is default; optional exact-clock toggle resets the alternate field. No midnight conversion. Missing signature date remainsUnknown. Future-effective approval is not called overdue.
- Follow-up and corrections: existing same-scope generic issues are labelled choices; owner_label replaces bare ownerUUID. Generic create_chase uses backend354 path without clinicaldetails. Signature corrections select an actual same-version observation with role/name/date label; changing version clears selectedcorrection.
- Native contact create remains writer-gated and idempotent, no name-only merge. Current scope changes abort request effects and clearprivatevalues.

18focused repair tests passed, followed by51integration tests including30existingworkpage tests. Typecheck/lint evidence recorded separately. No hosted calls, native PostgreSQL jobs, newpolicyrules or provideractions ran during these UI repairs. Earlier test logs remain preserved.
