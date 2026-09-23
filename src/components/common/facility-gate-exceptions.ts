/**
 * COL-651 exceptions for `FacilityGate.guard.test.ts`.
 *
 * Every page that needs one facility now renders `<FacilityGate>`; the
 * per-area conversion ratchet is finished and gone. Copy that matches the
 * guard's pattern is allowed only in the files below — a form's own facility
 * field, or a builder that asks for a building among other inputs — each with
 * the reason it is not a page gate.
 */

export const NOT_A_GATE: Record<string, string> = {
  "src/app/(admin)/reports/run/[sourceType]/[id]/page.tsx":
    "The run form's own facility-scope field (a report may run for one building or, for owners, all of them); it follows the header and no longer defaults to the first facility.",
  "src/app/(admin)/admin/operations/templates/page.tsx":
    "Validation for a template's own facility field: org-wide templates need none, facility-scoped ones pick one in the form.",
  "src/app/(admin)/admin/rounding/reports/page.tsx":
    "The report builder asks for a building alongside its date range; it is a form input, not a page gate.",
  "src/app/(admin)/finance/journal-entries/new/page.tsx":
    "A journal entry's own facility field: entries may post at entity level, and facility admins must pick one.",
  "src/components/layout/AppShell.tsx":
    "The survey-visit tools in the shell menu, which sits beside the header selector itself.",
  "src/lib/v2-forms.ts": "Validation message for a form's own required facility field.",
  // COL-649 MetricState: a KPI tile's "no scope" state, not a page gate. Pages still gate with <FacilityGate>.
  "src/lib/assessments/overdue-assessments-display-copy.ts":
    "Empty-queue copy for the Clinical Desk's needs-facility state; the page's gate is the source notice.",
  "src/lib/clinical/clinical-queue-state.ts": "Doc comment on the needs_facility queue state.",
  "src/lib/metrics/metric-state.ts": "Defines the KPI tile label for the no-facility-scope metric state.",
  "src/components/ui/kpi-card.tsx": "Doc comment listing MetricState phrases the card renders.",
  "src/components/ui/stat-card.tsx": "Doc comment listing MetricState phrases the card renders.",
  "src/design-system/components/KPITile/KPITile.tsx": "Doc comment listing MetricState phrases the tile renders.",
};
