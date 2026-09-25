# COL-819 / COL-820 / COL-821 review remediation

Date: 2026-09-24. Mission alignment: pass. Source base: `18fd4914`.

## Changes and boundaries

- COL-819 protective slice: legacy `compliance-doc-check` returns authenticated HTTP 409 / `VERIFIED_INTAKE_REQUIRED` without reading caller text, querying the vault, writing triage, or calling a provider. The local calibration tool likewise refuses provider processing; explicit `--text` stays offline. A vault category or caller-supplied authentication/PHI claim cannot prove source provenance, sender identity or the sender's entire open-obligation set. The old allow-by-category helper now always refuses.
- EPI adequacy is no longer a Jev question. The retained pure triage helper compares literal positive integer day facts against 180 in code; missing/invalid facts and months require human review. Legacy model verdicts cannot substitute for facts. Question version is v3; historical rows are preserved.
- COL-820: cell clicks select facility choices, then Custom, then Off. Custom can remain an incomplete local draft while the operator cycles; explicit Edit times opens the cancellable editor. Incomplete Custom cannot save, and returning an originally empty cell to Off clears its change.
- COL-821: Home retains saved shift names/colors and absolute start/end times. Cover suggestions exclude actual overlapping work blocks, including overnight and split work. Unknown intervals remain eligible for the server to judge; the server still validates facility, role and conflicts.

Haven's shared intake engine, authorized rollout, obligation candidate matching and versioned source/reader integration remain deferred under COL-771/COL-807/COL-819. This protective slice does not satisfy COL-819's full shared-engine acceptance. Home call-out remains unreleased (production readback: zero `call_out` release rows). No provider call, real document submission, hosted data write, or external communication is part of these proofs.

## Evidence

- Before fix: original 18 backend tests passed; two new tests failed on model-owned EPI comparison and category-only authorization. After fix: 24 Deno tests pass, including all legacy payload shapes denied before body reads/network, CLI refusal, auth/method behavior, 179/180/181 day boundaries and invalid/month units.
- Deno checks pass for Edge entrypoint, pure handler, questions and CLI. The dependency-free policy module also allows direct CLI use without environment or network permissions.
- Before fix: behavioral tests reproduced blocking Custom dialog and hidden non-overlapping custom candidate. After fix: 48 focused Vitest tests pass across schedule page, Home dialog and interval/parser tests. Role/facility RPC denial remains visible in the dialog.
- `npm run typecheck` and changed-file ESLint pass. The root `tsc --noEmit` command is not the repository application typecheck scope; it includes unrelated Deno/test files. Production uses `tsconfig.typecheck.json`.
- `browser-proof.json`: actual components with synthetic local adapters, five interaction groups pass; four cell clicks, explicit edit/cancel, focus, publication, responsive layout and saved snapshots. Zero page errors, external requests or axe violations. Images are synthetic, not resident/staff data or hosted acceptance.
- `visual-verdict.json`: 95/pass against the existing schedule visual reference. Independent bounded code review: APPROVE after correcting an offline CLI environment import.

Full repository gate PASS: `test-results/agent-gates/2026-09-25T00-36-44-898Z-col819-821-review-fixes.json` (hygiene, audit, secrets, lint, build, stress, design and axe). Hosted release evidence is recorded in the PR and Linear after execution. No migration or server overlap/RBAC change is required; SQL replay is skipped only under the repository classifier's non-database-sensitive result. Staff/provider acceptance is not claimed.
