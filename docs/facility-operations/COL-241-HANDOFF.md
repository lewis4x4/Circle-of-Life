# COL-241 / COL-242 — a staff entry surface for drill and generator source records

**Implemented and gated locally on a feature branch. Nothing is merged, applied hosted or deployed, and no staff acceptance is claimed.** COL-154 delivered the drill and asset-observation source layer and explicitly excluded UI; until this branch, no screen called those commands, and a drill saved on the emergency preparedness page stayed a draft with nothing saying so. This segment adds the entry surface (COL-241) and makes the legacy form tell the truth about what it saved (COL-242). No Homewood rule, day, time, count, threshold or deadline is set — Q06, Q09 and Q14 stay open, and COL-226 still owns the approvals.

Worktree: `/Users/brianlewis/Circle of Life/Haven Drill Entry Surface`; branch `codex/hfo-col241-drill-entry`, cut from `origin/main` at `1b2c509e` (migrations through `370`). Segment id: `col241-drill-entry-surface`. Mission alignment: **pass** — it makes an already-delivered safety source path usable by the person who does the work, without asserting any rule or acceptance.

## Delivered

- **Read path.** `GET /api/admin/operations/drill-logs` (`src/app/api/admin/operations/drill-logs/route.ts`): drill logs at one held site, session-scoped, `state=draft|final|voided` read from the stored columns, optional `drill_type`, soft-deleted rows excluded, paged to exhaustion with an exact total and an explicit failure on a failed later page. This reader exists because the delivered commands address one drill log by id — a person cannot finalize a draft they cannot see. It writes nothing.
- **Library.** `src/lib/operations/source-records.ts` adds `DRILL_LOG_STATES`, `listDrillLogsQuerySchema` and `DRILL_LOG_SELECT` (no evidence file columns). `src/lib/operations/drill-source-map.ts` maps the five COL-154 components that have a typed command to that command, and to the asset type the database enforces (`generator_test` → `generator`, `extinguisher_check` → `fire_extinguisher`, `carbon_monoxide_check` → unrestricted, matching migration 359). The review components `hfo-al-a07-01`, `hfo-al-a07-02`, `hfo-al-a08-01` and `hfo-al-a08-02` are deliberately absent and keep the existing human path.
- **Entry surface.** `src/app/(admin)/admin/operations/work/_components/drill-source-entry.tsx`, mounted in `work-row.tsx` beside the existing source panels and gated by activity key. Drill mode finalizes a draft, corrects a final record under the version it read, or voids it with a reason, through `POST /api/admin/operations/drill-logs/[id]`. Observation mode records a generator test, carbon-monoxide check or extinguisher currency check through `POST /api/admin/operations/asset-observations`, always with `basis: "staff_observed"`. Follows the existing panel conventions: same-origin fetch, abortable reads, generation guards, one buffered in-flight request retried verbatim, no optimistic success.
- **Legacy form (COL-242).** `emergency-preparedness/page.tsx` still records a draft — that is all it ever did — but now says so: the card and the button name the draft, a saved drill states that the requirement is not satisfied yet and links to site work, each listed record shows its stored state, and the migration 359 lifecycle guard's refusals are repeated in plain words that never imply the save landed. Copy and state helpers live in `src/lib/compliance/emergency-preparedness-display-copy.ts` with their own tests.

## Acceptance

1. **A person records a final drill from the real UI and the requirement updates once.** Component test: finalize posts exactly `{request_key, action, payload}` to the delivered command and the reply's own verdict is reported — "satisfied its matching requirement once" — together with "any separate review, evidence or verification still applies" in the same sentence.
2. **A failed result leaves follow-up open.** A draft recorded as failed states that finalizing keeps its follow-up open and does not close the problem; a failed observation cannot be recorded without a stated failure.
3. **Correction and void stay distinct from finalization.** Only drafts are offered to finalize and only final records to correct or void; a correction sends the `expected_version` that was read and requires a reason; a void requires a reason.
4. **An unknown result is retried as the same request.** The in-flight body is buffered and the retry sends a byte-identical body, so the request key is reused rather than a second record being written.
5. **A rejection is nothing recorded.** A 4xx repeats the database's own refusal, adds "Nothing was recorded", offers no retry of a refused command, and re-reads the current records.
6. **No second writer.** No migration, RPC, table or domain command was added. The legacy page's insert type carries no finality column and the page references none of the three commands — asserted by test.
7. **Unavailable is not satisfied.** A failed drill read states that unavailable does not mean no drill was recorded and does not mean the requirement is satisfied; a failed asset read blocks recording rather than guessing an asset.
8. **Nothing invents completeness.** The observation surface offers only current assets of the type the database accepts, records only a person's own observation, and states that a self-test, controller log or photograph is not an observation and that the record does not move the asset's approved service dates.

## Boundaries kept

No rule, cadence, applicability, binding, reminder, schedule or deadline. No new migration and no schema change. No asset, vendor, profile date, licence expiry, document or ticket is written. No outbound transmission. Tornado drills never appear on this surface because the reader is asked for the mapped drill type only, matching migration 359's activity mapping. Existing draft rows are untouched — nothing is backfilled into finality, and no duplicate paper or screen step has been retired (that is COL-20/COL-21).

## Evidence

- Focused tests: `src/app/api/admin/operations/drill-logs/route.test.ts` (4), `src/app/(admin)/admin/operations/work/_components/drill-source-entry.test.tsx` (12, including axe-core on both opened panels), `src/lib/compliance/emergency-preparedness-display-copy.test.ts` (13 total), `emergency-preparedness/page.test.tsx` (4).
- Suites: the operations route handlers, the operations library and the admin operations surfaces — 88 files / 917 tests passed. Full suite — **647 files, 4701 passed, 2 skipped, 0 failed**. `npm run typecheck` and `npm run lint` clean.
- Segment gates: **PASS** — 9 passed, 0 failed, 4 skipped. Artifact `test-results/agent-gates/2026-09-13T22-47-23-020Z-col241-drill-entry-surface.json`. Details in `col241-evidence/verification.json`.

## Tests and checks that did **not** run

- `qa.migrations-apply-postgres` — skipped with `SKIP_PG_VERIFY=1`. No migration changed in this segment, and the owner's standing rule forbids local Docker stacks on this machine. CI runs the same bundle.
- `cdo.design-review` and `cdo.a11y-axe` — skipped: route-level Playwright and axe need a running app at `BASE_URL`. Component-level axe ran inside the tests, which is not a substitute for the route pass.
- No hosted apply, no deployment, no authenticated hosted or browser proof, no production probe, and no staff use. The delivered behaviour above is proven against mocked transports and the database contract as written in migration 359, not against a live database.
