# Homewood Lodge ALF — Accessibility Baseline

_Initial scaffold — fully populated by `npm run homewood:a11y-baseline` against a running app._

Tooling: `@axe-core/playwright`. The 5 launch-relevant routes are scanned signed in as the appropriate role:

| Route | Role |
|---|---|
| `/admin/command` | facility_admin |
| `/caregiver` | caregiver |
| `/family` | family |
| `/med-tech` | med_tech |
| `/dietary` | dietary |

## Running

```bash
# Start a production-mode local server in one shell
npm run build && npm run start -- --port 4310

# In another shell
BASE_URL=http://127.0.0.1:4310 npm run homewood:a11y-baseline
```

The script writes its full results into this file (replacing the scaffold) and exits non-zero if any **critical** or **serious** violation is detected on any of the 5 routes.

## Summary by impact (placeholder — re-run script to populate)

| Impact | Node-level violations |
|---|---:|
| critical | _pending_ |
| serious | _pending_ |
| moderate | _pending_ |
| minor | _pending_ |

## Per-route detail (placeholder — re-run script to populate)

Each route gets its own section listing rule ID, impact, node count, and help text.

## Pass/fail criteria for launch

- **0** critical violations on any of the 5 routes
- **0** serious violations on any of the 5 routes
- moderate / minor violations documented for post-launch remediation

## How to fix common violations quickly

| axe rule | Quick fix |
|---|---|
| `color-contrast` | Ratify tokens via design-system or replace inline `text-*/bg-*` with a darker variant |
| `button-name`, `link-name` | Add `aria-label` or visible text; check icon-only buttons |
| `image-alt` | Add `alt=""` (decorative) or descriptive text |
| `label` | Wire `htmlFor` ↔ `id` on form controls |
| `region`, `landmark-one-main` | Wrap page content in a single `<main>` |

Per the brief: fix all critical + serious violations in this sprint. Document moderate violations with proposed fixes for post-launch.
