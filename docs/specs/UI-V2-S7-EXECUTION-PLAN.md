# UI-V2 Slice S7 — Templates T1–T8 + W0 closeout

**Parent:** `docs/specs/UI-V2-EXECUTION-HANDOFF.md`
**Spec sections:** UI-V2-DESIGN-SYSTEM.md §5 (Page Templates) + §5.1 (region specs)
**Depends on:** S6 committed (all 14 primitives exist)
**Est. eng-days:** 2

## Goal

Eight page templates exist as composable React components. Every future page (S8–S12) imports a template, not primitives directly. W0 approval record signed; W0 closed.

## Files to deliver

### Templates

- `src/design-system/templates/T1Dashboard.tsx`
- `src/design-system/templates/T2List.tsx`
- `src/design-system/templates/T3EntityDetail.tsx`
- `src/design-system/templates/T4Analytics.tsx`
- `src/design-system/templates/T5Form.tsx`
- `src/design-system/templates/T6Settings.tsx`
- `src/design-system/templates/T7DocumentViewer.tsx`
- `src/design-system/templates/T8InboxThreaded.tsx`
- `src/design-system/templates/index.ts` — barrel export + `TemplateKey = "T1"|...|"T8"` type

### Template stories

One story per template in `src/design-system/templates/<Template>.stories.tsx`. Use DataTable fixtures from S6 + alert fixtures from S5.

### Template tests

- `src/design-system/templates/*.test.tsx` — minimum: renders without error for a stub page, all regions present.
- `src/design-system/templates/*.a11y.spec.ts` — axe-core zero violations per template.

### W0 closeout

- `docs/specs/UI-V2-W0-APPROVAL.md` — §2 open questions resolved (from `UI-V2-DESIGN-SYSTEM.md §16`); §4 boxes ticked; §5 signature block populated with owner name + date + spec SHA from `git log -1 --format=%H docs/specs/UI-V2-DESIGN-SYSTEM.md`.

## Additional requirements

1. Each template takes a typed `T<N>Props` object. Props declare which primitives render into which region (e.g., T1 takes `kpis: KPITileProps[6]`, `panels: PanelProps[4]`, `alerts: AlertItem[]`, `actions: ActionItem[]`, `tableProps: DataTableProps<T>`).
2. Templates enforce region cardinality at the type level (e.g., T1 requires exactly 6 KPI tiles).
3. Templates are the only legal import surface for pages in S8+. ESLint rule `no-direct-primitive-import` is authored this slice: pages under `src/app/(admin)/v2/**` cannot import from `src/design-system/components/**` except when also importing a template (allows incidental re-imports).
4. Every template ends with `<AuditFooter />` — enforced by test (`expect(screen.getByRole("contentinfo", { name: /audit trail/i }))`).

## Gate command

```bash
SKIP_PG_VERIFY=1 npm run segment:gates -- --segment "UI-V2-S7" --ui
```

## Acceptance

- 8 templates + 8 stories + 8 tests + 8 a11y specs committed.
- Each template test asserts required regions render.
- Each a11y spec zero violations.
- `no-direct-primitive-import` ESLint rule passes against a fixture file that imports a primitive without a template (expected to fail lint).
- `UI-V2-W0-APPROVAL.md` §4 has ≥8 boxes ticked; §5 signature populated.
- Re-run W0 gate: `npm run segment:gates -- --segment "UI-V2-W0"` — W0-level gate artifact produced, verdict PASS (closes W0 formally).
- Slice gate JSON PASS at `test-results/agent-gates/*-UI-V2-S7.json`.
- `UI-V2-STATUS.md` S7 box ticked.

## Review hooks

- `agents/playbooks/chief-design-officer-agent.md` — template region + composition review.
- `agents/playbooks/release-gate-agent.md` — W0 closeout sign-off.
- `agents/playbooks/qa-agent.md`.

## Commit message

`feat(ui-v2-s7): templates T1–T8 + W0 closeout [UI-V2-S7]`

## Gotchas

- Type-level region cardinality is awkward in TSX — use a tuple type: `kpis: [KPITileProps, KPITileProps, KPITileProps, KPITileProps, KPITileProps, KPITileProps]`. Template consumers will feel it, which is the point.
- W0 approval signature cannot be backfilled after merge — sign at the time of S7, not retroactively. Owner acknowledges §2 open questions resolved by name in §2 resolution log.
- If any §2 open question is UNRESOLVED at S7 signing time, document the known-unknown in `docs/specs/PHASE1-WAIVER-LOG.md` and proceed. Do not block S7 on Q5 (Copilot source) if S5 used fixture data — defer to when Copilot backend lands.
