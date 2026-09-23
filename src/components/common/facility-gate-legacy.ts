/**
 * COL-651 ratchet for `FacilityGate.guard.test.ts`.
 *
 * `LEGACY_FACILITY_GATES` lists files that still carry their own "select a
 * facility" dead end. It may only shrink: convert a file to `<FacilityGate>`
 * and delete its line here (the guard fails while a converted file is still
 * listed). Each audit area has its own list so parallel conversions do not
 * collide.
 *
 * `NOT_A_GATE` is for copy that matches the pattern but is not a page gate —
 * a form's own facility field, or a builder that asks for a building among
 * other inputs. Say why.
 */

export const LEGACY_FACILITY_GATES: Record<string, readonly string[]> = {
  "b1-executive": [],

  "b2-money": [],

  "b3-operations": [],

  "b4-clinical": [
    "src/app/(admin)/admin/dietary/clinical-review/page.tsx",
    "src/app/(admin)/admin/dietary/new/page.tsx",
    "src/app/(admin)/admin/family-messages/page.tsx",
    "src/app/(admin)/admin/family-portal/page.tsx",
    "src/app/(admin)/admin/infection-control/new/page.tsx",
    "src/app/(admin)/admin/infection-control/staff-illness/new/page.tsx",
    "src/app/(admin)/admin/infection-control/staff-illness/page.tsx",
    "src/app/(admin)/admin/medications/controlled/page.tsx",
    "src/app/(admin)/admin/medications/errors/new/page.tsx",
    "src/app/(admin)/admin/medications/verbal-orders/new/page.tsx",
    "src/app/(admin)/admin/medications/verbal-orders/page.tsx",
    "src/app/(admin)/admin/rounding/watchlist/[residentId]/page.tsx",
    "src/components/dietary/AdminDietaryPageClient.tsx",
    "src/components/medication/ResidentSelector.tsx",
    "src/lib/admin/family-messages-data.ts",
    "src/lib/assessments/load-overdue-assessments.ts",
    "src/lib/family/family-portal-admin-display-copy.ts",
    "src/lib/medications/load-medication-errors.ts",
    "src/lib/rounding/live-board-display-copy.ts",
    "src/lib/rounding/monitoring-orders-display-copy.ts",
    "src/lib/rounding/rounding-scope-copy.ts",
  ],

  "b5-compliance": [
    "src/app/(admin)/admin/compliance/audit-export/page.tsx",
    "src/app/(admin)/admin/compliance/deficiencies/analysis/page.tsx",
    "src/app/(admin)/admin/compliance/deficiencies/new/page.tsx",
    "src/app/(admin)/admin/compliance/emergency-preparedness/page.tsx",
    "src/app/(admin)/admin/compliance/policies/new/page.tsx",
    "src/app/(admin)/admin/compliance/policies/page.tsx",
    "src/app/(admin)/admin/compliance/rules/new/page.tsx",
    "src/app/(admin)/admin/compliance/rules/page.tsx",
    "src/app/(admin)/admin/compliance/scan/page.tsx",
    "src/app/(admin)/admin/quality/measures/new/page.tsx",
    "src/app/(admin)/admin/quality/page.tsx",
    "src/app/(admin)/admin/survey-binder/page.tsx",
    "src/app/(admin)/reports/run/[sourceType]/[id]/page.tsx",
    "src/app/(admin)/reputation/accounts/new/page.tsx",
    "src/app/(admin)/reputation/page.tsx",
    "src/app/(admin)/reputation/replies/new/page.tsx",
    "src/components/compliance/AdminCompliancePageClient.tsx",
    "src/components/risk/RiskSurveyBundlePageClient.tsx",
    "src/lib/compliance/compliance-hub-copy.ts",
    "src/lib/quality/quality-hub-display-copy.ts",
    "src/lib/reputation/reputation-account-new-display-copy.ts",
    "src/lib/reputation/reputation-reply-new-display-copy.ts",
  ],

  "b6-office": [],

  "b7-workforce": [
    "src/app/(admin)/certifications/new/page.tsx",
    "src/app/(admin)/schedules/new/page.tsx",
    "src/app/(admin)/staff/new/page.tsx",
    "src/app/(admin)/staffing/new/page.tsx",
    "src/app/(admin)/time-records/new/page.tsx",
    "src/app/(admin)/time-records/page.tsx",
    "src/app/(admin)/training/completions/new/page.tsx",
    "src/app/(admin)/training/inservice/new/page.tsx",
    "src/app/(admin)/training/new/page.tsx",
    "src/app/(admin)/training/page.tsx",
    "src/components/schedules/AdminSchedulesPageClient.tsx",
    "src/components/staffing/AdminStaffingConsolePageClient.tsx",
    "src/components/timeclock/TimeclockOverview.tsx",
    "src/components/timeclock/UpunchCompare.tsx",
    "src/lib/timeclock/display-copy.ts",
  ],
};

export const NOT_A_GATE: Record<string, string> = {
  "src/app/(admin)/finance/journal-entries/new/page.tsx":
    "A journal entry's own facility field: entries may post at entity level, and facility admins must pick one.",
  "src/app/(admin)/admin/operations/templates/page.tsx":
    "Validation for a template's own facility field: org-wide templates need none, facility-scoped ones pick one in the form.",
  "src/app/(admin)/admin/rounding/reports/page.tsx":
    "The report builder asks for a building alongside its date range; it is a form input, not a page gate.",
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
