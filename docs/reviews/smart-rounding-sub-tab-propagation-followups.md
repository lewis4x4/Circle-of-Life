# Smart Rounding sub-tab propagation follow-ups

Bundle: `smart-rounding-sub-tab-propagation`
Scope completed in this segment: Plans, New Plan, Watches, Escalations, Integrity, Reports, Safety, Insights.

## Cleanup plan used for this segment

1. Confirm shared primitives exist before route edits.
2. Replace route-local Quiet Operator patterns with shared primitives where the Smart Rounding sub-tabs directly consume them.
3. Harden clinical workflows per tab without building new downstream destination surfaces.
4. Add a segment-scoped constitution lint pass and document the linted rules.
5. Produce a full-app debt inventory for later conversion instead of broadening this atomic segment.

## Primitive propagation follow-up audit

`CONSTITUTION_LINT_SCOPE=all npm run lint:constitution` currently reports 1,413 pre-existing findings outside the Smart Rounding segment. Representative conversion queues:

### Shared design-system components

- `src/design-system/components/DataTable/DataTable.tsx` — table headers still use static case/tracking classes; migrate header rendering to `SortableTableHeader` or a design-system equivalent.
- `src/design-system/components/FilterBar/FilterBar.tsx` — native `<select>` remains; migrate to shared `Select`.
- `src/design-system/components/ScopeSelector/ScopeSelector.tsx` — native `<select>` remains; migrate to shared `Select`.
- `src/design-system/templates/T5Form.tsx`, `T7DocumentViewer.tsx`, `T8InboxThreaded.tsx` — static case/tracking header treatment remains.

### Smart Rounding adjacent components out of this segment

- `src/components/rounding/QuickCheckDrawer.tsx` — static case/tracking labels remain; out of scope because Live Board already shipped in the prior segment.
- `src/components/rounding/QuickObservationForm.tsx` — native `<select>` and raw voice-check error copy remain; convert in the next Live Board/quick-check cleanup pass.
- `src/components/rounding/RoundingTaskCard.tsx` — static all-caps badge treatment remains; convert to `StatusPill`/value-derived styling in the Live Board maintenance pass.

### Admin route clusters

- Admissions routes (`src/app/(admin)/admin/admissions/**`) contain repeated static label treatment and native selects. This should become a route-level primitive propagation segment because admissions already uses resident combobox patterns that can be consolidated.
- Compliance routes (`src/app/(admin)/admin/compliance/**`) contain native selects and raw data-layer errors. These are surveyor-facing and should be prioritized after Smart Rounding.
- Dietary routes (`src/app/(admin)/admin/dietary/**`) contain native selects and static badge/header treatments.
- Staffing and schedules components contain static semantic color and all-caps treatments; convert KPI/status surfaces to `MetricCard` and `StatusPill`.

### V2 surfaces

- `src/components/v2/forms/*` and `src/components/v2/settings/ThresholdsEditor.tsx` still render native selects and static caps. Coordinate with the V2 settings threshold work before changing these.

## Safety sub-tab codebase summary

Current Safety sub-tab implementation is a resident-level safety scoring and triage surface. It ranks residents by risk tier, contributing factors, unresolved signals, and trend direction. It is operationally distinct from:

- Escalations: missed or overdue checks requiring resolution.
- Integrity: late, backdated, or edited documentation requiring audit review.

Safety still needs IA confirmation because it can feel adjacent to Escalations if operators interpret “safety” as a missed-check queue rather than a risk-score board.

## Insights sub-tab codebase summary

Current Insights implementation is an AI/analytics finding inbox: severity, resident, supporting metric, evidence, recommendation, acknowledge/snooze/dismiss actions. It is not yet a complete trend dashboard with time-range scoped KPI cards and charted anomalies. Treat the current version as a sparse insights queue until product confirms the intended data model and chart scope.

## Halt conditions surfaced before merge

1. **Watch vs. Monitoring terminology:** confirm whether the sub-tab should remain “Watches” or be renamed “Monitoring.”
2. **New Plan default Status:** this segment defaults new and duplicated plans to Draft. Clinical product should confirm this before merge because it changes Live Board activation behavior.
3. **Safety IA:** decide whether Safety remains a distinct risk-score surface or consolidates with Escalations/Integrity.
4. **Insights scope:** decide whether the current finding inbox is acceptable or whether this needs trend/KPI chart scope before release.
5. **Report types and formats:** only completion CSV generation is currently backed by an endpoint. Other report types are presented as disabled pending backend support.
6. **Severity thresholds:** confirm escalation and integrity thresholds are policy-approved:
   - Escalations: Low 1–2 missed, Medium 3–4, High 5+, Critical 5+ plus high-acuity resident.
   - Integrity lag: <15min neutral, 15–60min amber, >60min red, >24hr red plus alert.
7. **Placeholder destination actions:** “Escalate further” and “Refer to compliance” affordances are wired to placeholder destinations; destination surfaces were intentionally not built in this segment.

## Visual QA baseline checklist

Capture before merge on a live facility scope:

- Plans: empty, populated default-status rows, Draft/Suspended/Expired rows, filtered states.
- New Plan: empty form, partially filled disabled save tooltip, invalid effective window, full valid form, multi-rule plan.
- Watches: empty, pending approval with modal, active/paused/closed rows.
- Escalations: empty, open overdue, resolved today, dismissed, critical high-acuity row.
- Integrity: empty, late entry amber, backdated red, reviewed today, compliance referred placeholder.
- Reports: no generated reports, completion report generated, disabled unsupported report type.
- Safety: empty/no scores, low/moderate/high/critical score set.
- Insights: empty time range, low/medium/high/critical finding set, acknowledged/dismissed filtered states.
