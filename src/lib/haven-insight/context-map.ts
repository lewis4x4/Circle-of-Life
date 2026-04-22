/**
 * Haven Insight — Route-to-Context Intelligence Map
 *
 * Maps every admin route to an AI context so Haven Insight knows
 * where the user is and can adapt its behavior accordingly.
 */

import type { ExecKpiPayload } from "@/lib/exec-kpi-snapshot";

export interface ModuleContext {
  /** Human-readable module name shown in the context badge */
  module: string;
  /** What the AI should focus on (injected into system prompt) */
  perspective: string;
  /** Starter questions tailored to this module */
  suggestedQuestions: string[];
  /** Which KPI domains are most relevant */
  kpiDomains: string[];
  /** Additional system prompt text for the AI */
  systemPromptAddon: string;
}

// ── ROUTE → CONTEXT MAP ──

const ROUTE_CONTEXTS: Array<{ prefix: string; context: ModuleContext }> = [
  // ── Executive ──
  {
    prefix: "/admin/executive/ceo",
    context: {
      module: "CEO Command Center",
      perspective: "enterprise growth, risk, and strategic oversight",
      suggestedQuestions: [
        "What's our portfolio occupancy trend across all facilities?",
        "Which facility has the highest risk profile right now?",
        "How are move-ins tracking compared to last quarter?",
        "What are the top 3 issues I should focus on today?",
        "Give me a 30-second enterprise health summary.",
        "Are there any staffing ratio breaches this week?",
      ],
      kpiDomains: ["census", "financial", "clinical", "compliance", "workforce", "infection"],
      systemPromptAddon: "You are advising the CEO. Prioritize portfolio-wide health, growth vectors, strategic risks, and facility-to-facility comparisons. Lead with the most actionable insight. Use executive-level language — concise, strategic, data-backed.",
    },
  },
  {
    prefix: "/admin/executive/cfo",
    context: {
      module: "CFO Financial Center",
      perspective: "revenue, costs, margins, AR aging, cash flow, labor economics",
      suggestedQuestions: [
        "What's our current AR aging breakdown by facility?",
        "How does labor cost % compare across facilities?",
        "What's our days sales outstanding trend?",
        "Which payer type has the highest delinquency rate?",
        "Are we on track for this month's revenue target?",
        "What's our NOI margin compared to last quarter?",
      ],
      kpiDomains: ["financial"],
      systemPromptAddon: "You are advising the CFO. Prioritize revenue, AR aging, cash flow, labor cost as % of revenue, payer mix analysis, and margin trends. Use financial terminology. Express monetary values clearly.",
    },
  },
  {
    prefix: "/admin/executive/coo",
    context: {
      module: "COO Operations Center",
      perspective: "staffing, maintenance, dining, compliance, incidents, satisfaction",
      suggestedQuestions: [
        "What's our shift fill rate across all facilities today?",
        "How many work orders are open and overdue?",
        "What's driving the incident rate at Cedar Park?",
        "Are there any dining satisfaction concerns?",
        "Which facilities have certification expirations coming up?",
        "Give me today's operational readiness summary.",
      ],
      kpiDomains: ["clinical", "compliance", "workforce", "infection"],
      systemPromptAddon: "You are advising the COO. Prioritize staffing ratios, shift coverage, work orders, dining operations, incident density, satisfaction scores, and operational readiness. Use operational language focused on action items.",
    },
  },
  {
    prefix: "/admin/executive",
    context: {
      module: "Executive Overview",
      perspective: "enterprise-wide KPIs and strategic health",
      suggestedQuestions: [
        "Give me a portfolio health summary.",
        "What are the top alerts requiring my attention?",
        "How does this month compare to last month?",
        "Which facility needs the most attention right now?",
      ],
      kpiDomains: ["census", "financial", "clinical", "compliance", "workforce", "infection"],
      systemPromptAddon: "The user is viewing the Executive Overview. Provide balanced, cross-functional insights covering all KPI domains. Highlight the most critical items first.",
    },
  },

  // ── Clinical ──
  {
    prefix: "/admin/residents",
    context: {
      module: "Resident Management",
      perspective: "resident care, assessments, care plans, census, clinical status",
      suggestedQuestions: [
        "How many residents are currently on hospital hold?",
        "Are there any overdue assessments?",
        "What's our current census by facility?",
        "Which residents have care plan reviews due this week?",
      ],
      kpiDomains: ["census"],
      systemPromptAddon: "The user is managing residents. Focus on census data, care plan status, assessment schedules, ADL scores, and clinical observations. Reference specific resident counts when possible.",
    },
  },
  {
    prefix: "/admin/medications",
    context: {
      module: "Medication Management",
      perspective: "eMAR records, medication errors, controlled substances, PRN tracking",
      suggestedQuestions: [
        "How many medication errors have occurred this month?",
        "Are there any pending verbal orders needing co-signature?",
        "What's the PRN effectiveness rate?",
        "Any controlled substance count discrepancies?",
      ],
      kpiDomains: ["clinical"],
      systemPromptAddon: "The user is in Medication Management. Focus on eMAR compliance, medication error trends, controlled substance accountability, verbal order timelines, and PRN effectiveness. Patient safety is paramount.",
    },
  },
  {
    prefix: "/admin/incidents",
    context: {
      module: "Incident Management",
      perspective: "incident tracking, severity distribution, root cause analysis, follow-ups",
      suggestedQuestions: [
        "How many incidents are open right now?",
        "What's the fall rate trend over the last 3 months?",
        "Are there any overdue incident follow-ups?",
        "Which facility has the highest incident density?",
      ],
      kpiDomains: ["clinical"],
      systemPromptAddon: "The user is in Incident Management. Focus on open incidents, severity distribution, incident types (falls, med errors, behavioral), follow-up completion, and facility-level trends. Emphasize root cause patterns.",
    },
  },
  {
    prefix: "/admin/infection-control",
    context: {
      module: "Infection Control",
      perspective: "surveillance, outbreaks, isolation protocols, staff illness tracking",
      suggestedQuestions: [
        "Are there any active infection outbreaks?",
        "What infections are under surveillance?",
        "How is our hand hygiene compliance?",
        "Any staff illness trends to be aware of?",
      ],
      kpiDomains: ["infection"],
      systemPromptAddon: "The user is in Infection Control. Focus on active outbreaks, surveillance cases, isolation protocols, and infection rates. This is a high-sensitivity clinical area — accuracy is critical.",
    },
  },

  // ── Compliance ──
  {
    prefix: "/admin/compliance",
    context: {
      module: "Compliance & Survey Readiness",
      perspective: "survey deficiencies, plans of correction, policy compliance, readiness",
      suggestedQuestions: [
        "How many open survey deficiencies do we have?",
        "Are any plans of correction overdue?",
        "What's our overall survey readiness score?",
        "Which policies need acknowledgment renewal?",
      ],
      kpiDomains: ["compliance"],
      systemPromptAddon: "The user is in Compliance. Focus on open deficiencies, POC status, policy acknowledgment rates, and survey readiness. Reference Florida AHCA Chapter 429 / FAC 59A-36 regulations when relevant.",
    },
  },
  {
    prefix: "/admin/quality",
    context: {
      module: "Quality Metrics",
      perspective: "quality indicators, satisfaction, clinical outcomes, benchmarking",
      suggestedQuestions: [
        "What are our key quality indicators?",
        "How does our satisfaction score compare to last quarter?",
        "Which quality metrics need immediate attention?",
      ],
      kpiDomains: ["clinical", "compliance"],
      systemPromptAddon: "The user is reviewing Quality Metrics. Focus on quality indicators, satisfaction trends, clinical outcomes, and benchmark comparisons.",
    },
  },

  // ── Workforce ──
  {
    prefix: "/admin/staff",
    context: {
      module: "Staff Management",
      perspective: "staff roster, roles, certifications, employment status",
      suggestedQuestions: [
        "How many staff members are active across all facilities?",
        "Which certifications are expiring in the next 30 days?",
        "What's our current staffing ratio compliance?",
        "How many float pool staff do we have available?",
      ],
      kpiDomains: ["workforce"],
      systemPromptAddon: "The user is managing Staff. Focus on headcount, certification status, staffing ratios, turnover, and scheduling. Reference specific numbers when available.",
    },
  },
  {
    prefix: "/admin/schedules",
    context: {
      module: "Staff Scheduling",
      perspective: "shift scheduling, coverage, swap requests, overtime",
      suggestedQuestions: [
        "Are all shifts covered for the next 48 hours?",
        "How many shift swap requests are pending?",
        "What's our overtime trend this month?",
      ],
      kpiDomains: ["workforce"],
      systemPromptAddon: "The user is in Staff Scheduling. Focus on shift coverage, open shifts, swap requests, and overtime hours.",
    },
  },
  {
    prefix: "/admin/certifications",
    context: {
      module: "Certifications Tracking",
      perspective: "staff certifications, expirations, renewals, compliance",
      suggestedQuestions: [
        "Which certifications expire this month?",
        "Are any staff working with expired certifications?",
        "What's our overall certification compliance rate?",
      ],
      kpiDomains: ["workforce"],
      systemPromptAddon: "The user is tracking Certifications. Focus on expiration timelines, renewal status, and compliance gaps. Flag any staff whose certifications have already expired.",
    },
  },
  {
    prefix: "/admin/rounding",
    context: {
      module: "Resident Assurance & Safety Rounding",
      perspective: "resident safety, observation compliance, watch protocols, early-warning signals",
      suggestedQuestions: [
        "Which residents are on active observation plans?",
        "How many observation tasks are overdue right now?",
        "Are there any escalated safety concerns?",
        "What's our observation compliance rate this shift?",
        "Show me residents with active watch protocols.",
        "Which residents triggered exceptions in the last 24 hours?",
      ],
      kpiDomains: ["clinical", "residentAssurance"],
      systemPromptAddon: "The user is in Resident Assurance & Safety Rounding. Focus on observation task compliance, overdue/missed checks, watch protocol status, exception severity, and resident safety scores. Reference Florida AHCA post-fall monitoring requirements when relevant. Patient safety is the top priority.",
    },
  },
  {
    prefix: "/admin/training",
    context: {
      module: "Training & Competency",
      perspective: "training programs, completions, in-service sessions, competency tracking",
      suggestedQuestions: [
        "How many staff have completed required training this quarter?",
        "Are there any overdue training completions?",
        "When is the next in-service session scheduled?",
      ],
      kpiDomains: ["workforce"],
      systemPromptAddon: "The user is in Training & Competency. Focus on training completion rates, in-service sessions, and competency gaps.",
    },
  },

  // ── Finance ──
  {
    prefix: "/admin/billing",
    context: {
      module: "Billing & Collections",
      perspective: "invoices, payments, AR aging, collections, payer mix",
      suggestedQuestions: [
        "How many invoices are currently overdue?",
        "What's our total AR outstanding?",
        "What's the payer mix breakdown across facilities?",
        "Which residents have the highest outstanding balances?",
        "How is our collection rate trending?",
      ],
      kpiDomains: ["financial"],
      systemPromptAddon: "The user is in Billing & Collections. Focus on invoices, payment collection, AR aging buckets, payer-specific data, rate schedules, and collection activities. Express amounts in dollars.",
    },
  },
  {
    prefix: "/admin/finance",
    context: {
      module: "Entity Finance",
      perspective: "general ledger, journal entries, trial balance, budget tracking",
      suggestedQuestions: [
        "What's our current trial balance summary?",
        "Are there any unposted journal entries?",
        "How are we tracking against budget this month?",
      ],
      kpiDomains: ["financial"],
      systemPromptAddon: "The user is in Entity Finance. Focus on GL entries, trial balance, budget variance, and period close status. Use accounting terminology.",
    },
  },
  {
    prefix: "/admin/vendors",
    context: {
      module: "Vendor Management",
      perspective: "vendor contracts, purchase orders, vendor payments, scorecards",
      suggestedQuestions: [
        "Which vendor contracts are up for renewal?",
        "Are there any open purchase orders awaiting approval?",
        "What's our total vendor spend this quarter?",
      ],
      kpiDomains: ["financial"],
      systemPromptAddon: "The user is in Vendor Management. Focus on contract status, PO approvals, vendor payment timelines, and scorecard performance.",
    },
  },
  {
    prefix: "/admin/insurance",
    context: {
      module: "Insurance & Risk",
      perspective: "insurance policies, claims, renewals, loss runs, premiums",
      suggestedQuestions: [
        "Which insurance policies are up for renewal?",
        "Are there any open claims?",
        "What's our total cost of risk?",
      ],
      kpiDomains: ["financial"],
      systemPromptAddon: "The user is in Insurance & Risk. Focus on policy inventory, renewal timelines, claim status, loss runs, and premium allocations.",
    },
  },

  // ── Operations ──
  {
    prefix: "/admin/dietary",
    context: {
      module: "Dietary & Nutrition",
      perspective: "diet orders, meal planning, texture modifications, clinical diet review",
      suggestedQuestions: [
        "How many residents have special diet orders?",
        "Are there any diet-medication interactions to review?",
        "What's our dining satisfaction score?",
      ],
      kpiDomains: ["clinical"],
      systemPromptAddon: "The user is in Dietary & Nutrition. Focus on diet orders, texture modifications (IDDSI levels), meal satisfaction, and clinical diet-medication interactions.",
    },
  },
  {
    prefix: "/admin/transportation",
    context: {
      module: "Transportation",
      perspective: "transport requests, scheduling, mileage, fleet management",
      suggestedQuestions: [
        "How many transport trips are scheduled today?",
        "What's our mileage spend this month?",
        "Are there any missed or cancelled trips?",
      ],
      kpiDomains: [],
      systemPromptAddon: "The user is in Transportation. Focus on trip scheduling, fleet utilization, mileage tracking, and missed trip rates.",
    },
  },
  {
    prefix: "/admin/referrals",
    context: {
      module: "Referral Pipeline",
      perspective: "referral inquiries, lead pipeline, referral inbox, conversion rates",
      suggestedQuestions: [
        "How many leads are in the pipeline?",
        "What's our referral-to-tour conversion rate?",
        "Are there any pending referral inbox items?",
      ],
      kpiDomains: ["census"],
      systemPromptAddon: "The user is in the Referral Pipeline. Focus on lead volume, conversion rates, pipeline stages, and inbound referral processing.",
    },
  },
  {
    prefix: "/admin/reputation",
    context: {
      module: "Reputation Management",
      perspective: "online reviews, Google/Yelp ratings, reply management, NPS",
      suggestedQuestions: [
        "What's our average rating across platforms?",
        "Are there any reviews pending a reply?",
        "How is our reputation trending?",
      ],
      kpiDomains: [],
      systemPromptAddon: "The user is in Reputation Management. Focus on review ratings, reply rates, platform-specific trends, and NPS scores.",
    },
  },
  {
    prefix: "/admin/family",
    context: {
      module: "Family Portal",
      perspective: "family communication, care updates, satisfaction, engagement",
      suggestedQuestions: [
        "Are there any unread family messages?",
        "What's our family satisfaction score?",
        "How many family members are active on the portal?",
      ],
      kpiDomains: [],
      systemPromptAddon: "The user is in the Family Portal area. Focus on family communication, engagement metrics, and satisfaction feedback.",
    },
  },
];

