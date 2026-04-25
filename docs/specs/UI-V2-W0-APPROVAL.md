# UI-V2 W0 — Spec Approval Record

**Spec:** `docs/specs/UI-V2-DESIGN-SYSTEM.md`
**Spec commit SHA:** `185e13b273ca53d611cbf4c9ae09720715100db1`
**Approved on:** `2026-04-25 14:00 ET`
**Approved by:** Brian Lewis (Owner)

---

## 1. Approval statement

The UI-V2 Design System spec at `docs/specs/UI-V2-DESIGN-SYSTEM.md` is approved for execution under the rollout plan defined in its §9. All foundation work (W0) — tokens, flags, primitives, templates, migrations — is delivered on branch `ui-v2`. No code merges to `main` until TRACK-A closeout is signed per `docs/specs/TRACK-A-CLOSEOUT-ROADMAP.md`.

W0 is closed at S7 sign-off (this record). W1 may proceed against the slice plan in `docs/specs/UI-V2-EXECUTION-HANDOFF.md`.

## 2. Open questions status

Open questions listed in UI-V2-DESIGN-SYSTEM.md §16 must be resolved before the first W0 migration issue (`UI-V2-14`, `UI-V2-15`, `UI-V2-16`) opens. Resolution log:

| # | Question | Resolution | Resolved by | Date |
|---|---|---|---|---|
| 1 | TRACK-A closeout timing vs W0 | TRACK-A engineering closeout signed (B/C tracks closed 2026-04-09 per AGENTS.md "Current build position"); W0 work proceeds on `ui-v2` branch with no merge to `main` until TRACK-A acceptance UAT (§A) clears. Slice gates accept this on the `ui-v2` branch only. | Brian Lewis | 2026-04-25 |
| 2 | `(Staffing hub)` / `(Finance hub)` route paths | Already mounted in V1 admin shell — `/admin/staffing` and `/admin/finance` (see `src/components/layout/AdminShell.tsx`). UI-V2 reuses the same URLs; the page-template map in §6 binds these to T1. | Brian Lewis | 2026-04-25 |
| 3 | `user_facility_access` + `has_role()` function names | Resolved in S2 alignment — Haven uses RLS helpers from `supabase/migrations/004_haven_rls_helpers.sql` (`haven.organization_id()`, `haven.accessible_facility_ids()`, `haven.app_role()`); the spec was rewritten in S2 to match (`docs/specs/PHASE1-RLS-VALIDATION-RECORD.md`, commit `185e13b`). | Brian Lewis | 2026-04-09 |
| 4 | `public.facilities(id)` FK target confirmed | Confirmed via S2 migration apply (`supabase/migrations/207`–`209`) — `facility_metric_targets` and `alert_audit_log` reference `public.facilities(id)` and `public.organizations(id)` directly. | Brian Lewis | 2026-04-24 |
| 5 | Copilot suggestion source + citation origin | **Deferred — backend not yet specified.** S5 ships the `<CopilotDrawer>` UI with a strict citations contract (`{recordId, recordType, facilityId, generatedAt, modelVersion, citations: [{source, id, excerpt}]}`); uncited suggestions are dropped at runtime. Fixture data in `src/design-system/components/CopilotButton/__fixtures__/suggestions.json` substitutes for the missing backend. Tracked as waiver `W-COPILOT-SOURCE-01` in `docs/specs/PHASE1-WAIVER-LOG.md`. Resolution required before Copilot promotes from preview-only to a live page surface. | Brian Lewis | 2026-04-25 |

## 3. Evidence sources locked

This approval fixes the following evidence paths, referenced throughout UI-V2-DESIGN-SYSTEM §9 and §10:

| Evidence class | Canonical source | Query path |
|---|---|---|
| Per-segment gate result | `test-results/agent-gates/*-UI-V2-*.json` | `npm run segment:gates -- --segment UI-V2-<SEG>` |
| Per-page acceptance checklist | GitHub issue body (label `ui-v2`) | `gh issue list --label ui-v2 --state all --json number,title,state,body` |
| V1→V2 recording | GitHub PR body (template `.github/PULL_REQUEST_TEMPLATE/ui-v2.md`) | `gh pr view <pr> --json body \| jq -r .body \| grep -Ei '(loom\|\.mp4\|\.mov\|user-attachments)'` |
| Sentry smoke (10-min) | `scripts/agent-gates/sentry-smoke.mjs` → gate JSON | `npm run smoke:sentry` |
| Screenshot diffs | `playwright/snapshots/{v1,v2}/<route>.png` | `npm run a11y:routes && playwright/diff` |
| Spec approval | this file, committed to git | `git log -1 --format=%ai docs/specs/UI-V2-W0-APPROVAL.md` |

## 4. Gate cleared

- [x] Spec merged to `ui-v2` branch (commit `185e13b`)
- [x] `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` set in Netlify env (circleoflifealf) — placeholder values pending owner refresh; smoke gate remains SKIP per S0 waiver
- [x] `sentry-cli` not required for W0 (smoke uses raw HTTP fetch); local install deferred to W1
- [x] `.github/PULL_REQUEST_TEMPLATE/ui-v2.md` committed (S0)
- [x] `scripts/agent-gates/sentry-smoke.mjs` committed and wired into `run-segment-gates.mjs` (S0)
- [x] `scripts/agent-gates/ui-v2-issue-acceptance.mjs` committed (S0)
- [x] All 5 §2 open questions resolved above (Q5 deferred via waiver)
- [x] Paperclip → GitHub issue mirror — N/A: Haven executes through Claude Code; Paperclip is BlackRock AI client work only (see UI-V2-EXECUTION-HANDOFF.md §"Non-negotiable rules" #11). Mirror rule does not apply.

W0 is closed at S7 sign-off.

## 5. Signature

```
Approved by:   Brian Lewis (Owner)            Date: 2026-04-25
Co-reviewed by: Track A engineering closeout  Date: 2026-04-09
```
