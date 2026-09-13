# COL-149 corporate activity history engineering contract

## Scope and authority

Live Linear was read on September 12, 2026. COL-149 is In Progress; all four prerequisites are clear, including COL-143 at 20:21 Eastern. The isolated branch `codex/hfo-col149-corporate-history` starts from reconciled integration `08fd3a43`; current main remains `50bc07c4`. This is one delivery segment. Corporate counts/attention, exports and facility acceptance remain their own issues.

Corporate selects a currently accessible facility, then a stable activity identity. History preserves dated occurrences across requirement versions and links to the existing receipt, correction and finalized-evidence workflow. Pending and cancelled entries must not imply performance. Performer, recorder, performed time and recorded time remain distinct. Unknown schedules are not invented.

## Acceptance evidence required

- More than 1,000 authorized records, version changes and tied timestamps paginate without loss or duplication; totals are independently complete.
- The same session and current subject/site authority govern history, totals, summaries and supporting files. Scope changes discard old results.
- No history, confirmed empty page, unknown schedule, loading, partial results and failures are distinct.
- Focused API and component behavior tests, typecheck, repository lint and strict UI segment gates pass.
- Independent technical review has no unresolved actionable findings.

## Environment and limitations

The predecessor COL-143 hosted synthetic Storage proof is retained under `col143-evidence/hosted-proof/RESULT.md`. It establishes that dependency, not hosted proof of this new page. This delivery does not merge main, apply migrations to production, activate a facility policy, send external messages or claim staff/clinical/operating acceptance. Homewood configuration remains separately governed by COL-140.

## Rollback

Before merge, close the bounded draft PR or revert this segment commit. Preserve predecessor integration, immutable evidence and all unrelated worktrees.

## Read choices

History is a managed occurrence ledger, including pending, cancelled and reversed entries. Each retains its status; a row is not itself proof that work was performed. Stable activity IDs span requirement versions. Pages use descending raw creation timestamp plus UUID, fifty rows, and a fixed creation-time ceiling carried in a facility/activity-scoped cursor. This ceiling limits newly inserted rows; it is not an export snapshot or a frozen permission set.

Totals exclude the cursor. Last performed is independently selected from non-superseded performed receipts, ordered by performed time. The next-due summary reports only an actual unfinished future occurrence; missing generated work does not justify inventing a schedule. Unknown next due is distinguished from a failed schedule read.

The request validates the current person and site, composes every projection through session RLS, revalidates the actor/site and repeats with the same read time. Changed projections return a retry response. This is bounded change detection, not a serializable database snapshot. New requests always use current permissions.

The history page uses existing Operations view roles and current facility/subject grants; corporate is a workflow description, not a new role or an expansion of grants. Receipt/evidence chains load when a row expands. Names resolved from readable profiles are identified as current profile names; missing names do not become guessed identities.
