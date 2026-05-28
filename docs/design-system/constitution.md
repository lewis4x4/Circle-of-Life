# Quiet Operator — Aesthetic Constitution

**Project:** Haven ALF Operations  
**Canonical handoff:** `HANDOFFS/2026-05-16__haven-alf-operations__visual-forge-handoff/design-system/constitution.md`

This file adds **repo-local execution rules** that extend the handoff. For the full manifesto, allowed / disallowed feelings, and rules 1–10, read the handoff copy.

## Chrome vs canvas (rule 11)

**Persistent navigation chrome must not share the canvas background value.** Top bars, side rails, bottom tab strips, and other “frame” surfaces use semantic `--chrome-primary`, `--chrome-secondary`, `--chrome-foreground`, `--chrome-foreground-muted`, and `--chrome-active`. The page canvas stays on `bg-background` (warm paper in forced-light admin/family; near-black when `.dark`).

**Hairline junctions:** Where canvas meets chrome, use **`1px solid` `border-border`** (horizontal under top chrome; vertical between rail and main on wide layouts).

**Theme locks:** Chrome variables are tuned per forced theme — operator light + family (forced-light warm canvas) share the deeper chrome bands; caregiver and admin-dark use slightly **lighter** chrome than light-mode defaults so hierarchy holds over a dark canvas.

**Active rail items:** Background `--chrome-active`, **2px** leading edge `var(--primary)`, text/icons `--chrome-foreground`.

## Typography — monospace scope (rule 12)

Monospace is for **code-like values**: UUIDs, license numbers, account numbers, version strings, and ISO timestamps where machine-readability matters.

Monospace is **not** for section labels, metadata labels, category or taxonomy values, audience labels, button text, navigation, or descriptions. When in doubt, use Geist Sans (default body / `font-sans`).

## Value-derived rendering

State-bearing components must derive their visual treatment from their value, not from a static style. Default states render neutrally. Operationally significant deviations render with semantic color.

Examples: `StatusPill` receives `value` and `defaultValue`; `FilterPill` renders muted when inactive with a zero count; `MetricCard` receives thresholds and derives the final tone.

## Data-fetch state machines

Data-loading components have explicit state machines: `idle | loading | error | success-empty | success-populated`. The UI renders exactly one state at a time. Never compound error and empty states.

Error states explain what the operator can do next. Empty states explain the workflow meaning of no current activity.

## User-facing copy

User-facing strings use operator vocabulary. Data-layer terms (source, rows, fetch, query, column, table) never appear in user-visible strings.

Use clinical or operational terms instead: plans, checks, watches, escalations, entries, reports, residents, and facilities.

## Primitives never make decisions on the operator's behalf

Form primitives have no default values unless the consumer explicitly passes one. No primitive-level today-fill, placeholder-as-data, or pre-selected enum dropdowns.

Consumers may set defaults only when the workflow requires it, and the reason should be clear at the call site for time-sensitive clinical events.