// ── DEFAULT FALLBACK ──

const DEFAULT_CONTEXT: ModuleContext = {
  module: "Haven Operations",
  perspective: "general ALF operations and management",
  suggestedQuestions: [
    "Give me a quick health check across all facilities.",
    "What are the top issues I should know about?",
    "How is occupancy trending?",
    "Are there any critical alerts?",
  ],
  kpiDomains: ["census", "financial", "clinical", "compliance", "workforce", "infection"],
  systemPromptAddon: "The user is navigating the Haven platform. Provide balanced, general-purpose insights. If you can identify their likely intent from the question, adapt accordingly.",
};

// ── RESOLVER ──

/**
 * Resolve the current pathname to a ModuleContext.
 * Uses longest-prefix matching for accuracy.
 */
// Pre-sort once at module init (not on every call)
const SORTED_CONTEXTS = [...ROUTE_CONTEXTS].sort((a, b) => b.prefix.length - a.prefix.length);

export function resolveModuleContext(pathname: string | null): ModuleContext {
  if (!pathname) return DEFAULT_CONTEXT;
  for (const entry of SORTED_CONTEXTS) {
    if (pathname.startsWith(entry.prefix)) {
      return entry.context;
    }
  }
  return DEFAULT_CONTEXT;
}

// ── DYNAMIC SUGGESTIONS ──

