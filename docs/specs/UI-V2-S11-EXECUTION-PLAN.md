# UI-V2 Slice S11 — W5 Settings + remaining Lists

**Parent:** `docs/specs/UI-V2-EXECUTION-HANDOFF.md`
**Spec sections:** UI-V2-DESIGN-SYSTEM.md §5 (T2, T6) + §6 (routes 20, 22, 33, 35, 36, 39, 41, 43, plus rounding sub-routes + settings hubs) + §9 W5 gate
**Depends on:** S10 committed
**Est. eng-days:** 7

## Goal

Long-tail list and settings pages migrated. Thresholds UI at `/admin/v2/settings/thresholds` is the central control that drives red-callout coloring across every T1/T2 page.

## Routes migrated

### T2 Lists (remaining)

| V1 route |
|---|
| `/admin/assessments/overdue` |
| `/admin/rounding/live` |
| `/admin/rounding/watches` |
| `/admin/rounding/escalations` |
| `/admin/rounding/plans` |
| `/admin/rounding/integrity` |
| `/admin/documents` (hub — may not exist; create if needed) |
| `/admin/tasks` (hub — verify existence) |
| `/admin/insurance/claims` |
| `/admin/staff` |

### T6 Settings

| V2 route | Purpose |
|---|---|
| `/admin/v2/settings/thresholds` | Per-facility metric thresholds CRUD (drives red-callout) |
| `/admin/v2/settings/users` | Users & Roles |
| `/admin/v2/settings/notifications` | Notification preferences |
| `/admin/v2/settings/audit-log` | Global audit log viewer (T2 list with `alert_audit_log` + `audit_log` rows) |

14 pages. Another week.

## Files to deliver

### Per T2 list (×10)

- `src/app/(admin)/v2/<seg>/page.tsx` — uses `<T2List />`.
- Corresponding Supabase view + RLS.

### Per T6 settings (×4)

- `src/app/(admin)/v2/settings/<seg>/page.tsx` — uses `<T6Settings />`.
- Left sub-nav groups: `Account`, `Organization`, `Facility`, `Integrations`, `Advanced`.

### Thresholds UI (the critical one)

- CRUD over `facility_metric_targets`.
- Bulk edit: select multiple facilities + set target for metric X.
- Import/export CSV of thresholds.
- Activity log showing who changed what threshold when (reads `alert_audit_log` + new rows for threshold edits → S2 already added audit columns to facility_metric_targets via `updated_by`).

### Playwright

- `tests/e2e/ui-v2/thresholds-drive-callout.spec.ts`:
  1. Open thresholds page, set `labor_cost_pct` target for Oakridge ALF from 55 to 40.
  2. Navigate to `/admin/v2` dashboard.
  3. Oakridge ALF row in Facility Performance table shows labor cost cell in danger color (since real value 54% > new target 40%).
  4. Revert threshold.

### V1 → V2 evidence

14 screenshot diffs + Looms.

## Additional requirements

1. Thresholds UI is the single most impactful control in S11. Ship it fully working first — it's tested by S12 cleanup gate ("thresholds drive callout across all pages").
2. Audit log viewer shows filtered by table + actor + date range. Paginated.
3. Users & Roles settings must gate editing behind `owner` or `org_admin` role (per spec §11 authorization matrix).
4. Notification prefs stored in existing table (verify `user_notification_preferences` or similar exists — if not, add migration in this slice).

## Gate command

```bash
npm run segment:gates -- --segment "UI-V2-S11" --ui
```

## Acceptance

- 14 pages render.
- Thresholds edit → dashboard callout updates (Playwright verified).
- Role-gated controls rejected for unprivileged users (Playwright verified).
- 14 GH issues, all ticked.
- Sentry smoke PASS.
- `smoke.ui-v2-issues` PASS.
- axe-core zero violations.
- Gate JSON PASS.
- `UI-V2-STATUS.md` S11 box ticked.

## Review hooks

- `agents/playbooks/chief-design-officer-agent.md`.
- `agents/playbooks/security-rls-agent.md` — role gating on all settings.
- `agents/playbooks/qa-agent.md`.

## Commit message

`feat(ui-v2-s11): W5 settings + remaining lists [UI-V2-S11]`

## Gotchas

- Rounding sub-routes in V1 are deep. Some may already be T4 (analytics) not T2 (list). Verify per route before assigning template. `/admin/rounding/reports` is clearly T4; included here for completeness but may move to S10 if missed there.
- Documents and Tasks hubs: check if these exist as routes in V1 (`rg "tasks" src/app/\(admin\)/ | grep page.tsx`). If V1 has no Tasks page, create one at V2 only. Document the new page in `FRONTEND-CONTRACT.md §2`.
- Thresholds import/export CSV must validate input strictly (reject unknown metric_keys). Don't create ghost thresholds.
