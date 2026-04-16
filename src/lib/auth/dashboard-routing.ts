/**
 * Dashboard routing — maps each role to its landing route and dashboard config.
 * Controls which sections each role sees on the command center.
 */

export interface DashboardConfig {
  /** Landing route for this role */
  route: string;
  /** Which shell to use */
  shell: "admin" | "caregiver" | "family" | "med-tech";
  /** Human-facing role label for dashboards and shell framing */
  roleLabel: string;
  /** Primary task lanes this role should see first */
  primaryTaskLanes: string[];
  /** Ordered first-screen priorities used to shape role homes */
  firstScreenPriority: string[];
  /** Sections or concepts intentionally suppressed from the first screen */
  suppressedSections: string[];
  /** Expected device posture for the role's first-run validation */
  mobileTabletExpectation: "desktop-first" | "phone-first" | "phone-and-tablet";
  /** Nav groups visible in sidebar */
  visibleGroups: string[];
  /** Sections to render on the dashboard page */
  sections: {
    heroStats?: boolean;
    quickActions?: boolean;
    criticalUpdates?: boolean;
    compliance?: boolean;
    financials?: boolean;
    watchlist?: boolean;
    staffing?: boolean;
    incidents?: boolean;
    carePlans?: boolean;
    assessments?: boolean;
    familyMessages?: boolean;
    dietary?: boolean;
    transportation?: boolean;
  };
}

