# Caregiver completion retry correction

Mission alignment: **pass** for this bounded correction. Clinical observations retain their original content and signed operator/session/facility/task scope through uncertain delivery.

The independent rendered reproduction failed twice before edits: HTTP 500 and network failure followed by unsuccessful Outbox persistence both allowed a changed distress status and note to be submitted under the original UUID/time. The original reviewer harness and log remain unchanged beneath `/Users/brianlewis/.hermes/tmp/agent-runs/haven-s2-release-01a07e17/` (`client-review-caregiver-retry.test.tsx`, `client-review-caregiver-retry.log`). The executor reran that harness and confirmed both failures before implementation.

Changes:

- `src/app/(caregiver)/caregiver/rounds/[residentId]/page.tsx`: retain the full pending payload and original task, resident, user, signed session, organization and facility in tab memory; restore on task re-entry; guard current session before send/Outbox fallback; preserve original authority in `retryOwner`; accept only explicit `ok: true` or successful Outbox persistence; isolate stale loads and in-flight responses from newly opened tasks. Completed/acknowledged tasks cannot silently create another observation.
- `src/components/rounding/QuickObservationForm.tsx`: restore pending clinical values, freeze clinical and voice controls during uncertain saves, replay the retained payload, and allow only delayed-reason amendment after the caller receives an explicit unsaved 400 reason-required rejection. Retained vocabulary values remain visible even if available vocabulary changes.
- Corresponding rendered page/form tests replace the previous mocked-form gap with actual controls and add lifecycle, scope, identity and acknowledgment checks.

Verification: `caregiver-retry-verification.log` records **39 passed tests across four files** and scoped ESLint **exit 0**. This includes 16 actual-page cases, two form cases, plus existing drawer and PWA owner regressions. `git diff --check` passed. Full repository typecheck exposed unrelated test typing debt; final segment gates and release verification remain the root agent's responsibility.

No hosted observations, commits, pushes, ledger edits, shared owner-helper changes or temporary files were created by this executor. The two files in this evidence directory are retained release evidence. Pending observations live in tab memory; a hard reload does not preserve a draft whose Outbox persistence failed, so its on-screen instruction remains to keep the draft open.

Root final verification: full Vitest 529 files / 3,288 passed / 2 existing skips; formal project typecheck PASS; strict candidate gate PASS (12 checks, zero failures, one absent apps/web skip). Independent full database and client review lanes APPROVE after the caregiver correction. Text logs normalize trailing presentation whitespace.
