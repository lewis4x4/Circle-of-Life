# S5.5 — Chrome value contrast evidence

Captures operator chrome vs warm/dark canvas after the semantic `--chrome-*` rollout.

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
