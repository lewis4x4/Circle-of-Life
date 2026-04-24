<!--
UI-V2 migration PR template.

Use this template when migrating a page to UI V2 per docs/specs/UI-V2-DESIGN-SYSTEM.md.
Select at PR creation time: append ?template=ui-v2.md to the compare URL,
e.g. https://github.com/<org>/<repo>/compare/ui-v2...branch?template=ui-v2.md
-->

## UI-V2 Migration

**Paperclip issue:** `UI-V2-W<N>-<PAGE>`
**GitHub issue:** Closes #<issue-number>
**Route migrated:** `/admin/<segment>`
**Template used:** `T<N>` (see docs/specs/UI-V2-DESIGN-SYSTEM.md §5)

## V1 → V2 Comparison

<!-- Drag-drop a Loom link OR a video file (.mp4 / .mov up to 100 MB). At least one match required. -->

Recording:

## Screenshot diffs

- Before (V1): `playwright/snapshots/v1/<route>.png`
- After (V2):  `playwright/snapshots/v2/<route>.png`

<!-- Attach or link both images inline -->

## Acceptance checklist

- [ ] Uses exactly one template (T1–T8) from docs/specs/UI-V2-DESIGN-SYSTEM.md §5
- [ ] Zero raw color / raw spacing — `no-raw-color` + `no-raw-spacing` lint pass
- [ ] Storybook story committed with `loaded`, `empty`, `error` states
- [ ] Vitest snapshot + axe-core WCAG AA pass
- [ ] Keyboard navigable: tab through every interactive element; focus ring visible; skip-to-content link present
- [ ] Every `ⓘ` tooltip contract string defined (`require-kpi-info` lint pass)
- [ ] Red-callout numeric cells source thresholds from `facility_metric_targets`
- [ ] Scope preserved across nav (Playwright `e2e.scope-preservation`)
- [ ] `<AuditFooter>` present with Audit Trail link + Live indicator
- [ ] Copilot suggestions carry citation record (N/A if page does not use Copilot)
- [ ] Sentry smoke: 0 unresolved issues in 10-minute window for release SHA
- [ ] Agent-gate JSON posted at `test-results/agent-gates/*-UI-V2-W<N>-<PAGE>.json` with `verdict: "PASS"`

## Out of scope

- New data-model changes (open a separate issue)
- Module-logic refactors (pure visual / component migration only)

## Rollback

Set `NEXT_PUBLIC_UI_V2=false` in Netlify env (circleoflifealf) + redeploy. This PR's route falls through to V1.
