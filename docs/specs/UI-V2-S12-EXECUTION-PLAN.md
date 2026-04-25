# UI-V2 Slice S12 — W6 P2 cleanup + flag removal + merge

**Parent:** `docs/specs/UI-V2-EXECUTION-HANDOFF.md`
**Spec sections:** UI-V2-DESIGN-SYSTEM.md §9 W6 + §10.2 (release criteria) + §12 (rollback)
**Depends on:** S11 committed
**Est. eng-days:** 5

## Goal

All remaining admin routes migrated to V2. V1 admin components deleted. Feature flag `NEXT_PUBLIC_UI_V2` removed from code and Netlify env. `ui-v2` merged to `main`. Production enabled.

## Work breakdown

### Phase 1 — Migrate P2 routes (2 days)

Per `UI-V2-DESIGN-SYSTEM.md §6`, P2 routes are:
- `/admin/census/admissions` + `/admin/census/admissions/new` (if not covered in S10)
- `/admin/compliance/policies/*` + `/admin/compliance/policies/[id]` (T2 + T7 Document Viewer)
- `/admin/reports/scorecards` (T4)
- `/admin/reports/*` (T7 Document Viewer for PDFs)
- `/admin/tasks/[id]` (T3)
- `/admin/communications` (T8 Inbox)
- `/admin/communications/[id]` (T8 Inbox)
- `/admin/integrations` (T6)
- `/admin/settings/org` (T6)
- Any route surfaced during audits 1–11 not previously migrated.

Run an inventory check first:
```bash
# Which admin routes still have no V2 counterpart?
diff <(find src/app/\(admin\)/admin -name "page.tsx" | sed 's|.*admin/||; s|/page.tsx||' | sort) \
     <(find src/app/\(admin\)/v2   -name "page.tsx" | sed 's|.*v2/||;    s|/page.tsx||' | sort)
```

### Phase 2 — V1 removal (1 day)

- Delete V1 admin components at `src/components/executive/*PageClient.tsx`, `src/components/staffing/*`, etc. (only the ones replaced by V2).
- Remove V1 route files under `src/app/(admin)/admin/<seg>/page.tsx` where a `v2/<seg>/page.tsx` exists.
- Keep V1 components that are shared infra (`AdminShell`, `V2Card`, `KineticGrid`) — these are still consumed by V2.
- CI check: `rg "V1" src/app/\(admin\)/v2/` returns zero. No V2 page imports V1 components.

### Phase 3 — Flag removal (0.5 day)

- Delete `src/lib/flags.ts` `uiV2()` function (or no-op it). Callers now unconditionally render V2.
- Remove middleware rewrite logic — `/admin/<seg>` routes to `/admin/v2/<seg>` unconditionally via Next.js route groups or direct move.

  Two options:
  1. **Move:** `git mv src/app/(admin)/v2/<seg>/page.tsx src/app/(admin)/admin/<seg>/page.tsx` for every V2 route (after V1 deletion). Removes the `/v2/` URL prefix entirely.
  2. **Keep prefix:** leave V2 at `/admin/v2/<seg>` and redirect `/admin/<seg>` to `/admin/v2/<seg>` via `next.config.ts redirects`.

  Option 1 is cleaner URLs but bigger diff. Option 2 is less churn but keeps `/v2/` in URLs forever. Pick 1 unless owner prefers 2.

- Remove `NEXT_PUBLIC_UI_V2` from:
  - `.env.example`
  - `.env.local` (local, Brian does it)
  - Netlify production + staging env
  - `next.config.ts` if referenced
  - All test files

### Phase 4 — Release gates (0.5 day)

Per `UI-V2-DESIGN-SYSTEM.md §10.2`:

