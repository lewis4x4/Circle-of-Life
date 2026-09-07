# Section 2 review corrections

Status: all three bounded corrections implemented, verified, and approved by an independent native subagent source review. Ready for whole Section 2 re-review; the six original finding statuses remain review-pending. The independent review of `6d90e3197ac59e757addd2ac3e401dcbd12865f1` requested three bounded corrections. Approved Section 1 baseline remains `5686876cb7917c0a809f0adb7e9ba67b595a3e03`.

Work uses the existing clean Section 2 checkout and branch `codex/haven-section-2-database-rounding`; a fresh fetch matched the reviewed head before edits. The original checkout and retained independent review evidence are preserved. The existing roadmap finding statuses remain `implemented_review_pending`. No Section 3, PR, merge, deployment, or hosted migration is part of this correction.

## S2-R1: complete pending observation and authority

The drawer retains each full pending request in tab memory by operator, signed session, organization, facility, and task. Reopening or switching tasks restores the original clinical form. Retry sends the original UUID, observation time, and clinical payload. Clinical fields remain locked while pending; only an explicit HTTP 400 late-reason-required rejection permits amending the reason. An ambiguous response loss never permits clinical amendment. The request includes its original authority, checked at API entry and again after authority revalidation; task facility must also match.

Acknowledgments retain only the scoped request identity after clinical payload removal, so success arriving during close/reopen is shown as success. Completion-time next-resident callbacks are captured before board updates and their timers are canceled on unmount; the changed queue cannot skip a resident or navigate a different drawer.

Pending records survive drawer unmounts within the tab. They are not written to browser storage and do not survive page reload or tab closure. This change does not add a clinical amendment or manager reconciliation workflow.

## S2-R2: equivalent query edits

Search scheduling now follows normalized input directly. Whitespace-equivalent edits preserve results and active requests. Editing away and returning before the debounce schedules a replacement even when its text equals the previous completed search. Obsolete response generations remain excluded.

Four added regressions failed against the reviewed source and pass with the correction: settled/in-flight equivalent whitespace and settled/in-flight edit-away-return. See `section-2-r2-regressions.json`.

## S2-R3: JavaScript whitespace parity

Forward migration `333_rounding_javascript_whitespace.sql` defines the 25 ECMAScript whitespace and line-terminator characters explicitly, avoiding locale-dependent classification. It replaces three pattern-field trims and the required late-reason trim. Existing committed migrations, receipt equivalence, raw clinical values, locking, thresholds, and audit transaction semantics remain unchanged.

The expanded actual-command SQL probe rejects 26 whitespace-only late reasons with zero clinical/receipt/audit writes and executes 15 completions across five three-resident pattern groups. It checks no flag before the third resident, one flag at the threshold, raw log and receipt preservation, exact replay, and changed-payload conflict. The same probe fails before the forward migration on a tab-only late reason. See `section-2-r3-before.txt` and `section-2-r3-after.txt`.

## Verification and boundaries

Final combined evidence is recorded in `section-2-corrections-verification.json`: **528 test files, 3,273 passed, 2 existing opt-in skips; project typecheck PASS; 336 migrations and 17 SQL probes PASS; four concurrency cases PASS.** The stable-source strict gate passed **12 checks, zero failures, one absent-apps/web skip** at `test-results/agent-gates/2026-09-07T23-10-14-040Z-section-2-review-corrections-final.json`. No checks were waived or downgraded. The preceding passing gate is retained as intermediate evidence. The Vitest log retains a nonfatal missing TypeScript source-map warning.

Independent review raised acknowledgment/remount and delayed-navigation issues while the correction was in progress; all were fixed and regression-covered before the stable-source gate. See `section-2-corrections-review.json`. The run-owned PostgreSQL server was stopped, and Storage Steward validated exact manifests before the creating run removed 988 disposable files and 27 empty directories; manifests and cleanup evidence are retained. Local PostgreSQL uses synthetic fixtures and Supabase Auth stubs. Rendered component/API tests model responses; they are not hosted end-to-end acceptance. Hosted signed-token Auth/PostgREST, real-device disconnection/recovery and clock alignment, and named clinical UAT remain unverified. Public-root design/axe checks do not establish authenticated workflow acceptance. Independent Section 2 re-review is still required before approval or release.

Mission alignment: pass for the bounded source corrections; Section 2 approval and rollout acceptance remain pending. The corrections preserve accurate clinical observations and current-authority boundaries; they do not authorize release.
