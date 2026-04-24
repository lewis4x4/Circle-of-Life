# Haven — UI V2 Design System Spec

**Status:** Draft · 2026-04-23
**Owner:** Brian Lewis (Speedy)
**Scope:** Admin shell visual + component overhaul across all `/admin/*` routes. Caregiver (Shell B) and Family (Shell D) mobile shells are out of scope for V2; they inherit tokens only.
**Track:** UI-V2 (parallel branch; ships after TRACK-A closeout).

**Canonical locks:**
- Stack rules: `docs/specs/FRONTEND-CONTRACT.md` wins on any conflict.
- UX principles (triage-first, slide-overs, context preservation, nav collapse): `docs/specs/UX-OVERHAUL-ROADMAP.md` wins on any conflict.
- Reference screen: Executive Command Center, Variant B (dark, two-line scope selectors, ACK+DETAILS paired buttons, Customize+Export, Live indicator, cite-backed Copilot).

This spec is the concrete visual + component system that implements the UX Overhaul Roadmap. It does not redefine navigation architecture or routing (those live in UX-OVERHAUL-ROADMAP and FRONTEND-CONTRACT).

---

## 1. Mission Alignment

**Gate:** `pass`
- Role-governed: every primitive reads user role from Zustand and renders deterministic variants (Owner / CFO / COO / DON / Admin / Compliance / Caregiver / Family).
- Auditability-first: `<AuditFooter>` appears on every page; Copilot surface is `cite-backed` only (no unsourced suggestions).
- AI subordinate: `<CopilotButton>` opens a drawer that requires a linked record on every suggestion; acknowledging or acting on a suggestion writes to the audit log.
- Human judgment primacy: destructive or clinical actions never auto-execute from AI; AI proposes, human confirms, audit records.

---

## 2. Goals / Non-Goals

**Goals**
1. Single source of truth for color, spacing, typography, elevation — no raw hex / pixel values in page code.
2. 13 reusable primitives covering 100% of admin screens.
3. 8 page templates; every admin route maps to exactly one.
4. Per-user column/view persistence (`user_dashboard_preferences`).
5. Per-facility metric thresholds driving red/amber/green callouts (`facility_metric_targets`).
6. Scope (`Owner → Group → Facility → DateRange`) preserved across navigation via URL.
7. WCAG AA on every primitive; keyboard-operable data tables.

**Non-Goals**
- Visual redesign of Caregiver PWA (Shell B) or Family Portal (Shell D).
- New module creation. Pure visual + component migration.
- Replacing shadcn/ui. V2 primitives compose shadcn primitives; they do not fork them.
- Changing routing, auth, or RLS for existing modules (see §7 for V2-only migrations).

---

## 3. Design Tokens

**File:** `src/design-system/tokens.ts` (single source of truth).
**Rule:** No hex / px value appears in any component file. Lint rule `no-raw-color` and `no-raw-spacing` enforce this on CI.

```ts
export const tokens = {
  color: {
    bg: {
      app: "rgb(11 16 28)",
      surface: "rgb(18 25 40)",
      surfaceElevated: "rgb(25 33 50)",
      surfaceSubtle: "rgb(15 21 34)",
      border: "rgb(39 51 74)",
      borderStrong: "rgb(56 72 101)",
    },
    text: {
      primary: "rgb(237 242 251)",
      secondary: "rgb(160 176 201)",
      muted: "rgb(115 132 158)",
      inverse: "rgb(11 16 28)",
    },
    semantic: {
      success:    "rgb(34 197 94)",   // on-target, Low severity, healthy
      info:       "rgb(59 130 246)",  // finance, informational
      warning:    "rgb(245 158 11)",  // Medium severity, at risk
      danger:     "rgb(239 68 68)",   // High severity, threshold breach
      regulatory: "rgb(139 92 246)",  // survey windows, compliance timers
      neutral:    "rgb(100 116 139)",
    },
    brand: {
      primary:      "rgb(59 130 246)",
      primaryHover: "rgb(37 99 235)",
      accent:       "rgb(139 92 246)", // Copilot / AI surface
    },
  },
  radius: { sm: "6px", md: "8px", lg: "12px", xl: "16px", full: "9999px" },
  space:  { 1: "4px", 2: "8px", 3: "12px", 4: "16px", 5: "20px", 6: "24px", 8: "32px", 10: "40px", 12: "48px" },
  font: {
    family: {
      sans: "'Inter', system-ui, sans-serif",
      mono: "'JetBrains Mono', 'IBM Plex Mono', monospace",
    },
    size: { xs: "11px", sm: "12px", base: "14px", md: "15px", lg: "18px", xl: "22px", "2xl": "28px", "3xl": "36px", hero: "48px" },
    weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
    tracking: { tight: "-0.01em", normal: "0", wide: "0.02em", caps: "0.08em" },
  },
  shadow: {
    card:    "0 1px 2px rgba(0,0,0,0.2), 0 0 0 1px rgb(39 51 74)",
    panel:   "0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgb(39 51 74)",
    popover: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgb(56 72 101)",
  },
  motion: { fast: "120ms", base: "180ms", slow: "260ms", ease: "cubic-bezier(0.4, 0, 0.2, 1)" },
} as const;
```

