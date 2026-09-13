# COL-244 — a staff entry surface for dietary, facility service and AED source records

**Implemented and gated locally on a feature branch stacked on COL-241. Nothing is merged, applied hosted or deployed, and no staff acceptance is claimed.** COL-159 delivered the typed dietary and service commands and explicitly excluded UI, so nothing called them: `service-records` and `dietary-records` had no caller outside `src/app/api/**` and tests. This segment gives the eleven typed COL-159 components a staff entry surface and leaves the other ten on the human path they were dispositioned to. No Homewood rule, threshold, reading definition, equipment list or deadline is set — Q09, Q11, Q14 and Q28 stay open, and COL-226 owns the approvals.

Worktree: `/Users/brianlewis/Circle of Life/Haven Dietary Service Entry`; branch `codex/hfo-col244-dietary-entry`, cut from `codex/hfo-col241-drill-entry` (`876dd137`), which is cut from `origin/main` at `1b2c509e`. **The PR targets `main` and contains COL-241's commit as well**; COL-241 (PR #507) is expected to merge first, after which this diff reduces to the COL-244 commit. This is deliberate: PR477/PR479 went stale precisely because they targeted branches instead of `main` (COL-243). Segment id: `col244-dietary-service-entry`. Mission alignment: **pass**.

## Delivered

- **Shared machinery.** `work/_components/source-command.tsx` now owns what both entry surfaces need: the reply schema, the delivery verdict wording, `useSourceCommand` (one buffered in-flight request retried verbatim, rejection versus unknown handled distinctly), `useSiteAssets` (current assets narrowed to the types the database accepts), the local-time-to-instant conversion, and `ObservationForm`. `drill-source-entry.tsx` was refactored onto it and its twelve tests still pass unchanged, so the COL-154 surface behaves identically.
- **Map.** `src/lib/operations/dietary-service-source-map.ts` covers all twenty-one COL-159 source items. Eleven components carry a typed command; ten keep the human recording or review path and get no screen; `AL-W01` and `AL-A07`'s records are named as COL-154's and are entered on the drill surface, so they are not offered a second time.
- **Entry surface.** `work/_components/dietary-service-entry.tsx`, mounted on the operations work row beside the COL-241 surface and gated by activity key:
  - **Dietary** (`POST /api/admin/operations/dietary-records`): meal substitution at meal level (service date, meal period, planned item, substitute item, reason — and no resident field exists); dietitian menu approval with the menu and approver recorded as stated; emergency food supply check with pass or a stated failure.
  - **Service** (`POST /api/admin/operations/service-records`): asset kinds (`extinguisher_inspection`, `hood_cleaning`, `ac_filter_change`) against an asset of the type migration 360 enforces; facility kinds (`fire_safety_inspection`, `fire_inspection`, `sprinkler_inspection`) against the site with no asset; staff or site-linked vendor performer; an optional next-due date recorded on the record only.
  - **AED** (`POST /api/admin/operations/asset-observations`): the two AED checks reuse the shared observation form against an `aed` asset, as separate records.

## Acceptance

1. **A meal substitution is recorded at meal level and satisfies its component once.** Test asserts the exact payload — service date, meal period, both items and the reason — with no `outcome` and no menu fields, and the surface states that no resident is named or referenced.
2. **An asset service record is recorded against a correctly typed asset.** The picker offers only current assets of the accepted type (a retired extinguisher and an AED are absent from an extinguisher inspection; a hood cleaning accepts both `hood_suppression` and `kitchen_equipment`), and the surface states that the record does not change the asset's approved next service date.
3. **One vendor visit covering fire and sprinkler is two records.** A facility-kind service sends no `asset_id`, says so on screen, and a vendor performer must be a site-linked vendor — naming one does not create it, and `performed_by` is never sent with a vendor.
4. **A wrong kind is not editable into another kind.** The surface states that a record made under the wrong kind is voided and recorded again; the kind is fixed per activity key and never an input.
5. **Human-path rows still record through the generic path.** The map's ten human components resolve to no command and the surface renders nothing for them — asserted for `hfo-al-d01-01`, `hfo-al-a08-01`, `hfo-al-y07-01` and `hfo-al-d11-01`, plus the two COL-154 records.
6. **A refusal is nothing recorded.** A 4xx repeats the database's own refusal, adds "Nothing was recorded", offers no retry, and calls `onSaved` never; an unknown result retries the same request byte-for-byte.
7. **A failed result keeps its follow-up open** on the failed food-supply check and the failed service record, and neither can be recorded without a stated failure.

## Boundaries kept

No migration, RPC, table or second writer. No rule, cadence, threshold, reading definition, equipment list, applicability or deadline. No service record writes an asset's `next_service_due_at`, a building profile date, the licence expiry, a vault document or a maintenance ticket. Nothing is sent or published. No vendor is created from a label. No resident is named or referenced anywhere in the dietary surface. The AED operation and equipment checks stay separate records.

## Evidence

- Focused tests: `work/_components/dietary-service-entry.test.tsx` (13, including axe-core on the opened dietary panel) and the unchanged `drill-source-entry.test.tsx` (12) proving the refactor is behaviour-preserving.
- Full suite: **648 files, 4714 passed, 2 skipped, 0 failed**. `npm run typecheck` and `npm run lint` clean.
- Segment gates: **PASS** — 9 passed, 0 failed, 4 skipped. Artifact `test-results/agent-gates/2026-09-13T23-10-10-961Z-col244-dietary-service-entry.json`. An earlier run failed on `security.gitleaks`: a `generic-api-key` false positive on prose in the COL-241 handoff, which was reworded, amended into `4f1e10d5` and force-pushed before this branch was rebased onto it. Details in `col244-evidence/verification.json`.

## Tests and checks that did **not** run

- `qa.migrations-apply-postgres` — skipped with `SKIP_PG_VERIFY=1`. No migration changed in this segment, and local Docker stacks are not used on this machine per the owner's standing rule; CI runs the same bundle.
- `cdo.design-review` and `cdo.a11y-axe` — skipped: route-level Playwright and axe need a running app at `BASE_URL`. Component-level axe ran inside the tests and is not a substitute.
- No hosted apply, no deployment, no authenticated hosted or browser proof, no production probe, and no staff use. Behaviour is proven against mocked transports and the database contract as written in migration 360, not against a live database.
