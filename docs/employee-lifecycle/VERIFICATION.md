# Executed verification — 2026-09-08

## Final code checks

| Check | Result | Evidence and limit |
|---|---|---|
| Required segment gate | PASS | `test-results/agent-gates/2026-09-08T16-07-58-229Z-EMPLOYEE-LIFECYCLE-VERIFIED-20260908.json` |
| Database replay | PASS: 338 migration files, 19 SQL probes | PostgreSQL 17 with Supabase auth/storage stubs; `REQUIRE_PG_VERIFY=1` used. Includes current migration 335 and employee-file adversarial probe. |
| Final focused Vitest | PASS: 182 tests, 14 files | `npx vitest run src/lib/staff src/components/staff src/components/staffing/AdminStaffingConsolePageClient.test.tsx --maxWorkers=4`, final run 12:13 Eastern |
| Earlier full Vitest suite | PASS: 3,408 tests; 2 existing skipped; 535 files | Run began 11:58 Eastern. Later edge-case fixes received the final focused tests and final full build/lint gate; do not add the overlapping test counts together. |
| TypeScript and production build | PASS | Standalone typecheck plus required `qa.root-build` gate |
| ESLint / constitution / migration order | PASS | Required segment gate |
| Dependency audit and secret scan | PASS | No npm vulnerabilities; repository secret and gitleaks checks passed. Staged-diff scan recorded at commit. |
| Employee-specific Chromium journeys | PASS: 8 view states at 390px and 1440px | `test-results/employee-lifecycle/browser-smoke.json` and adjacent screenshots; real components/CSS, synthetic API fixture |
| Employee-specific accessibility | PASS: no WCAG violations or horizontal overflow in checked states | Browser harness; warnings use accessible foreground contrast; finite UI transitions settle before axe, no axe rules disabled |
| Independent scoped review | APPROVE | Source review plus separate test lane. Findings fixed: signer capacities, self-attendance review, narrow staff identity access, stale resource responses, future hire dates, actual duty review snapshots. |

## Specific exercised behavior

- Caller identity, organization/facility boundaries, direct-RPC authorization, role purpose restrictions, immediate session and medical-grant revocation.
- Medical metadata/object access blocked for ordinary managers; independent provider evidence review; attachment upload/attach and no overwrite/deletion of signed evidence.
- Signed version hashes and independent capacities; source drafts and unknown rules do not grant readiness; new draft does not replace approved version; retired successor does not revive an old version.
- Three sessions across two days versus three sessions on one day, insufficient sessions, unknown counts, expired evidence, missing duty prerequisites and future employment.
- Attendance exclusions require independent review; no automatic resignation/termination; approved retraction preserves actual occurrences; original staffing-console callout flow uses the new RPC.
- Export omits medical records/signatures and all free-text notes; export and download requests generate minimal audit events.
- Required date blocks incomplete submission; named multiple-role selection preserves both roles; version increments after draft creation; failed approval/save remains visible with entered data available for correction.
- Switching employees or failing resource loads cannot retain prior employee evidence/grants. Source document display, signatures, mobile layout, and confidential visibility exercised in rendered tests.

## Evidence boundaries

The segment runner's generic design/axe checks cover `/`, not an authenticated employee route. The employee-specific harness supplies the eight real-component synthetic journeys; it is not a production-auth bypass and it makes no external API requests.

Native replay verifies PostgreSQL schema, RPCs, RLS and Storage object-policy composition with stubs. It does not prove hosted Auth/PostgREST request behavior, Storage HTTP upload transport, signed URL retrieval, or live user acceptance. No production migration/deployment occurred.

Earlier failure artifacts are retained: the first integrated unit run caught an outdated training-endpoint fixture; the second gate caught an effect-state lint issue during the stale-data correction. Both were corrected, then the final focused suite and required gate passed. No acceptance threshold was lowered.

## Review and activation

See `IMPLEMENTATION.md` for delivered scope and explicit broader lifecycle boundaries. See `risk-and-decisions.md` before approving source-derived rules. Do not treat OCR as proofread policy, a reference to an official form as a completed form, a benefit election as coverage, or a readiness snapshot as a reconstruction of past clearance.

Previously issued download URLs expire after 60 seconds. Grant revocation blocks new access; it cannot recall an already downloaded copy. The audit event records the request/issuance path, not proof that a recipient read the file.