**Tailwind wiring:** extend `tailwind.config.ts` to map tokens → semantic classes (`bg-surface`, `text-text-secondary`, `text-danger`, `border-border`, etc.). Components consume semantic classes only.

**Severity convention (locked):**

| Level   | Token        | Use |
|---------|--------------|-----|
| Success | `success`    | On or above target; Low severity. |
| Warning | `warning`    | Within warning band (default 10%) of target; Medium severity. |
| Danger  | `danger`     | Threshold breach; High severity; overdue; unacknowledged incident. |
| Info    | `info`       | Finance, informational. |
| Regulatory | `regulatory` | Survey windows, licensure timers, compliance countdowns. |

The red-callout rule in `<DataTable>` numeric cells reads `facility_metric_targets` and uses this mapping. No bespoke per-page colors.

---

## 4. Component Primitives

All primitives live in `src/design-system/components/`. Each requires: Storybook story (3+ states), Vitest snapshot, axe-core accessibility test, `// @ts-check` strict typing, zero raw color/spacing.

| # | Component | Purpose | Composes |
|---|---|---|---|
| P01 | `<PageShell>` | Page wrapper: left nav, top bar, scope, filters, main, optional right rail, footer | `AdminShell`, shadcn `Separator` |
| P02 | `<TopBar>` | Page title/subtitle + scope trio + actions + Copilot + notifications + profile | shadcn `DropdownMenu` |
| P03 | `<ScopeSelector>` | Owner / Group / Facility three-tier selector, URL-backed | shadcn `Select` + `Combobox` |
| P04 | `<FilterBar>` | Date range, facilities, regions, statuses + Reset/Save View | shadcn `Popover` |
| P05 | `<KPITile>` | Metric card: label, value, unit, trend delta, sparkline, tone, info tooltip, breach message | Recharts `AreaChart` |
| P06 | `<TrendDelta>` | ↑/↓/flat + value + unit (pp/pts/%/days) + period | — |
| P07 | `<Panel>` | Mid-section card: title, info icon, subtitle, slot content, CTA footer | `V2Card` (existing) |
| P08 | `<PriorityAlertStack>` | Right-rail alert queue: severity icon, title, facility, timestamp, ACK + DETAILS buttons, NEW/ACTION/REVIEW chip | — |
| P09 | `<ActionQueue>` | Counted action list: icon, label, sublabel, count badge, chevron | — |
| P10 | `<DataTable>` | Dense table: row status icon, semantic-colored numeric cells, SeverityChip, sparkline column, action cluster, Customize, Export, persisted column state | TanStack Table + shadcn `Table` |
| P11 | `<SeverityChip>` | Low/Medium/High + trend arrow + "from X N ago" | — |
| P12 | `<HealthDot>` | Colored dot + proportional bar + numeric score | — |
| P13 | `<AuditFooter>` | Audit Trail link (scope-aware) + Live indicator + Updated N ago + Timezone | — |
| P14 | `<CopilotButton>` | AI entry point with `cite-backed` chip; opens drawer | shadcn `Sheet` |

`<CopilotDrawer>` (internal, owned by P14) enforces: every suggestion must carry `{ recordId, recordType, facilityId, generatedAt, modelVersion, citations: Array<{source, id, excerpt}> }`. No suggestion without citations renders.

### 4.1 Component contracts (Engineer handoff)

**`<KPITile>`**
```ts
type KPITileProps = {
  label: string;
  value: string | number;
  unit?: string;
  trend?: {
    direction: "up" | "down" | "flat";
    value: number;
    unit: "pp" | "pts" | "%" | "days";
    period: string;           // "vs prior 7 days"
    goodDirection?: "up" | "down"; // drives trend color per metric
  };
  tone?: "default" | "success" | "warning" | "danger" | "info" | "regulatory";
  sparkline?: number[];       // min 7, max 90 data points
  info?: string;              // required tooltip contract string
  breachMessage?: React.ReactNode;
  onClick?: () => void;       // drill into detail
};
```
Constraint: `info` is required when tile represents a computed metric (not a count). Lint rule `require-kpi-info` enforces.

**`<DataTable>`**
```ts
type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: DataTableRow<T>[];
  thresholds: Record<string, { target: number; direction: "up" | "down"; warningBandPct?: number }>;
  userPreferencesKey: string;         // "/admin/facilities", "/admin/incidents", etc.
  onRowOpenPanel: (id: string) => void;
  onRowOpenNewTab: (id: string) => void;
  onCustomize: () => void;
  onExport: (format: "csv" | "xlsx" | "pdf") => Promise<void>;
  emptyState?: React.ReactNode;
  loadingState?: "skeleton" | "shimmer";
};

type DataTableColumn<T> = {
  id: string;
  header: string;
  accessor: (row: T) => unknown;
  render?: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
  width?: number | string;
  sortable?: boolean;
  sticky?: boolean;
  numeric?: boolean;          // triggers tabular-nums + threshold color rule
  metricKey?: string;         // matches thresholds key
};

type DataTableRow<T> = {
  id: string;
  data: T;
  status?: "ok" | "warning" | "critical";
  statusTooltip?: string;     // required when status != "ok"
};
```

