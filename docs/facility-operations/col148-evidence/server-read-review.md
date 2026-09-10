# COL-148 server read and navigation — independent review (recorded, not yet remediated)

Reviewed 2026-09-10 on the uncommitted tree that became commit `78f75f30` (WIP). Verdict: no blockers; acceptable for a bounded first release with four should-fixes. Gates run by the reviewer: vitest 43 files / 449 tests pass; `check:admin-shell` PASS; typecheck and lint clean. **Nothing below has been remediated; the next session applies these before the page lane's final gate.**

## Should-fix

1. **Cursor date interpolated after a lenient check** (`src/lib/operations/workspace.ts:166`, `:404`). `new Date()` accepts parenthesised comments, so `,` and `)` can reach the PostgREST `or` filter (blast radius bounded to the same site by org/facility `eq` and RLS; worst case 400 → 503). Fix: strict regex on `d` (`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$`), keep the raw string (do not `toISOString`, it drops microseconds and breaks the `due_at.eq` tie-break); add a paren-payload test.
2. **Legacy group hides unfinished legacy tasks from earlier days** (`:556-557` bounds `assigned_shift_date` to today). Either drop the lower bound (`lte today`; note no row cap) or record a today-only policy in contract §1 and OWNER-DECISIONS 3i(iii). Owner's call; default recommendation: drop the lower bound so nothing overdue is hidden.
3. **`rules: null` without `partial: ['rules']`** (`:498-499`): a version or facility requirement hidden by RLS (drafts) yields null rules or a silent central fallback while the comment at `:97` claims null only on read failure. Fix: when any pinned id is missing from the map, add `partial` `"rules"` (or a per-item marker), fix the comment, test it.
4. **`evidence_summary.finalized` is satisfied/not-satisfied, not a finalized count** (`:213-223`; the test at `workspace.test.ts:412` asserts `operation_evidence` is never read). Either amend contract §2 to satisfied semantics or read finalized counts per receipt.

## Notes to carry into the page and the contract

- Inlined reversal id list (`:362-383`) is unbounded; acceptable now; a later migration should mark reversed occurrences.
- History keyset on `due_at` (nulls last, id) rather than the coalesced deadline; document in the contract.
- Legacy window bypasses `parseOperationTaskFilters` on purpose (facility day, not host day); arguably more correct than the tasks route.
- Upcoming excludes finished rows; a row due today whose grace runs past midnight lands in Upcoming; `failed`/`not_performed` rows appear in both Today and History (the page must render the receipt outcome, not "due"); no row cap on Today/Upcoming and each item carries the full receipt (`values`, `note`), so the reply is PHI-shaped: never cache or log it client-side.
- `partitionToday` sorts ISO strings with `localeCompare`; fine for the DB's uniform offset; `getTime()` would be safer.
- Untested behaviours: paren-payload cursor; DST window (2026-11-01); missing version → partial; `mine=0`; history happy path with a cursor; dual membership of failed rows; legacy earlier-day exclusion.
- Navigation: item visible to facility_admin, manager, owner, org_admin and (via allowlist) admin_assistant; coordinator, nurse, maintenance, dietary and housekeeper excluded by their allowlists; the link 404s until the page exists; no redirect collision.

## Clean (verified by the reviewer)

Authority order and 404 discipline; session client only; facility-midnight window consistent between query and partition; `mine` never hides unassigned rows; local-over-central rule resolution with present-empty-local winning; applicable evidence rules match migration 341; issue counts scoped and `neq resolved` correct for 342; history membership includes reversed occurrences via the reversal pre-read; cursor is base64url, length-capped, charset-checked, UUID-validated and carries no facility; `total` from a separate head count with `partial` on failure; no field beyond the contract; `subject_label` never a person's name; `request_hash`, `object_path`, `completion_notes` and `completion_evidence_paths` never selected.