const DASHBOARD_CONFIGS: Record<string, DashboardConfig> = {
  owner: {
    route: "/admin/executive",
    shell: "admin",
    roleLabel: "Owner",
    primaryTaskLanes: ["executive_alerts", "finance", "insurance", "high_severity_incidents", "portfolio_health"],
    firstScreenPriority: ["portfolio_health", "executive_alerts", "finance_risk", "facility_comparison", "drill_ins"],
    suppressedSections: ["facility_operator_backlog", "admissions_queue_noise", "family_triage_queue_noise"],
    mobileTabletExpectation: "desktop-first",
    visibleGroups: ["Command", "Quality & Risk", "Knowledge", "Finance"],
    sections: {
      heroStats: true, quickActions: true, criticalUpdates: true,
      compliance: true, financials: true, watchlist: true,
    },
  },
  org_admin: {
    route: "/admin/executive",
    shell: "admin",
    roleLabel: "Organization Admin",
    primaryTaskLanes: ["executive_alerts", "finance", "insurance", "high_severity_incidents", "portfolio_health"],
    firstScreenPriority: ["portfolio_health", "executive_alerts", "finance_risk", "facility_comparison", "drill_ins"],
    suppressedSections: ["facility_operator_backlog", "admissions_queue_noise", "family_triage_queue_noise"],
    mobileTabletExpectation: "desktop-first",
    visibleGroups: ["Command", "Quality & Risk", "Knowledge", "Finance"],
    sections: {
      heroStats: true, quickActions: true, criticalUpdates: true,
      compliance: true, financials: true, watchlist: true,
    },
  },
  facility_admin: {
    route: "/admin",
    shell: "admin",
    roleLabel: "Facility Admin",
    primaryTaskLanes: ["staffing_gaps", "incident_followups", "admissions", "discharge", "family_workflow"],
    firstScreenPriority: ["urgent_now", "blocked_workflows", "resident_watchlist", "critical_activity", "operational_follow_through"],
    suppressedSections: ["enterprise_rollup", "portfolio_comparison", "owner_financial_narrative"],
    mobileTabletExpectation: "desktop-first",
    visibleGroups: ["Command", "Pipeline", "Clinical Ops", "Quality & Risk", "Knowledge", "Workforce", "Finance"],
    sections: {
      heroStats: true, quickActions: true, criticalUpdates: true,
      compliance: true, financials: true, watchlist: true,
      staffing: true, incidents: true,
    },
  },
  manager: {
    route: "/admin",
    shell: "admin",
    roleLabel: "Manager",
    primaryTaskLanes: ["staffing_gaps", "incident_followups", "resident_watchlist"],
    firstScreenPriority: ["urgent_now", "watchlist", "operational_follow_through"],
    suppressedSections: ["enterprise_rollup", "owner_financial_narrative"],
    mobileTabletExpectation: "desktop-first",
    visibleGroups: ["Command", "Pipeline", "Clinical Ops", "Quality & Risk", "Workforce"],
    sections: {
      heroStats: true, quickActions: true, criticalUpdates: true,
      compliance: true, financials: false, watchlist: true,
      staffing: true, incidents: true,
    },
  },
  admin_assistant: {
    route: "/admin/assistant-dashboard",
    shell: "admin",
    roleLabel: "Administrative Assistant",
    primaryTaskLanes: ["family_messages", "transportation", "referrals"],
    firstScreenPriority: ["communications", "coordination", "follow_through"],
    suppressedSections: ["clinical_risk_rollups", "finance_risk", "staffing_exceptions"],
    mobileTabletExpectation: "desktop-first",
    visibleGroups: ["Command", "Pipeline"],
    sections: {
      heroStats: true, quickActions: true, criticalUpdates: false,
      compliance: false, financials: false, watchlist: false,
      familyMessages: true, transportation: true,
    },
  },
  coordinator: {
    route: "/admin/coordinator-dashboard",
    shell: "admin",
    roleLabel: "Coordinator",
    primaryTaskLanes: ["care_plans", "assessments", "family_messages"],
    firstScreenPriority: ["clinical_follow_through", "communications", "resident_watchlist"],
    suppressedSections: ["enterprise_rollup", "finance_risk"],
    mobileTabletExpectation: "desktop-first",
    visibleGroups: ["Command", "Clinical Ops", "Pipeline"],
    sections: {
      heroStats: true, quickActions: true, criticalUpdates: true,
      compliance: false, financials: false, watchlist: true,
      carePlans: true, assessments: true, familyMessages: true,
    },
  },
  nurse: {
    route: "/admin/nurse-dashboard",
    shell: "admin",
    roleLabel: "Nurse",
    primaryTaskLanes: ["incidents", "clinical_follow_through", "watchlist"],
    firstScreenPriority: ["urgent_now", "clinical_risk", "watchlist"],
    suppressedSections: ["enterprise_rollup", "family_billing"],
    mobileTabletExpectation: "desktop-first",
    visibleGroups: ["Command", "Clinical Ops", "Quality & Risk"],
    sections: {
      heroStats: true, quickActions: true, criticalUpdates: true,
      compliance: true, financials: false, watchlist: true,
      incidents: true,
    },
  },
  dietary: {
    route: "/admin/dietary",
    shell: "admin",
    roleLabel: "Dietary",
    primaryTaskLanes: ["dietary"],
    firstScreenPriority: ["diet_orders", "clinical_review", "service_readiness"],
    suppressedSections: ["enterprise_rollup", "incident_backlog", "family_billing"],
    mobileTabletExpectation: "desktop-first",
    visibleGroups: ["Command"],
    sections: {
      heroStats: true, quickActions: true, dietary: true,
    },
  },
  maintenance_role: {
    route: "/admin",
    shell: "admin",
    roleLabel: "Maintenance",
    primaryTaskLanes: ["command"],
    firstScreenPriority: ["facility_tasks"],
    suppressedSections: ["enterprise_rollup", "clinical_follow_through", "family_billing"],
    mobileTabletExpectation: "desktop-first",
    visibleGroups: ["Command"],
    sections: {
      heroStats: true, quickActions: true,
    },
  },
  housekeeper: {
    route: "/caregiver/housekeeper",
    shell: "caregiver",
    roleLabel: "Housekeeper",
    primaryTaskLanes: ["room_assignments", "priority_cleans", "shift_summary"],
    firstScreenPriority: ["room_assignments", "priority_cleans", "completion", "shift_summary"],
    suppressedSections: ["med_pass", "incident_backlog", "finance", "rounds"],
    mobileTabletExpectation: "phone-and-tablet",
    visibleGroups: [],
    sections: {},
  },
  caregiver: {
    route: "/caregiver",
    shell: "caregiver",
    roleLabel: "Caregiver",
    primaryTaskLanes: ["shift_brief", "due_now_tasks", "rounds", "incident_reporting", "prn_followup"],
    firstScreenPriority: ["due_now", "overdue", "resident_assignments", "urgent_alerts", "documentation_follow_through"],
    suppressedSections: ["admin_backlog_density", "enterprise_rollup", "finance"],
    mobileTabletExpectation: "phone-and-tablet",
    visibleGroups: [],
    sections: {},
  },
  family: {
    route: "/family",
    shell: "family",
    roleLabel: "Family",
    primaryTaskLanes: ["today_updates", "care_summary", "messages", "calendar", "billing_documents"],
    firstScreenPriority: ["resident_updates", "care_summary", "messages", "calendar", "billing"],
    suppressedSections: ["staffing_gaps", "compliance_risks", "incident_backlog", "internal_admin_terms"],
    mobileTabletExpectation: "phone-and-tablet",
    visibleGroups: [],
    sections: {},
  },
  broker: {
    route: "/admin",
    shell: "admin",
    roleLabel: "Broker",
    primaryTaskLanes: ["command", "pipeline"],
    firstScreenPriority: ["portfolio_health", "pipeline"],
    suppressedSections: ["caregiver_density", "family_billing"],
    mobileTabletExpectation: "desktop-first",
    visibleGroups: ["Command", "Pipeline", "Clinical Ops", "Quality & Risk", "Workforce", "Finance"],
    sections: {
      heroStats: true, quickActions: true, criticalUpdates: true,
      compliance: true, financials: true, watchlist: true,
    },
  },
  med_tech: {
    route: "/med-tech",
    shell: "med-tech" as DashboardConfig["shell"],
    roleLabel: "Med-Tech",
    primaryTaskLanes: ["med_pass", "resident_med_context", "controlled_count", "incident_capture", "shift_tape"],
    firstScreenPriority: ["medications_due_now", "resident_context", "controlled_substance_follow_through", "exceptions", "handoff"],
    suppressedSections: ["adl_documentation_breadth", "enterprise_rollup", "family_billing"],
    mobileTabletExpectation: "phone-and-tablet",
    visibleGroups: [],
    sections: {},
  },
};

const DEFAULT_CONFIG: DashboardConfig = {
  route: "/admin",
  shell: "admin",
  roleLabel: "Admin",
  primaryTaskLanes: ["command"],
  firstScreenPriority: ["urgent_now"],
  suppressedSections: [],
  mobileTabletExpectation: "desktop-first",
  visibleGroups: ["Command"],
  sections: { heroStats: true, quickActions: true },
};

/** Returns the landing route for a given role. */
export function getDashboardRouteForRole(role: string): string {
  return DASHBOARD_CONFIGS[role]?.route ?? DEFAULT_CONFIG.route;
}

/** Returns the full dashboard config for a given role. */
export function getRoleDashboardConfig(role: string): DashboardConfig {
  return DASHBOARD_CONFIGS[role] ?? DEFAULT_CONFIG;
}

/** Returns which shell a role should use. */
export function getShellForRole(role: string): "admin" | "caregiver" | "family" | "med-tech" {
  return DASHBOARD_CONFIGS[role]?.shell ?? "admin";
}