**`<PriorityAlertStack>`**
```ts
type AlertItem = {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  facilityId: string;
  facilityName: string;
  body: string;               // e.g., "Falls with injury reported"
  openedAt: string;           // ISO
  status: "new" | "action" | "review";
  actions: {
    ack: { visible: boolean; onClick: () => void };     // writes audit log + closes
    details: { visible: boolean; href: string };        // deep-link preserves scope
  };
};
```
Constraint: ACK must write to `alert_audit_log` within the same transaction as state change. See §7.

---

## 5. Page Templates

Eight templates. Every `/admin/*` route picks exactly one.

| # | Template | When to use |
|---|---|---|
| T1 | Dashboard | Role home pages, module command centers. 6 KPI tiles, 2×2 panel grid, DataTable, right rail (PriorityAlertStack + ActionQueue). |
| T2 | List / Queue | Filtered dense tables with optional side-panel detail. Bulk actions, sticky header. |
| T3 | Entity Detail | Single-record deep-dive. Entity header + tabs + right rail activity timeline. |
| T4 | Analytics | Charts-first (Recharts). Filter bar, 1–2 full-width charts, supporting KPI strip, breakdown table, export toolbar. |
| T5 | Form / Wizard | Data entry. Step indicator, single-column 12-grid form, right-rail audit log, sticky save bar. |
| T6 | Settings / Admin | Left sub-nav + stacked form panels, save-pending indicator. |
| T7 | Document Viewer | Document pane + metadata + activity rail + annotation toolbar. |
| T8 | Inbox / Threaded | Queue list + thread detail + context rail. |

### 5.1 Template region specs

Each template has a canonical JSX skeleton committed at `src/design-system/templates/T<N>.tsx`. Migrations import the template, not the primitives individually, to guarantee region placement.

Example (T1):

```tsx
// src/design-system/templates/T1Dashboard.tsx
export function T1Dashboard(props: T1Props) {
  return (
    <PageShell
      title={props.title}
      subtitle={props.subtitle}
      scope={<ScopeSelector />}
      filters={<FilterBar {...props.filters} />}
      actions={<><ResetViewButton /><SaveViewButton /></>}
      rightRail={
        <>
          <PriorityAlertStack items={props.alerts} />
          <ActionQueue items={props.actions} />
        </>
      }
    >
      <KPIStrip tiles={props.kpis} />           {/* exactly 6 */}
      <PanelGrid panels={props.panels} />        {/* 2×2 */}
      <DataTable {...props.table} />
    </PageShell>
  );
}
```

---

## 6. Page Inventory — Template Map

Verify against actual route list in `FRONTEND-CONTRACT.md §2` before Engineer handoff. Pages not yet present are marked `future`.

| # | Route | Template | Priority |
|---|---|---|---|
| 1 | `/admin` | T1 | P0 (reference) |
| 2 | `/admin/executive` | T1 | P0 |
| 3 | `/admin/executive/standup` | T4 | P0 |
| 4 | `/admin/executive/alerts` | T2 | P0 |
| 5 | `/admin/executive/reports` | T4 | P1 |
| 6 | `/admin/executive/benchmarks` | T4 | P1 |
| 7 | `/admin/executive/entity` | T2 | P1 |
| 8 | `/admin/executive/entity/[id]` | T3 | P1 |
| 9 | `/admin/executive/facility/[id]` | T3 | P0 |
| 10 | `/admin/executive/nlq` | T8 variant | P2 |
| 11 | `/admin/executive/scenarios` | T4 | P2 |
| 12 | `/admin/executive/settings` | T6 | P2 |
| 13 | `/admin/residents` | T2 | P0 |
| 14 | `/admin/residents/[id]` | T3 | P0 |
| 15 | `/admin/residents/new` | T5 | P1 |
| 16 | `/admin/residents/[id]/care-plan` | T3 | P1 |
| 17 | `/admin/rounding` | T1 | P0 |
| 18 | `/admin/rounding/live` | T2 | P0 |
| 19 | `/admin/rounding/watches` | T2 | P1 |
| 20 | `/admin/rounding/escalations` | T2 | P1 |
| 21 | `/admin/rounding/integrity` | T4 | P2 |
| 22 | `/admin/rounding/plans` | T2 | P1 |
| 23 | `/admin/rounding/plans/[id]` | T3 | P1 |
| 24 | `/admin/rounding/reports` | T4 | P2 |
| 25 | `/admin/quality` | T1 | P0 |
| 26 | `/admin/quality/measures/new` | T5 | P1 |
| 27 | `/admin/admissions` | T2 | P0 |
| 28 | `/admin/admissions/[id]` | T3 | P1 |
| 29 | `/admin/admissions/new` | T5 | P1 |
| 30 | `/admin/discharge` | T2 | P1 |
| 31 | `/admin/discharge/[id]` | T3 | P2 |
| 32 | `/admin/discharge/new` | T5 | P2 |
| 33 | `/admin/referrals` | T2 | P1 |
| 34 | `/admin/referrals/[id]` | T3 | P2 |
| 35 | `/admin/referrals/new` | T5 | P2 |
| 36 | `/admin/referrals/sources` | T2 | P2 |
| 37 | `/admin/referrals/hl7-inbound` | T2 | P2 |
| 38 | `/admin/reputation` | T1 | P2 |
| 39 | `/admin/reputation/integrations` | T6 | P2 |
| 40 | `/admin/search` | T2 | P2 |
| 41 | `/admin/assessments/overdue` | T2 | P1 |
| 42 | (Staffing hub) | T1 | P0 |
| 43 | (Staffing shift board) | T2 | P1 |
| 44 | (Staff directory) | T2 | P1 |
| 45 | (Staff detail) | T3 | P1 |
| 46 | (Finance hub) | T1 | P0 |
| 47 | (Finance labor analytics) | T4 | P1 |
| 48 | (Finance revenue) | T4 | P1 |
| 49 | (Finance claims) | T2 | P1 |
| 50 | (Incident list) | T2 | P0 |
| 51 | (Incident detail) | T3 | P0 |
| 52 | (New incident) | T5 | P1 |
| 53 | (eMAR variance) | T2 | P0 |
| 54 | (Documents list) | T2 | P1 |
| 55 | (Document viewer) | T7 | P2 |
| 56 | (Tasks) | T2 | P1 |
| 57 | (Task detail) | T3 | P2 |
| 58 | (Communications inbox) | T8 | P2 |
| 59 | (Users & Roles) | T6 | P1 |
| 60 | (Integrations) | T6 | P2 |
| 61 | (Thresholds) | T6 | P1 |
| 62 | (Org structure) | T6 | P2 |
| 63 | (Audit Log) | T2 | P1 |
| 64 | (Copilot full-page) | T8 variant | P2 |

