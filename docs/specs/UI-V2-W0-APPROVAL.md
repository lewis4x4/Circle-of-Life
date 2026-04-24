# UI-V2 W0 — Spec Approval Record

**Spec:** `docs/specs/UI-V2-DESIGN-SYSTEM.md`
**Spec commit SHA:** `<filled in at signing — run: git log -1 --format=%H docs/specs/UI-V2-DESIGN-SYSTEM.md>`
**Approved on:** `<YYYY-MM-DD HH:MM ET>`
**Approved by:** Brian Lewis (Owner)

---

## 1. Approval statement

The UI-V2 Design System spec at `docs/specs/UI-V2-DESIGN-SYSTEM.md` is approved for execution under the rollout plan defined in its §9. All foundation work (W0) is cleared to begin on branch `ui-v2`. No code merges to `main` until TRACK-A closeout is signed per `docs/specs/TRACK-A-CLOSEOUT-ROADMAP.md`.

## 2. Open questions status

Open questions listed in UI-V2-DESIGN-SYSTEM.md §16 must be resolved before the first W0 migration issue (`UI-V2-14`, `UI-V2-15`, `UI-V2-16`) opens. Resolution log:

| # | Question | Resolution | Resolved by | Date |
|---|---|---|---|---|
| 1 | TRACK-A closeout timing vs W0 | | | |
| 2 | `(Staffing hub)` / `(Finance hub)` route paths | | | |
| 3 | `user_facility_access` + `has_role()` function names | | | |
| 4 | `public.facilities(id)` FK target confirmed | | | |
| 5 | Copilot suggestion source + citation origin | | | |

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

- [ ] Spec merged to `ui-v2` branch
- [ ] `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` set in Netlify env (circleoflifealf)
- [ ] `sentry-cli` installed locally
- [ ] `.github/PULL_REQUEST_TEMPLATE/ui-v2.md` committed
- [ ] `scripts/agent-gates/sentry-smoke.mjs` committed and wired into `run-segment-gates.mjs`
- [ ] `scripts/agent-gates/ui-v2-issue-acceptance.mjs` committed
- [ ] All 5 §2 open questions resolved above
- [ ] Paperclip → GitHub issue mirror live (CEO workflow)

When all boxes above are checked, W0 is closed and W1 may begin.

## 5. Signature

```
Approved by: _______________________________     Date: ____________
             Brian Lewis (Owner)

Co-reviewed by: ____________________________     Date: ____________
                Track A Lead
```
