/**
 * Dashboard routing — maps each role to its landing route and dashboard config.
 * Controls which sections each role sees on the command center.
 */

export interface DashboardConfig {
  /** Landing route for this role */
  route: string;
  /** Which shell to use */
  shell: "admin" | "caregiver" | "family" | "med-tech";
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
    visibleGroups: ["Command", "Pipeline", "Clinical Ops", "Quality & Risk", "Workforce", "Finance"],
    sections: {
      heroStats: true, quickActions: true, criticalUpdates: true,
      compliance: true, financials: true, watchlist: true,
    },
  },
  org_admin: {
    route: "/admin/executive",
    shell: "admin",
    visibleGroups: ["Command", "Pipeline", "Clinical Ops", "Quality & Risk", "Workforce", "Finance"],
    sections: {
      heroStats: true, quickActions: true, criticalUpdates: true,
      compliance: true, financials: true, watchlist: true,
    },
  },
  facility_admin: {
    route: "/admin",
    shell: "admin",
    visibleGroups: ["Command", "Pipeline", "Clinical Ops", "Quality & Risk", "Workforce", "Finance"],
    sections: {
      heroStats: true, quickActions: true, criticalUpdates: true,
      compliance: true, financials: true, watchlist: true,
      staffing: true, incidents: true,
    },
  },
  manager: {
    route: "/admin",
    shell: "admin",
    visibleGroups: ["Command", "Pipeline", "Clinical Ops", "Quality & Risk", "Workforce"],
    sections: {
      heroStats: true, quickActions: true, criticalUpdates: true,
      compliance: true, financials: false, watchlist: true,
      staffing: true, incidents: true,
    },
  },
  admin_assistant: {
    route: "/admin",
    shell: "admin",
    visibleGroups: ["Command", "Pipeline"],
    sections: {
      heroStats: true, quickActions: true, criticalUpdates: false,
      compliance: false, financials: false, watchlist: false,
      familyMessages: true, transportation: true,
    },
  },
  coordinator: {
    route: "/admin",
    shell: "admin",
    visibleGroups: ["Command", "Clinical Ops", "Pipeline"],
    sections: {
      heroStats: true, quickActions: true, criticalUpdates: true,
      compliance: false, financials: false, watchlist: true,
      carePlans: true, assessments: true, familyMessages: true,
    },
  },
  nurse: {
    route: "/admin",
    shell: "admin",
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
    visibleGroups: ["Command"],
    sections: {
      heroStats: true, quickActions: true, dietary: true,
    },
  },
  maintenance_role: {
    route: "/admin",
    shell: "admin",
    visibleGroups: ["Command"],
    sections: {
      heroStats: true, quickActions: true,
    },
  },
  housekeeper: {
    route: "/caregiver",
    shell: "caregiver",
    visibleGroups: [],
    sections: {},
  },
  caregiver: {
    route: "/caregiver",
    shell: "caregiver",
    visibleGroups: [],
    sections: {},
  },
  family: {
    route: "/family",
    shell: "family",
    visibleGroups: [],
    sections: {},
  },
  broker: {
    route: "/admin",
    shell: "admin",
    visibleGroups: ["Command", "Pipeline", "Clinical Ops", "Quality & Risk", "Workforce", "Finance"],
    sections: {
      heroStats: true, quickActions: true, criticalUpdates: true,
      compliance: true, financials: true, watchlist: true,
    },
  },
  med_tech: {
    route: "/med-tech",
    shell: "med-tech" as DashboardConfig["shell"],
    visibleGroups: [],
    sections: {},
  },
};

const DEFAULT_CONFIG: DashboardConfig = {
  route: "/admin",
  shell: "admin",
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