Total: 64 routes, 8 templates, 14 primitives.

---

## 7. Data Model

V2 introduces two new tables. Both are admin-scoped; caregivers do not read or write.

### 7.1 `user_dashboard_preferences`

```sql
create table public.user_dashboard_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dashboard_id text not null,                         -- '/admin', '/admin/executive', etc.
  column_order text[] not null default '{}',
  column_visibility jsonb not null default '{}'::jsonb,
  saved_views jsonb not null default '[]'::jsonb,     -- [{id, name, filters, createdAt}]
  updated_at timestamptz not null default now(),
  unique (user_id, dashboard_id)
);

alter table public.user_dashboard_preferences enable row level security;

create policy "users manage own preferences"
  on public.user_dashboard_preferences
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index udp_user_dashboard_idx
  on public.user_dashboard_preferences (user_id, dashboard_id);
```

### 7.2 `facility_metric_targets`

```sql
create table public.facility_metric_targets (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  metric_key text not null,                             -- 'occupancy_pct', 'labor_cost_pct', 'incidents_per_1k', 'survey_readiness_pct', 'open_incidents', 'staffing_severity'
  target_value numeric not null,
  direction text not null check (direction in ('up','down')),  -- 'up' = higher is better
  warning_band_pct numeric not null default 10,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  unique (facility_id, metric_key)
);

alter table public.facility_metric_targets enable row level security;

create policy "read by facility membership"
  on public.facility_metric_targets for select
  using (
    exists (
      select 1 from public.user_facility_access uf
      where uf.user_id = auth.uid() and uf.facility_id = facility_metric_targets.facility_id
    )
  );

create policy "write by org_admin or owner"
  on public.facility_metric_targets for all
  using (public.has_role(auth.uid(), 'owner') or public.has_role(auth.uid(), 'org_admin'))
  with check (public.has_role(auth.uid(), 'owner') or public.has_role(auth.uid(), 'org_admin'));

create index fmt_facility_metric_idx
  on public.facility_metric_targets (facility_id, metric_key);
```

### 7.3 `alert_audit_log` (extends existing audit infrastructure if present)

```sql
create table if not exists public.alert_audit_log (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null,
  action text not null check (action in ('ack','detail_open','escalate','dismiss','assign')),
  actor_id uuid not null references auth.users(id),
  actor_role text not null,
  facility_id uuid not null references public.facilities(id),
  note text,
  created_at timestamptz not null default now()
);

alter table public.alert_audit_log enable row level security;

create policy "read by facility membership"
  on public.alert_audit_log for select
  using (
    exists (
      select 1 from public.user_facility_access uf
      where uf.user_id = auth.uid() and uf.facility_id = alert_audit_log.facility_id
    )
  );

create policy "insert by authenticated with membership"
  on public.alert_audit_log for insert
  with check (
    auth.uid() = actor_id
    and exists (
      select 1 from public.user_facility_access uf
      where uf.user_id = auth.uid() and uf.facility_id = alert_audit_log.facility_id
    )
  );

create index aal_facility_idx on public.alert_audit_log (facility_id, created_at desc);
create index aal_actor_idx    on public.alert_audit_log (actor_id, created_at desc);
```

**Security review:** §7 tables follow the existing `user_facility_access` + `has_role()` pattern from `PHASE1-RLS-VALIDATION-RECORD.md`. No new auth primitives introduced.

### 7.4 Server API

All V2 reads go through Next.js route handlers under `src/app/api/v2/*`:

