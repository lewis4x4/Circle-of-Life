export type Phase1TemplateSeed = {
  slug: string;
  name: string;
  category: string;
  description: string;
  audience: string;
  defaultRange: string;
  tags: string[];
};

export const PHASE1_TEMPLATE_SEED: Phase1TemplateSeed[] = [
  {
    slug: "occupancy-census-summary",
    name: "Occupancy and Census Summary",
    category: "Executive",
    description: "Census and occupancy trend visibility across facilities.",
    audience: "CEO, COO, Administrator",
    defaultRange: "Last 30 days",
    tags: ["Executive", "Census", "Benchmark"],
  },
  {
    slug: "facility-operating-scorecard",
    name: "Facility Operating Scorecard",
    category: "Executive",
    description: "Cross-domain scorecard of financial, quality, and staffing signals.",
    audience: "CEO, COO, Regional Leader",
    defaultRange: "Last 7 days",
    tags: ["Executive", "Operations", "Scorecard"],
  },
  {
    slug: "incident-trend-summary",
    name: "Incident Trend Summary",
    category: "Risk",
    description: "Incident patterns by facility, unit, shift, and severity.",
    audience: "COO, Compliance Lead, Administrator",
    defaultRange: "Last 30 days",
    tags: ["Risk", "Compliance", "Clinical"],
  },
  {
    slug: "staffing-coverage-by-shift",
    name: "Staffing Coverage by Shift",
    category: "Workforce",
    description: "Coverage gaps and assignment feasibility by shift.",
    audience: "Administrator, Staffing Lead",
    defaultRange: "Last 14 days",
    tags: ["Workforce", "Staffing"],
  },
  {
    slug: "overtime-labor-pressure",
    name: "Overtime and Labor Pressure",
    category: "Workforce",
    description: "Overtime concentration and labor pressure trend.",
    audience: "COO, CFO, Administrator",
    defaultRange: "Last 30 days",
    tags: ["Workforce", "Finance", "Labor"],
  },
  {
    slug: "medication-exception-report",
    name: "Medication Exception Report",
    category: "Clinical",
    description: "Medication error and exception trend monitoring.",
    audience: "Clinical Lead, Compliance Lead",
    defaultRange: "Last 30 days",
    tags: ["Clinical", "Medication", "Compliance"],
  },
  {
    slug: "resident-assurance-rounding-compliance",
    name: "Resident Assurance / Rounding Compliance",
    category: "Clinical",
    description: "Expected vs completed checks, late entries, and overdue tasks.",
    audience: "COO, Clinical Lead, Administrator",
    defaultRange: "Last 7 days",
    tags: ["Clinical", "Compliance", "Risk"],
  },
  {
    slug: "resident-assurance-heat-trend",
    name: "Resident Assurance Heat Trend",
    category: "Executive",
    description: "7-day watch, escalation, integrity, and critical-safety pressure by facility.",
    audience: "CEO, COO, Regional Leader, Administrator",
    defaultRange: "Last 7 days",
    tags: ["Executive", "Clinical", "Risk", "Trend"],
  },
  {
    slug: "ar-aging-summary",
    name: "AR Aging Summary",
    category: "Financial",
    description: "Aging and receivable exposure by facility and payer.",
    audience: "CFO, Owner",
    defaultRange: "Current month",
    tags: ["Financial", "AR", "Board"],
  },
  {
    slug: "training-certification-expiry",
    name: "Training and Certification Expiry",
    category: "Workforce",
    description: "Upcoming expirations and compliance risk by role/staff.",
    audience: "Administrator, Compliance Lead",
    defaultRange: "Next 30 days",
    tags: ["Workforce", "Compliance"],
  },
  {
    slug: "survey-readiness-summary",
    name: "Survey Readiness Summary",
    category: "Compliance",
    description: "Deficiencies, timelines, and readiness posture.",
    audience: "Compliance Lead, Administrator, COO",
    defaultRange: "Last 30 days",
    tags: ["Compliance", "Survey", "Audit"],
  },
  {
    slug: "executive-weekly-operating-pack",
    name: "Executive Weekly Operating Pack",
    category: "Pack",
    description: "Bundled executive report set for weekly review.",
    audience: "CEO, COO, CFO, Owner",
    defaultRange: "Last 7 days",
    tags: ["Executive", "Pack", "Board"],
  },
];