1. Lighthouse performance ≥ 85 on all P0 pages — run `lighthouse-ci` against staging.
2. Axe-core zero violations on all admin routes — existing `npm run a11y:routes` expanded to all V2 pages.
3. Playwright smoke pack: scope preservation, ACK audit trail, export, customize column persistence. Already exists from S8/S9/S10/S11 — consolidate into `tests/e2e/ui-v2/release-smoke.spec.ts`.
4. Bundle size: V2 ≤ V1 + 10%. Capture `npm run build` output before + after, diff, post to PR.
5. Rollback migration dry-run: apply `210_rollback_ui_v2.sql` on a staging clone, verify tables drop cleanly, restore.
6. Sentry smoke with 30-min window: `SENTRY_SMOKE_WINDOW_MIN=30 npm run smoke:sentry` against production post-deploy.

### Phase 5 — Merge to main (1 day)

- Final PR from `ui-v2` → `main`. Title: `UI V2 — Haven admin shell overhaul (S0–S12)`.
- All 11 S2–S12 GH issues closed.
- `UI-V2-W0-APPROVAL.md` signed (at S7).
- `UI-V2-STATUS.md` all boxes ticked.
- PR body: full V1→V2 Loom summary + key screenshots + bundle diff + Lighthouse deltas.
- Squash-merge NO — keep the 13 slice commits for audit trail.
- Create `docs/specs/UI-V2-CLOSURE-RECORD.md` following `PHASE1-CLOSURE-RECORD.md` pattern.

## Gate command

```bash
# Full production release gate — hit everything
SENTRY_SMOKE_WINDOW_MIN=30 npm run segment:gates -- --segment "UI-V2-S12" --ui
```

## Acceptance

- Every `/admin/<seg>` URL renders V2 (no V1 fallthrough remaining).
- `rg "NEXT_PUBLIC_UI_V2" src/` returns zero matches.
- `rg "uiV2\(\)" src/` returns zero matches.
- All §10.2 release gates pass.
- Rollback migration dry-run succeeds on staging clone.
- `main` receives merge commit from `ui-v2` (or equivalent per squash policy).
- `docs/specs/UI-V2-CLOSURE-RECORD.md` committed to main.
- Production deploy succeeds.
- Sentry 30-min post-deploy smoke PASS.
- Gate JSON PASS.
- `UI-V2-STATUS.md` S12 box ticked.

## Review hooks

- `agents/playbooks/release-gate-agent.md` — final release gate.
- `agents/playbooks/performance-agent.md` — Lighthouse + bundle.
- `agents/playbooks/security-rls-agent.md` — production RLS sanity before enable.
- `agents/playbooks/qa-agent.md` — full regression sweep.
- `agents/playbooks/migration-integrity-agent.md` — rollback dry-run verification.

## Commit messages

Each phase gets its own commit:

- `feat(ui-v2-s12): migrate remaining P2 routes [UI-V2-S12]`
- `chore(ui-v2-s12): remove V1 admin components [UI-V2-S12]`
- `chore(ui-v2-s12): remove NEXT_PUBLIC_UI_V2 feature flag [UI-V2-S12]`
- `chore(ui-v2-s12): release gates — Lighthouse / bundle / a11y / rollback dry-run [UI-V2-S12]`
- Final merge commit: `Merge branch 'ui-v2' — UI V2 overhaul (S0–S12)`

## Gotchas

- Do not remove `AdminShell.tsx`, `V2Card`, `KineticGrid`, or anything under `src/components/ui/moonshot/`. These are V2-consumed primitives that existed before UI-V2 slice.
- `next.config.ts` currently has redirects from `/<seg>` to `/admin/<seg>` per `FRONTEND-CONTRACT.md §2`. Those redirects still apply after V2 takes over — don't remove them.
- Bundle diff: Next.js route manifest grows because V2 adds routes. Measure AFTER V1 deletion, not before. Include tree-shaken bundle size per route.
- Production enable: first deploy with `NEXT_PUBLIC_UI_V2` absent is when real users hit V2. Have rollback ready (revert merge commit, redeploy from prior tag).
- `UI-V2-CLOSURE-RECORD.md` template: copy format from `docs/specs/PHASE1-CLOSURE-RECORD.md` — status, scope delivered, gate results, known debt, owner sign-off.