- `GET /api/v2/preferences?dashboardId=…` → `user_dashboard_preferences` row for `auth.uid()`.
- `PUT /api/v2/preferences` → upsert.
- `GET /api/v2/thresholds?facilityId=…&metrics=a,b,c` → thresholds map.
- `POST /api/v2/alerts/[id]/ack` → transactional update + audit insert.
- `GET /api/v2/dashboards/[dashboardId]` → canonical dashboard payload (kpis, panels, alerts, actions, rows, thresholds) in a single call.

TanStack Query keys: `["v2","preferences",dashboardId]`, `["v2","dashboard",dashboardId,scope]`, `["v2","thresholds",facilityId,metrics]`.

---

## 8. Routing + Feature Flag

**Feature flag:** `NEXT_PUBLIC_UI_V2` (Netlify env). `true` in staging; `false` in production until W6.

**Flag surface:** `src/lib/flags.ts` exports `uiV2(): boolean`. Middleware rewrites `/admin/*` to `/admin/v2/*` when flag is on AND the specific route has a V2 implementation (`src/app/(admin)/v2/<segment>/page.tsx`). Routes without V2 impl fall through to current (V1) components.

**Route namespace:** V2 does not introduce new URLs. All V2 pages mount at the same `/admin/<segment>` URL; the flag chooses which component renders. Deep links stay stable.

**Scope preservation:** `useScope()` hook (see `src/lib/scope.ts`) reads/writes `owner`, `group`, `facility` (repeatable), `start`, `end` search params. Every navigation that changes scope uses `router.replace` with new params. Every link component (`<Link>`) in V2 primitives auto-appends current scope params unless explicitly overridden.

**`useScope()` contract:**
```ts
const [scope, setScope] = useScope();
// scope: { ownerId?, groupId?, facilityIds?, dateRange? }
// setScope(partial) merges + replaces URL
```

---

## 9. Rollout Plan (6 Weeks)

All work happens on branch `ui-v2`. PRs merge to `ui-v2` only. `ui-v2` rebases on `main` weekly. Final merge to `main` at end of W6 after TRACK-A closeout sign-off.

**W0 — Foundation (no page migrations)**
- Spec approved. Approval evidence: `docs/specs/UI-V2-W0-APPROVAL.md` committed to git with all §4 boxes checked, signed, and timestamped. Audit query: `git log -1 --format=%ai docs/specs/UI-V2-W0-APPROVAL.md` + `grep -c "^- \[x\]" docs/specs/UI-V2-W0-APPROVAL.md` returns ≥ 8.
- `tokens.ts` + `tailwind.config.ts` updated.
- 14 primitives built in `src/design-system/components/`, each with Storybook + Vitest + axe test.
- `PageShell`, all 8 template skeletons under `src/design-system/templates/`.
- Migrations `user_dashboard_preferences`, `facility_metric_targets`, `alert_audit_log` applied to staging.
- Feature flag wired.
- Lint rules `no-raw-color`, `no-raw-spacing`, `require-kpi-info` enforced on CI.
- `.github/PULL_REQUEST_TEMPLATE/ui-v2.md` committed.
- `scripts/agent-gates/sentry-smoke.mjs` committed; `npm run smoke:sentry` script wired; `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` set in Netlify env.
- `scripts/agent-gates/ui-v2-issue-acceptance.mjs` committed and wired into `run-segment-gates.mjs` for the `UI-V2-*` segment family.
- Paperclip → GitHub issue mirror live (CEO workflow creates GH issues with label `ui-v2` on every Paperclip UI-V2 issue).
- **Gate:** primitives ship independently; no page change yet. Gate evidence: `npm run segment:gates -- --segment UI-V2-W0` writes `test-results/agent-gates/*-UI-V2-W0.json` with `verdict: "PASS"` and every `required: true` check at `status: "passed"`.

**W1 — P0 Dashboards (4 pages)**
Routes: `/admin`, `/admin/executive`, `/admin/quality`, `/admin/rounding`. Also `(Finance hub)` and `(Staffing hub)` if those routes exist.
- **Gate:** one Supabase view per dashboard returning the full T1 payload in a single call.

**W2 — P0 List + Detail pairs (6+ pages)**
Routes: `/admin/residents`, `/admin/residents/[id]`, `/admin/executive/alerts`, `/admin/rounding/live`, `/admin/admissions`, `(Incident list)`, `(Incident detail)`, `(eMAR variance)`.
- **Gate:** scope preserved on list→detail navigation. Row-status tooltips defined for every status ≠ ok.

**W3 — P0 Analytics + remaining P0**
Routes: `/admin/executive/standup`, `/admin/executive/facility/[id]`, `/admin/quality` sub-analytics.
- **Gate:** SeverityChip renders identically across all three dashboards (Command, Executive, Quality).

**W4 — P1 Analytics + Forms (10+ pages)**
Routes: `/admin/executive/reports`, `/admin/executive/benchmarks`, `/admin/residents/new`, `/admin/residents/[id]/care-plan`, `/admin/admissions/new`, `/admin/admissions/[id]`, `(Finance labor)`, `(Finance revenue)`.
- **Gate:** export pipeline works CSV / XLSX / PDF from one Edge Function.