/**
 * Generate smart suggested questions based on context + live KPI data.
 * Adds conditional questions when KPI values indicate issues.
 */
export function generateDynamicSuggestions(
  moduleContext: ModuleContext,
  kpis?: ExecKpiPayload | null,
  _role?: string,
): string[] {
  void _role;
  const base = [...moduleContext.suggestedQuestions];

  if (kpis) {
    // Add conditional suggestions based on live data
    if (kpis.census.occupancyPct != null && kpis.census.occupancyPct < 85) {
      base.unshift("Why has occupancy dropped below 85%?");
    }
    if (kpis.clinical.openIncidents > 5) {
      base.unshift("What's driving the elevated incident count?");
    }
    if (kpis.infection.activeOutbreaks > 0) {
      base.unshift("Tell me about the active infection outbreak.");
    }
    if (kpis.workforce.certificationsExpiring30d > 3) {
      base.unshift(`${kpis.workforce.certificationsExpiring30d} certifications expiring soon — what should we do?`);
    }
    if (kpis.compliance.openSurveyDeficiencies > 0) {
      base.unshift("What's the status of our open survey deficiencies?");
    }
    if (kpis.financial.totalBalanceDueCents > 5_000_000) {
      base.unshift("Our AR is over $50K — what's the breakdown?");
    }
    if (kpis.residentAssurance.overdueTasksCount > 0) {
      base.unshift(`${kpis.residentAssurance.overdueTasksCount} observation tasks overdue — which residents?`);
    }
    if (kpis.residentAssurance.activeWatchCount > 0) {
      base.unshift(`${kpis.residentAssurance.activeWatchCount} active watch protocols — status update?`);
    }
  }

  // Limit to 6 suggestions
  return base.slice(0, 6);
}
