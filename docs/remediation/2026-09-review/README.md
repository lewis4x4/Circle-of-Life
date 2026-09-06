# Haven review remediation — 6 September 2026

The 119 indexed review entries are accounted for: **117 corrected in source (including five locally verified access boundaries), two explicitly mitigated**. Production has not been deployed or populated by this work. Authenticated operational UAT remains open.

## What changed

- Database-enforced profile/grant/signature boundaries; isolated credential verification; protected admission patches and scoped, transactional Grace execution/undo.
- Real medication and tray receipts, manual temperature logging, preserved ADL/vital/note drafts, repeated PRN handling, clinical order/plan authoring and signature-aware operations completion.
- Atomic journal/cash/training/collection operations; complete payroll inputs; consistent dietary fields and preserved medication revisions.
- Durable meeting follow-ups, versioned workspace writes, team creation, accessible required reading and recoverable document Trash.
- Restored operational pages **and their provider layouts**; role-filtered navigation, Today work first, literal status labels, correct cents/calendar dates and resident/facility context.
- Operator-owned offline Outbox with retained conflicts, serialized onboarding saves and actual scheduled-report output/history with calendar recurrence.
- Removed simulated completion, fabricated saved-view receipts, inactive controls and unused imports. Patched transitive security advisories without new direct dependencies.

## Evidence

Final verification is recorded in `verification.json` and the segment gate artifact. The isolated operational branch passed **2,948 tests across 486 files**, with no failures or skips. The full required segment gate bundle passed: lint/constitution checks, zero dependency advisories, secret scanning, migration replay, production build and anonymous entry/sign-in visual/accessibility checks. Native PostgreSQL 17.9 replay passed **326 migrations and 10 SQL probes**, using the repository's Supabase auth/storage stubs and rollback-only fixtures. Public entry/sign-in UI checks do not substitute for authenticated clinical UAT.

- [Every finding and its evidence](findings.json)
- [Independent final review](FINAL-INDEPENDENT-VERIFICATION.md)
- [Independent clinical challenge and corrections](CLINICAL-INDEPENDENT-REVIEW.md)
- [Independent access/data-integrity challenge](INDEPENDENT-ROOT-REVIEW.md)
- [Report deployment requirements](REPORTING-OPERATIONS.md)

## Two deliberately gated workflows

**B-12: Schedule publication.** Draft assignments and exports work. Publishing awaits the approved RN/LPN minimums or exemptions for each facility/shift, eligible roles counted toward care-staffing ratios, and required-credential mappings. Existing ratios/rest/hour limits were found; these three policy inputs were not. The question is pending with the owner.

**C25: Executable compliance presets.** Unimplemented presets are disabled configuration drafts and cannot masquerade as enabled checks. A verified runnable preset catalog is not delivered. Custom configured checks remain available.

The seven new migrations are numbered 317–323 and replay in the ordinary repository order. See [migration ordering](MIGRATION-ORDER.md).

## Before operational use

Deploy the new migrations, application, and changed Edge Functions together in a controlled rollout. Configure the report worker URL/shared secret. Reconcile existing payroll exceptions, conflicting legacy dietary data, historical financial balances and older acknowledgment requirements as described in the lane ledgers. No clinical/financial historical records were rewritten here.

Exercise the real roles and facility boundaries, failed-save/retry paths, two-person handoffs and post-refresh receipts in an approved environment. Existing customer/clinical acceptance requirements remain in force.

## Branch and existing work

The operational branch is `codex/haven-review-remediation-20260906`, in the sibling `Haven Remediation 2026-09-06` worktree. It excludes the pre-existing public-site draft and original root layout/configuration changes. Those remain in the original working directory; their lint/image/contrast corrections preserve their content and layout. No production deployment is implied by branch publication.