**W5 — P1 Settings + remaining Lists (12+ pages)**
Routes: `/admin/assessments/overdue`, `/admin/rounding/watches`, `/admin/rounding/escalations`, `/admin/rounding/plans`, `(Users & Roles)`, `(Thresholds)`, `(Audit Log)`, `(Documents list)`, `(Tasks)`, `(Claims)`, `(Staff directory)`, `(Staff detail)`.
- **Gate:** thresholds UI in `(Thresholds)` drives red-callout across all T1 and T2 pages.

**W6 — P2 cleanup + flag removal**
Remaining P2 routes. Kill V1 components. Remove feature flag. Delete legacy stylesheets.
- **Gate:** zero V1 admin imports remain. Bundle size diff report posted.

---

## 10. Acceptance Criteria

### 10.0 Evidence sources (locked)

All per-page and per-release acceptance checks read from exactly these sources. No other evidence path is authoritative.

| Evidence class | Canonical source | Audit query |
|---|---|---|
| Per-segment gate result | `test-results/agent-gates/*-UI-V2-*.json` | latest matching file has `verdict: "PASS"` and every `required: true` check at `status: "passed"` |
| Per-page acceptance checklist | GitHub issue body (label `ui-v2`, title prefix `[UI-V2-W<N>-<PAGE>]`) | `gh issue list --label ui-v2 --state all --json number,title,state,body` — no closed issue body contains `- [ ]` |
| V1→V2 recording | GitHub PR body using template `.github/PULL_REQUEST_TEMPLATE/ui-v2.md` | `gh pr view <pr> --json body \| jq -r .body \| grep -Ei '(loom\|\.mp4\|\.mov\|user-attachments)'` — ≥ 1 match |
| Sentry 10-min smoke | `scripts/agent-gates/sentry-smoke.mjs` → gate JSON | gate file contains check `id: "smoke.sentry"` with `status: "passed"` |
| Screenshot diffs | `playwright/snapshots/{v1,v2}/<route>.png` | both paths exist and axe report shows zero violations |
| Spec approval (W0 only) | `docs/specs/UI-V2-W0-APPROVAL.md` | committed; §4 has ≥ 8 checked boxes; signature block populated |

### 10.1 Per-page criteria

Every per-page migration issue (`[UI-V2-W<N>-<PAGE>]`, label `ui-v2`) must tick the following boxes in its GitHub issue body before close. These map to the evidence sources in §10.0.

1. Uses exactly one template (T1–T8). *(GH issue body)*
2. All colors/spacing via tokens; CI `no-raw-color`/`no-raw-spacing` pass. *(gate JSON — check id `lint.no-raw-color` + `lint.no-raw-spacing`)*
3. Storybook story committed with `loaded`, `empty`, `error` states. *(gate JSON — check id `storybook.states`)*
4. Vitest snapshot + axe-core accessibility test pass (WCAG AA). *(gate JSON — check id `qa.vitest` + `qa.axe`)*
5. Keyboard navigable: tab through every interactive element; focus ring visible; skip-to-content link present. *(Playwright snapshot + GH issue checkbox)*
6. Every `ⓘ` icon has a defined tooltip contract string. *(gate JSON — check id `lint.require-kpi-info`)*
7. Red-callout numeric cells source thresholds from `facility_metric_targets`. *(GH issue checkbox + code grep check `lint.threshold-source`)*
8. Scope preserved across nav. *(Playwright smoke `e2e.scope-preservation`)*
9. `<AuditFooter>` present with Audit Trail link + Live indicator. *(GH issue checkbox)*
10. Copilot suggestions (if present on page) carry full citation record. *(GH issue checkbox; N/A allowed if page does not use Copilot)*
11. V1 → V2 recording posted in PR body per template. *(PR body grep, §10.0 row 3)*
12. No unresolved Sentry issues for the release SHA during 10-minute smoke window. *(`smoke.sentry` check, §10.0 row 4)*

### 10.2 Per-release criteria (W6 merge gate)

- Lighthouse performance ≥ 85 on all P0 pages. *(gate id `perf.lighthouse-p0`)*
- Axe-core: zero violations on all admin routes. *(gate id `qa.axe-full`)*
- Playwright smoke: scope preservation, alert ACK audit trail, export, customize column persistence. *(gate id `e2e.ui-v2-smoke`)*
- Bundle size: V2 ≤ V1 + 10%. *(gate id `perf.bundle-diff`)*
- Rollback migration tested on staging. *(gate id `db.rollback-dry-run`)*
- Zero Sentry issues for the release SHA during 30-minute post-deploy window. *(gate id `smoke.sentry-release`, window override `SENTRY_SMOKE_WINDOW_MIN=30`)*

---

## 11. Authorization Matrix

| Capability | owner | org_admin | facility_admin | nurse | caregiver | finance | compliance | family |
|---|---|---|---|---|---|---|---|---|
| View V2 admin shell | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| See Priority Alert Stack | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| ACK high-severity incident | ✅ | ✅ | ✅ | ✅ (clinical only) | ❌ | ❌ | ✅ (compliance only) | ❌ |
| Edit `facility_metric_targets` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Save `user_dashboard_preferences` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| Access Copilot | ✅ | ✅ | ✅ | ✅ (read-only) | ❌ | ✅ | ✅ | ❌ |
| See Audit Log page | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| Export to PDF/XLSX/CSV | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |

Enforced by Next.js middleware role check + Supabase RLS on every query.

---

## 12. Rollback Migration

**File:** `supabase/migrations/YYYYMMDDHHMMSS_rollback_ui_v2.sql`

```sql
-- Rollback order: drop policies → drop indexes → drop tables.
drop policy if exists "users manage own preferences" on public.user_dashboard_preferences;
drop policy if exists "read by facility membership"   on public.facility_metric_targets;
drop policy if exists "write by org_admin or owner"   on public.facility_metric_targets;
drop policy if exists "read by facility membership"   on public.alert_audit_log;
drop policy if exists "insert by authenticated with membership" on public.alert_audit_log;

drop index if exists public.udp_user_dashboard_idx;
drop index if exists public.fmt_facility_metric_idx;
drop index if exists public.aal_facility_idx;
drop index if exists public.aal_actor_idx;

drop table if exists public.alert_audit_log;
drop table if exists public.facility_metric_targets;
drop table if exists public.user_dashboard_preferences;
```

**Flag rollback:** set `NEXT_PUBLIC_UI_V2=false` in Netlify; redeploy. All routes fall through to V1.

**Code rollback:** revert PR merging `ui-v2` → `main`. V2 primitives + templates remain in tree but unreferenced.

---

## 13. Effort Estimate

| Phase | Engineer-days | QA-days | DevOps-days | Security-days |
|---|---|---|---|---|
| W0 Foundation | 10 | 3 | 2 | 1 |
| W1 P0 Dashboards | 8 | 3 | 1 | 1 |
| W2 P0 List+Detail | 10 | 4 | 0 | 1 |
| W3 P0 Analytics | 8 | 3 | 0 | 0 |
| W4 P1 Analytics+Forms | 12 | 4 | 1 | 1 |
| W5 P1 Settings+Lists | 14 | 4 | 0 | 1 |
| W6 P2 + Cleanup | 10 | 3 | 2 | 1 |
| **Total** | **72** | **24** | **6** | **6** |

Assumes 1 Architect + 2 Engineers + 1 QA + DevOps and Security part-time. Timeline 6 calendar weeks with 20% buffer = 7.2 weeks worst case.

---

## 14. ADRs

**ADR-001: Dark-only Admin shell.**
Context: DON/COO use Haven during overnight, low-light shifts; CRT-style dashboards reduce fatigue.
Decision: V2 Admin shell is dark only. No light-mode variant. Caregiver (Shell B) and Family (Shell D) keep their existing modes.
Consequences: Token palette is dark-first. Shadcn components themed for dark. Printed exports auto-invert via PDF renderer theme.

**ADR-002: Templates over component composition.**
Context: Engineers who build pages directly from primitives drift (inconsistent region placement, spacing).
Decision: 8 templates are the only legal entry for a V2 page. Primitives are private to templates except inside custom panels.
Consequences: New page variants require a new template or a new panel, not primitive rewiring. Design review is template-review.

**ADR-003: Threshold-driven color, not per-page rules.**
Context: Red-callout inconsistency across V1 (6 incidents red on one page, 4 not red on another).
Decision: All numeric cell coloring reads `facility_metric_targets`. Pages cannot override.
Consequences: Thresholds are an explicit data object owned by org_admin; changing a threshold is audited.

**ADR-004: Copilot requires citations.**
Context: Mission gate — AI subordinate to human judgment, auditability.
Decision: `<CopilotButton>` drawer refuses to render suggestions without `citations[]`.
Consequences: Server must attach citations to every suggestion. No "general advice" surface.

**ADR-005: Scope lives in URL.**
Context: Zustand-only scope breaks deep links, shared URLs, and browser back button.
Decision: Scope is URL search params. Zustand mirrors URL for ergonomic reads but is not source of truth.
Consequences: Every `<Link>` auto-appends scope. URL gets long; acceptable tradeoff for link integrity.

---

## 15. Paperclip Issue Tree

