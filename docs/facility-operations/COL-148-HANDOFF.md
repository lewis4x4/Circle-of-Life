# COL-148 staff workspace handoff

HFO-10 implements the shared Today, Upcoming and History workspace at `/admin/operations/work` on `codex/hfo-col148-workspace`, stacked on `codex/hfo-col146-recovery` (`d9f5ffb2`). Source-only delivery under the owner’s limited dependency exception. Nothing is merged, applied to hosted systems, deployed or activated.

Source commit: **`97ac1457`**. [Draft PR #475](https://github.com/lewis4x4/Circle-of-Life/pull/475), base COL-146. Linear readback: **COL-148 Done as reviewed/gated/unmerged source**. The documentation-only closure commit does not change the verified runtime.

## Delivered

- Both administrator entry points reach Site work. Today retains all prior unfinished and unknown-schedule work plus separate legacy actions. Upcoming and History preserve single-site/Mine/view/cursor URL state.
- Routine work has one Complete action. Published rules determine inline inputs and evidence. Exceptional outcomes, late/on-behalf entries, corrections and reversals are explicit; server-owned receipts determine status and attribution.
- Server draft recovery uses the same request key and rechecks earlier saves after navigation. Unresolved drafts cannot be replaced by another pending draft or bypassed through new attachments. User changes discard the prior recording surface.
- Verified attachments follow MD5 → prepare → signed PUT → uploaded → finalize. Definite failures permit replacement; lost answers keep their keys. Receipt and current occurrence are reconciled after finalization, including replay. Hosted Storage HTTP acceptance remains COL-143’s open gate.
- History shows full receipt chains, recorded values/notes/performer/time, evidence and issues. Correcting another person’s self-recorded work preserves the original performer and exact instant. Reversal permits fresh recording while retaining history.
- Provider-capped reads page to exhaustion and batch IDs. History merges disjoint sources with microsecond-safe ordering and exact site totals. Receipt hydration verifies before/after occurrence consistency and returns a retryable error when it cannot return a stable combination.
- Lists keep row position and focus after actions. Real page/popup axe tests cover structure, and opt-in calendar controls meet the 44-pixel touch contract. A nonempty-date render loop uncovered by correction testing was repaired with a regression test.

Canonical spec: [27-facility-operations-workspace.md](../specs/27-facility-operations-workspace.md). Detailed contract and engineering decisions: [engineering-contracts.md](col148-evidence/engineering-contracts.md), OWNER-DECISIONS 3i.

## Evidence and acceptance limits

- [Verification](col148-evidence/verification.json): final strict gate, 63 focused test files / 619 tests, typecheck, lint, native replay and accessibility coverage.
- [Independent review](col148-evidence/independent-review.json): original four fixes, provider-cap and snapshot-race fixes, complete client review and evidence re-review; all findings resolved and reverified.
- [Implementation manifest](col148-evidence/implementation-manifest.json): source/test paths and SHA-256 hashes against the COL-146 base.
- [Linear state](col148-evidence/linear-state.json): final source commit, draft PR and live closeout. Done is reviewed, gated, unmerged source only.
- [Authenticated axe](col148-evidence/authenticated-axe.json): invoked but unavailable because this worktree has no Supabase connection settings or test credentials. In-test structural axe and the strict gate’s public-route axe do not establish authenticated browser acceptance.

Mission alignment: **PASS** for the bounded secure shared workspace. Hosted, real-device, staff and operating-cycle readiness are not established. COL-143 remains In Progress with hosted Storage proof open. COL-140 remains unapproved; no rule, schedule or deadline has been silently activated.

## Resume and rollback

The owner requested stopping here and handing the next module to **Fable 5.1**. Use [FABLE-5.1-HANDOFF.md](FABLE-5.1-HANDOFF.md) for COL-147, whose implementation is not started in this segment.

Before deployment, rollback is reverting only the COL-148 source changes or closing its draft PR. No new migration or hosted data change exists to reverse. Keep COL-146 and prior source contracts intact. Do not reset/stash another worktree. The earlier scratch PostgreSQL cluster is retained for the next engineer and is not owned by this run for cleanup.
