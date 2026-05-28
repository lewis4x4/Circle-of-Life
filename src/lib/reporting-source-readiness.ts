export type SourceReadinessAction = {
  title: string;
  description: string;
  href: string;
  ctaLabel: string;
};

export type SourceReadinessCallout = {
  title: string;
  description: string;
  actions: SourceReadinessAction[];
};

export const REVENUE_SOURCE_READINESS: SourceReadinessCallout = {
  title: "Received Revenue depends on payment activity being in Haven",
  description:
    "This view only totals payments already recorded or imported into Haven. It does not backfill from QuickBooks or another external accounting system.",
  actions: [
    {
      title: "Record or import missing receipts",
      description: "Add late cash, check, ACH, or card activity before trusting the monthly received total.",
      href: "/admin/billing/payments/new",
      ctaLabel: "Open payment entry",
    },
    {
      title: "Compare against open invoices",
      description: "Use invoice balances to spot revenue that is billed but not yet reflected here as collected cash.",
      href: "/admin/billing/invoices",
      ctaLabel: "Review invoices",
    },
    {
      title: "Reconcile finance separately",
      description: "Trial balance and external accounting remain separate until finance posting and import workflows are current.",
      href: "/admin/finance/trial-balance",
      ctaLabel: "Open trial balance",
    },
  ],
};

export const REPORTING_SOURCE_READINESS: SourceReadinessCallout = {
  title: "Reporting catalog is live before every source dataset is ready",
  description:
    "Templates, packs, and schedules are available now, but finance-facing output stays partial until invoices, payments, and finance posting or import data are current in Haven. No QuickBooks sync is active on these reporting pages.",
  actions: [
    {
      title: "Validate billing inputs first",
      description: "Financial report runs only reflect invoices and payments that already exist inside Haven.",
      href: "/admin/billing/revenue",
      ctaLabel: "Check received revenue",
    },
    {
      title: "Confirm finance setup",
      description: "Posting rules and GL settings need to be aligned before leadership reports can be treated as accounting-ready.",
      href: "/admin/finance/gl-settings",
      ctaLabel: "Review GL settings",
    },
    {
      title: "Use templates as readiness checks",
      description: "Run the report, then treat missing rows as a source-data gap to fix instead of assuming the organization has no activity.",
      href: "/admin/reports/templates",
      ctaLabel: "Open templates",
    },
  ],
};

export const EXECUTIVE_REPORTING_SOURCE_READINESS: SourceReadinessCallout = {
  title: "Saved executive reports use current Haven source tables only",
  description:
    "CSV, print, and enhanced executive reports use current Haven source tables only. They do not sync from QuickBooks, so missing billing or finance imports will show up here as incomplete financial context.",
  actions: [
    {
      title: "Verify source coverage before export",
      description: "Check that billing payments and finance posting inputs have landed before sending leadership packets.",
      href: "/admin/billing/revenue",
      ctaLabel: "Review revenue inputs",
    },
    {
      title: "Use the reporting hub for audit trail",
      description: "Template history and schedules help show whether a gap is operational timing versus missing data setup.",
      href: "/admin/reports",
      ctaLabel: "Open reporting hub",
    },
  ],
};