```
UI-V2 OVERHAUL (epic)
├─ UI-V2-SPEC   Approve spec doc                                        → Architect
├─ UI-V2-01     Tokens + Tailwind config                                → Engineer
├─ UI-V2-02     PageShell + TopBar + LeftNav adapter for AdminShell     → Engineer
├─ UI-V2-03     ScopeSelector + useScope hook                           → Engineer
├─ UI-V2-04     FilterBar (date, facility, region, status, save view)   → Engineer
├─ UI-V2-05     KPITile + TrendDelta + Sparkline                        → Engineer
├─ UI-V2-06     Panel + PanelGrid                                       → Engineer
├─ UI-V2-07     PriorityAlertStack + alert ACK API                      → Engineer + Security
├─ UI-V2-08     ActionQueue                                             → Engineer
├─ UI-V2-09     DataTable (thresholds, customize, export, preferences)  → Engineer
├─ UI-V2-10     SeverityChip + HealthDot                                → Engineer
├─ UI-V2-11     AuditFooter                                             → Engineer
├─ UI-V2-12     CopilotButton + CopilotDrawer (cite-backed only)        → Engineer + AI
├─ UI-V2-13     Template skeletons T1–T8                                → Engineer
├─ UI-V2-14     user_dashboard_preferences migration + RLS              → Engineer (DB) + Security
├─ UI-V2-15     facility_metric_targets migration + RLS                 → Engineer (DB) + Security
├─ UI-V2-16     alert_audit_log migration + RLS                         → Engineer (DB) + Security
├─ UI-V2-17     API /api/v2/preferences                                 → Engineer
├─ UI-V2-18     API /api/v2/thresholds                                  → Engineer
├─ UI-V2-19     API /api/v2/dashboards/[id]                             → Engineer
├─ UI-V2-20     API /api/v2/alerts/[id]/ack                             → Engineer + Security
├─ UI-V2-21     Feature flag NEXT_PUBLIC_UI_V2 + middleware             → DevOps
├─ UI-V2-22     Lint rules no-raw-color / no-raw-spacing / require-kpi-info → Engineer
├─ UI-V2-23     Storybook + axe-core + Vitest scaffolds                 → QA
├─ UI-V2-24     Playwright smoke pack                                   → QA
├─ UI-V2-W1-*   Migrate P0 dashboards (4 issues, 1 per page)            → Engineer ×4
├─ UI-V2-W2-*   Migrate P0 list+detail (8 issues)                       → Engineer ×4
├─ UI-V2-W3-*   Migrate P0 analytics (3 issues)                         → Engineer ×3
├─ UI-V2-W4-*   Migrate P1 analytics+forms (10 issues)                  → Engineer ×5
├─ UI-V2-W5-*   Migrate P1 settings+lists (12 issues)                   → Engineer ×6
├─ UI-V2-W6-*   Migrate P2 + cleanup (17 issues)                        → Engineer ×8
├─ UI-V2-SEC    Security review of §7 tables + §8 flag path             → Security
├─ UI-V2-QA     Final QA pass (a11y, perf, smoke, bundle size)          → QA
└─ UI-V2-SHIP   Remove flag, merge to main, delete V1                   → DevOps
```

### 15.1 Per-page migration issue template

```
Title: UI-V2-W<N>-<PAGE> · Migrate <ROUTE> to UI V2 (Template <TX>)
Manager: Engineering
Inputs:
  - docs/specs/UI-V2-DESIGN-SYSTEM.md
  - docs/specs/FRONTEND-CONTRACT.md
  - docs/specs/UX-OVERHAUL-ROADMAP.md
  - Current V1 component at src/components/<area>/<name>PageClient.tsx
Deliverables:
  1. New V2 component at src/app/(admin)/v2/<segment>/page.tsx that imports T<X>
  2. V2 route gated by uiV2() flag via middleware
  3. Storybook story (loaded | empty | error)
  4. Vitest snapshot + axe-core a11y test
  5. Loom comparing V1 vs V2
  6. CI green: no-raw-color, no-raw-spacing, require-kpi-info
Acceptance:
  - All §10 per-page criteria met
  - Scope preserved through nav
  - Tooltips defined on every ⓘ icon
  - Red-callout numerics source from facility_metric_targets
  - AuditFooter visible
Out of scope:
  - New data model changes (open a separate issue)
  - Module-logic refactors (pure visual/component migration only)
```

---

## 16. Open Questions

1. Does TRACK-A closeout complete before or during W0? If during, W0 work stays on `ui-v2` branch without merge.
2. Where do `(Staffing hub)`, `(Finance hub)` routes mount? `FRONTEND-CONTRACT.md §2` needs those appended before W1.
3. Confirm `user_facility_access` and `has_role()` functions exist as assumed in §7 RLS policies. If named differently, §7 policies need a find/replace pass before apply.
4. Is there an existing `facilities.id` FK target in use by other tables? §7.2 assumes `public.facilities(id)`.
5. Copilot suggestion source — which service/model produces them, and where does `citations[]` originate? Required input for UI-V2-12.

Answers to §16 belong in a comment block at the top of this file before W0 kicks off.

---

## 17. References

- `docs/specs/FRONTEND-CONTRACT.md` — canonical stack + routing
- `docs/specs/UX-OVERHAUL-ROADMAP.md` — UX principles + nav collapse
- `docs/specs/UI-DESIGN-DECISIONS.md` — shell architecture
- `docs/specs/24-executive-intelligence.md` — Module 24 V1 (reference baseline)
- `docs/specs/24-executive-v2.md` — Module 24 V2 (analytics extensions)
- `docs/specs/TRACK-A-CLOSEOUT-ROADMAP.md` — gate for V2 merge to main
- `docs/specs/PHASE1-RLS-VALIDATION-RECORD.md` — RLS pattern precedent
- `src/components/ui/moonshot/v2-card.tsx` — existing `V2Card` primitive (compose, don't duplicate)
- `src/components/ui/kinetic-grid.tsx` — existing `KineticGrid` primitive (panel grid source)
- `src/components/layout/AdminShell.tsx` — host shell V2 mounts inside

End of spec.
