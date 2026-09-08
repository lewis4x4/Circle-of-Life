# Remaining roadmap execution

User requested completion through Sections 3–8 and final integration review on 8 September 2026. Execute bounded, independently reviewed segments; preserve clinical/customer acceptance boundaries.

Baseline: freshly fetched origin/main `9db72d2d`. Section 2 engineering release is closed per section-2-release/RELEASE-CLOSEOUT.md. Current independent worktree: `/Users/brianlewis/Circle of Life/Haven Remaining Roadmap`; branch `codex/haven-remaining-roadmap`. Unmerged home-login work and existing source artifacts are preserved in their original checkout.

## Current segment: Section 3 / FL-012

Migration 334 validates required reconciliation evidence on every write retaining complete status. Existing draft reopening remains the correction path. Regression failed on baseline when pharmacist_reviewed_at was erased. With the repair, 337 migrations and 18 SQL probes passed. Independent source review APPROVE; formal segment gate PASS at `test-results/agent-gates/2026-09-08T11-28-07-433Z-section-3-fl012.json`; typecheck PASS. No deployed change is claimed. Mission alignment: pass for this bounded repair.

## Remaining sequence

- Section 3: FL-006 chronological assessment risk, FL-007 atomic discharge/bed release, FL-001 operational med-tech shift and pass producer.
- Section 4: BUS-001, BUS-002, BUS-003, BUS-006, SYS-006; retain the separately noted SYS-005 partial-resolution scope.
- Section 5: NAV-004, NAV-005, NAV-008, NAV-010, NAV-011, SYS-007.
- Section 6: NAV-007, FL-002, FL-008, FL-010, FL-013, FL-014.
- Section 7: FL-003, FL-004, FL-005, FL-011, SUP-001, SUP-002.
- Section 8: BUS-004, SYS-009, SUP-003, OPS-001, OPS-002, OPS-003.
- Final independent integration review, fixes and engineering release verification.

Named Homewood staff/device acceptance, staffing policy inputs B-12, and executable compliance preset inputs C25 remain distinct owner gates. Do not fabricate policy or UAT.

## Local verification environment

Run-owned PostgreSQL only: `/Users/brianlewis/.hermes/tmp/agent-runs/haven-s3-20260908-01a080c2`; private manifest present. Socket same directory; port 55443; binaries `/opt/homebrew/opt/postgresql@17/bin`; network listening disabled. Creating run must stop server and validate exact-provenance cleanup before removing disposable files. Retain worktree, installed dependencies and source evidence.
