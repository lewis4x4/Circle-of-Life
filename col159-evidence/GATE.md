# COL-159 / HFO-22 — GATE (source-only candidate)

**Verdict from the implementer: ready for Haven GATE and Lewi's review.** Source only; nothing merged, applied hosted or deployed. COL-143 hosted Storage untouched.

| Item | Value |
|---|---|
| Issue | COL-159 `1ed5af55-72be-4b41-af3a-0c6fb718333b` — [HFO-22] Connect dietary, facility services and general admin evidence |
| Branch / worktree | `codex/hfo-col159-dietary-admin` — `/Users/brianlewis/Circle of Life/Haven Facility Dietary Admin` |
| Base | `codex/hfo-col154-drill-generators` @ `47455a13` (COL-154 Done, draft PR #477) |
| Segment id | `COL-159-HFO-DIETARY-ADMIN` |
| Migration | `348_hfo_dietary_admin_sources.sql` (provisional stack slot; `origin/main` now also carries `336_stand_up_pilot.sql`, so 336–348 renumber at integration) |
| Gate artifact | `test-results/agent-gates/2026-09-11T07-01-00-750Z-COL-159-HFO-DIETARY-ADMIN.json` — **PASS** (10 passed / 0 failed / 3 optional skipped; native replay 351 migration files, 32 SQL probes); run 1 at 00:21 failed only on the COL-147 probe's 23:00–02:59 fixture window and is recorded as superseded |
| Independent review | APPROVE WITH FIXES → fixes F1/F2/F3 applied and re-verified → **APPROVE** (`docs/facility-operations/col159-evidence/independent-review.{json,md}`) |
| Local checks | probe 348 PASS; probe 347 PASS; probe 346 PASS outside its window; race 6/6 with observed waits; vitest 584 files / 4004 tests; typecheck; lint; migrations:check |
| Model | Fable 5.1 (`claude-fable-5-1`) |

## What was delivered

The complete AL coverage pass for the twenty-one COL-159 items on the COL-147 mechanism: every item is a registered source path (AED operation and equipment checks on the widened `asset_observations`; fire safety, fire and sprinkler inspections, extinguisher inspection, hood cleaning and AC filter change on a new `facility_service_records` table by staff or a site-linked vendor with read-only next-due and certificate reference; meal-level substitution, dietitian menu approval and the emergency food supply check on a new `dietary_records` table with no resident), a human recording path with its question named (marketing calls, referral and maintenance logs, mail, social media, company and activity calendars, emergency management book, licence renewal), or a review activity that is never allowlisted (sanitation log, drill coverage, generator/CO log reviews). Service records never write an asset, a profile date, the licence, a document or a ticket; nothing sends or publishes; no Homewood rule, day, time, threshold, reading definition or equipment list (Q09, Q11, Q14, Q28 open). Contract: `docs/facility-operations/col159-evidence/engineering-contracts.md`; spec: `docs/specs/27-facility-operations-dietary-admin-sources.md`; handoff: `docs/facility-operations/COL-159-HANDOFF.md`; policies: `OWNER-DECISIONS.md` 3l.

## Acceptance (implementer's read; Haven decides)

1. Every remaining item has an accessible capture/source path or a specifically identified question; no silent omissions — **PASS** (coverage register; migration and probe assert the eleven rules exactly and no review or human-path activity allowlisted).
2. Meal-level records and audit/performance are distinct; equipment/site applicability controls tasks — **PASS** (service date + meal period identity; review activities never allowlisted; asset-type, retired and other-site refusals by name).
3. Composite checks preserve evidence components; service recording does not silently advance unrelated lifecycle; outbound content not auto-published — **PASS** (two AED records, two fire/sprinkler records, currency check untouched by an inspection; assets, profile, facility, documents, meal service and tickets snapshotted unchanged; nothing publishes).

## For the owner (not decided here)

`OWNER-DECISIONS.md` 3l(xv): the 348 commands refuse a correction whose delivery would match no occurrence while the earlier version still satisfies one; the owner may prefer the 346 mechanism fix (invalidate on unmatched), which would also cover drill-log corrections. 3l(v): whether AL-M08 is a per-substitution record or a monthly note (Q14) must be settled before a rule is published. Vendor creation from certificate names stays an owner call.

Draft PR: https://github.com/lewis4x4/Circle-of-Life/pull/479 (vs `codex/hfo-col154-drill-generators`; draft; do not merge). Gated commit `3d5e8182`. Mission alignment: **PASS**; hosted and operating readiness: **RISK**.
