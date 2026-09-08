# Remaining roadmap execution

User requested completion through Sections 3–8 and final integration review on 8 September 2026. Execute bounded, independently reviewed segments; preserve clinical/customer acceptance boundaries.

Baseline: freshly fetched origin/main `9db72d2d`. Section 2 engineering release is closed per section-2-release/RELEASE-CLOSEOUT.md. Current independent worktree: `/Users/brianlewis/Circle of Life/Haven Remaining Roadmap`; branch `codex/haven-remaining-roadmap`. Unmerged home-login work and existing source artifacts are preserved in their original checkout.

## Completed segment: Section 3 / FL-012

Migration 334 validates required reconciliation evidence on every write retaining complete status. Existing draft reopening remains the correction path. Regression failed on baseline when pharmacist_reviewed_at was erased. With the repair, 337 migrations and 18 SQL probes passed. Independent source review APPROVE; formal segment gate PASS at `test-results/agent-gates/2026-09-08T11-28-07-433Z-section-3-fl012.json`; typecheck PASS. No deployed change is claimed. Mission alignment: pass for this bounded repair.

## Completed segment: Section 3 / FL-006

Migration 335 serializes current Morse risk projection with assessment writes and preserves historical records. Client no longer performs a second fall-risk update. Rendered interaction exposed stale memoized readiness/live score; both now recompute from current answers. The client red artifact follows the readiness fix and demonstrates the still-present historical risk write before its removal.

Independent review initially requested explicit handling of precedence-demoting date corrections and mutable ordering keys. These now reject with correction messages; final review APPROVE. Native replay: 338 migrations/19 probes PASS. Two actual overlapping authenticated-session insertion orders PASS. Four rendered/scoring tests PASS. Supported typecheck PASS. Strict UI gate PASS: `test-results/agent-gates/2026-09-08T11-41-10-095Z-section-3-fl006.json`. Public-root snapshots/axe do not establish authenticated clinical browser acceptance.

No historical risk backfill or invented manual-source provenance. Privileged assessment removal retains the current risk rather than inferring a lower value; ordinary deletion remains denied by existing RLS. Future-date and score mapping semantics are unchanged. Mission alignment: pass for bounded chronological repair. Not deployed.

## Completed segment: Section 3 / FL-007

Migration 336 couples discharge and exact matching bed release. Scope/occupant/extra occupancy mismatches reject without partial writes. Terminal residents cannot acquire beds. Existing reservations, holds, maintenance/offline state and temporary blocks are retained. Existing inconsistent records require reconciliation; this does not rewrite all admission/bed-assignment flows.

Baseline SQL and rendered regressions failed. Final gate replay passed 339 migrations/20 probes, including nurse discharge, failure rollback and scope checks. Actual reservation overlap passed: reservation rejects while occupied and waits for discharge before creating a hold. Three rendered tests and supported typecheck passed. Independent source review APPROVE. Strict UI gate PASS: `test-results/agent-gates/2026-09-08T11-50-27-089Z-section-3-fl007.json`. Public-root screenshots/axe are not authenticated staff acceptance. Mission alignment: pass. Not deployed.

## Completed segment: Section 3 / FL-001

Migration 337 provides explicit manager clinical assignments and operator-owned start/refresh commands. The manager page links from medication management; the cockpit has a real assignment-start journey. This does not publish staffing drafts or record payroll time. Current actor/facility/staff/resident/order eligibility is checked. Exact saved creation requests remain confirmable after later eligibility changes; starting always rechecks current eligibility. Pending creation payload is retained while mounted, including across facility switches and ambiguous-then-definite failure. Browser reload persistence is not claimed.

Scheduled passes use prescription dates, frequency and facility-local slots. Repeated fall clock time uses the first occurrence to match the existing caregiver client; nonexistent spring times and unspecified cadence require nurse review. PRN doses are not fabricated. Existing eMAR/dose locks, holds and independent signature command remain. Direct untrusted activation, generated-pass creation/schedule edits and mismatched eMAR evidence cannot bypass production. Resident assignment changes are audited. Departed residents/inactive orders and externally documented doses leave the visible queue without rewriting history. Queries paginate response rows and chunk identifier URLs. Expired refresh reaches assignment selection; handoff uses actual window end.

Final independent review APPROVE with source hashes in `section-3-fl001-review.json`. Actual six-create/six-start concurrency converged to one shift, assignment, pass and start event, zero fabricated eMAR. Final full suite: 534 files, 3310 passed, two existing opt-in skips. Supported typecheck PASS. Native replay: 340 migrations and 21 probes PASS. Strict UI gate PASS: `test-results/agent-gates/2026-09-08T12-33-15-603Z-section-3-fl001.json`. Root screenshots/axe do not establish authenticated clinical browser UAT. Mission alignment: pass for Section 3 engineering. Not deployed.

## Integration follow-up to inspect

The older `generate-emar-schedule` Edge producer was observed to use UTC clock construction and a 500-order read cap. Its deployment/current interaction with the new canonical pass producer needs final integration verification; do not claim its scheduling semantics were repaired by FL-001. Existing admission override/bed inventory mismatch and temporary-block admission behavior also need integration scrutiny. Preserve named Homewood staff/device acceptance as NOT RUN until actually performed.

## Remaining sequence

- Section 3 source implementation/review complete; Section 4 is next.
- Section 4: BUS-001, BUS-002, BUS-003, BUS-006, SYS-006; retain the separately noted SYS-005 partial-resolution scope.
- Section 5: NAV-004, NAV-005, NAV-008, NAV-010, NAV-011, SYS-007.
- Section 6: NAV-007, FL-002, FL-008, FL-010, FL-013, FL-014.
- Section 7: FL-003, FL-004, FL-005, FL-011, SUP-001, SUP-002.
- Section 8: BUS-004, SYS-009, SUP-003, OPS-001, OPS-002, OPS-003.
- Final independent integration review, fixes and engineering release verification.

Named Homewood staff/device acceptance, staffing policy inputs B-12, and executable compliance preset inputs C25 remain distinct owner gates. Do not fabricate policy or UAT.

## Local verification environment

Run-owned PostgreSQL only: `/Users/brianlewis/.hermes/tmp/agent-runs/haven-s3-20260908-01a080c2`; private manifest present. Socket same directory; port 55443; binaries `/opt/homebrew/opt/postgresql@17/bin`; network listening disabled. Creating run must stop server and validate exact-provenance cleanup before removing disposable files. Retain worktree, installed dependencies and source evidence.
