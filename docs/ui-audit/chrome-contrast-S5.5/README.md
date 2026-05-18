# S5.5 — Chrome value contrast evidence

Captures operator chrome vs warm/dark canvas after the semantic `--chrome-*` rollout.

## Chrome map (Quiet Operator · Mercury-aligned)

| Region | Tokens / classes | Note |
|--------|-----------------|------|
| **Persisted sidebar** (AppShell pillar rail · Admin sidebar) | `haven-chrome-sidebar`, `haven-chrome-rail-*` | Dark charcoal; active row uses **2px** `::before` with `background-color: hsl(var(--primary))`. |
| **Workspace strip** (AppShell desktop header · mobile pillar chip row · Admin main-column top bar only) | `bg-background`, `WORKSPACE_*` wells / icons in layout code | Aligns with **canvas** (“Mercury”: dark nav rail + workspace strip on paper — intentional, not a fallback). |

Survey Visit banner primary action uses `Button variant="neutralCta"` (`--chrome-*` fill) so CTAs avoid saturated `primary` where that would read like a semantic clinical accent (see constitution color semantics).

## After (recommended)

With a running app (`npm run dev` or `next start`), from the repo root:

```bash
DESIGN_REVIEW_ROUTES=/admin,/admin/executive,/admin/residents,/caregiver,/family \
  BASE_URL=http://127.0.0.1:3000 \
  npm run design:review
```

Or use the shortcut:

```bash
BASE_URL=http://127.0.0.1:3000 npm run design:review:chrome-s5.5
```

Screenshots land under `test-results/design-review/screenshots/`.

## Before

Baseline = app state **before** this segment (flat warm cream chrome + canvas). Prefer a screenshot from that revision or design review artifacts from the prior `main` commit.

## Merge gate

Do not merge to `main` until a human approves at least one **after** screenshot (per segment sign-off).
