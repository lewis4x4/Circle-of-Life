import {
  decideGraceSafeMode,
  formatCountOnlyCensusAnswer,
} from "../supabase/functions/knowledge-agent/safe-mode";

type DecisionExpectation =
  | { kind: "route"; domain: "census" | "resident_attention" | "referral_pipeline" }
  | { kind: "clarify"; includes: string[] }
  | { kind: "agentic" };

type EvalCase = {
  name: string;
  question: string;
  accessibleFacilityNames: string[];
  expected: DecisionExpectation;
};

const withHeaderFacility = (facility: string, question: string) =>
  `[Context: Header facility focus is "${facility}". Use it for "this facility" or "here". The user may still ask about other sites by name—resolve accurately with tools.]\n\n${question}`;

const withNoHeaderFacility = (question: string) =>
  `[Context: No facility is selected in the header. Use org-wide accessible data. When the user names a specific site (for example Oakridge), resolve it with census and facility tools.]\n\n${question}`;

const accessibleFacilityNames = [
  "Oakridge ALF",
  "Homewood Lodge ALF",
  "Grande Cypress ALF",
];

const cases: EvalCase[] = [
  {
    name: "count-only census with selected facility",
    question: withHeaderFacility("Oakridge ALF", "How many total residents are in Oakridge?"),
    accessibleFacilityNames,
    expected: { kind: "route", domain: "census" },
  },
  {
    name: "count-only census right now",
    question: withHeaderFacility("Oakridge ALF", "How many residents do we have in Oakridge right now?"),
    accessibleFacilityNames,
    expected: { kind: "route", domain: "census" },
  },
  {
    name: "daily census question stays in census lane",
    question: withHeaderFacility("Oakridge ALF", "Give me the daily census for Oakridge."),
    accessibleFacilityNames,
    expected: { kind: "route", domain: "census" },
  },
  {
    name: "referral leads route deterministically",
    question: withHeaderFacility("Homewood Lodge ALF", "Do we have any new leads in the past week?"),
    accessibleFacilityNames,
    expected: { kind: "route", domain: "referral_pipeline" },
  },
  {
    name: "resident attention routes deterministically",
    question: withHeaderFacility("Homewood Lodge ALF", "At Homewood Lodge ALF, which residents have care alerts, open tasks, or follow-ups I should review soon?"),
    accessibleFacilityNames,
    expected: { kind: "route", domain: "resident_attention" },
  },
  {
    name: "ambiguous count asks for clarification",
    question: withHeaderFacility("Oakridge ALF", "How many do we have?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["resident count", "occupancy", "admissions activity"] },
  },
  {
    name: "ambiguous recent question asks for time clarification",
    question: withHeaderFacility("Oakridge ALF", "What changed recently?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["today", "past 7 days", "past 30 days"] },
  },
  {
    name: "facility ambiguity clarifies instead of widening",
    question: withNoHeaderFacility("Any new leads this week?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["Oakridge ALF", "all facilities"] },
  },
  {
    name: "explicit facility wins without header selection",
    question: withNoHeaderFacility("How many total residents are in Oakridge?"),
    accessibleFacilityNames,
    expected: { kind: "route", domain: "census" },
  },
  {
    name: "all facilities lead question stays in referral lane",
    question: withNoHeaderFacility("Any new leads across all facilities this week?"),
    accessibleFacilityNames,
    expected: { kind: "route", domain: "referral_pipeline" },
  },
  {
    name: "transport request gets controlled fallback",
    question: withHeaderFacility("Oakridge ALF", "What trips are scheduled tomorrow?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["trips today", "missed rides", "mileage approvals"] },
  },
  {
    name: "training request gets controlled fallback",
    question: withHeaderFacility("Oakridge ALF", "Any certifications expiring in 30 days?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["certifications expiring", "overdue completions", "upcoming in-service sessions"] },
  },
  {
    name: "incident request gets controlled fallback",
    question: withHeaderFacility("Oakridge ALF", "Any unresolved incidents?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["open incidents", "overdue follow-ups", "resident attention"] },
  },
  {
    name: "reporting request gets controlled fallback",
    question: withHeaderFacility("Oakridge ALF", "What reports failed this week?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["scheduled reports", "failed runs", "due-soon reports"] },
  },
  {
    name: "insurance request gets controlled fallback",
    question: withHeaderFacility("Oakridge ALF", "What claims are still open?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["renewals due", "open claims", "policy expirations"] },
  },
  {
    name: "policy question remains agentic",
    question: withHeaderFacility("Oakridge ALF", "Show me the incident reporting policy."),
    accessibleFacilityNames,
    expected: { kind: "agentic" },
  },
  {
    name: "protocol question remains agentic",
    question: withHeaderFacility("Oakridge ALF", "What does the fall protocol say?"),
    accessibleFacilityNames,
    expected: { kind: "agentic" },
  },
  {
    name: "attention question honors selected facility",
    question: withHeaderFacility("Oakridge ALF", "Who needs attention here?"),
    accessibleFacilityNames,
    expected: { kind: "route", domain: "resident_attention" },
  },
  {
    name: "resident count shorthand routes to census",
    question: withHeaderFacility("Oakridge ALF", "Resident count"),
    accessibleFacilityNames,
    expected: { kind: "route", domain: "census" },
  },
  {
    name: "named facility leads route cleanly",
    question: withHeaderFacility("Oakridge ALF", "Any new leads this week at Homewood Lodge ALF?"),
    accessibleFacilityNames,
    expected: { kind: "route", domain: "referral_pipeline" },
  },
  {
    name: "selected facility shorthand still routes to census",
    question: withHeaderFacility("Oakridge ALF", "How many residents do we have here?"),
    accessibleFacilityNames,
    expected: { kind: "route", domain: "census" },
  },
  {
    name: "open tasks phrase still routes to resident attention",
    question: withHeaderFacility("Homewood Lodge ALF", "Which residents at Homewood have open tasks right now?"),
    accessibleFacilityNames,
    expected: { kind: "route", domain: "resident_attention" },
  },
  {
    name: "new inquiries phrase routes to referral pipeline",
    question: withHeaderFacility("Homewood Lodge ALF", "Any new inquiries for Homewood in the past week?"),
    accessibleFacilityNames,
    expected: { kind: "route", domain: "referral_pipeline" },
  },
  {
    name: "occupancy wording stays in census lane",
    question: withHeaderFacility("Oakridge ALF", "What is Oakridge occupancy right now?"),
    accessibleFacilityNames,
    expected: { kind: "route", domain: "census" },
  },
  {
    name: "employee handbook query remains agentic",
    question: withHeaderFacility("Oakridge ALF", "Show me the employee handbook policy."),
    accessibleFacilityNames,
    expected: { kind: "agentic" },
  },
  {
    name: "quickbooks strategy question gets controlled fallback",
    question: withHeaderFacility("Oakridge ALF", "Can Haven integrate QuickBooks?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["native Haven billing", "QuickBooks sync", "billing workflow differences"] },
  },
  {
    name: "waitlist planning question gets controlled fallback",
    question: withHeaderFacility("Oakridge ALF", "How many turned-away applicants did we have by month from the archive list?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["turned-away applicants by month", "waitlist by facility", "conversion/capacity planning"] },
  },
  {
    name: "marketing question gets controlled fallback",
    question: withHeaderFacility("Oakridge ALF", "Which campaign leads and social media sources are converting best?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["campaign leads", "referral sources", "admissions conversion"] },
  },
  {
    name: "acquisition readiness question gets controlled fallback",
    question: withHeaderFacility("Oakridge ALF", "Can Haven absorb five new Alabama buildings quickly?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["new-facility provisioning", "acquisition readiness", "capacity planning"] },
  },
  {
    name: "billing workflow difference question gets controlled fallback",
    question: withHeaderFacility("Oakridge ALF", "One facility bills in QuickBooks and another bills in Haven — how should we handle that?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["native Haven billing", "QuickBooks sync", "billing workflow differences"] },
  },
  {
    name: "document vault question gets controlled fallback",
    question: withHeaderFacility("Oakridge ALF", "Can Haven house all facility documents and let us upload forms?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["KB uploads", "facility document vault", "Obsidian doctrine drafts"] },
  },
  {
    name: "workflow automation question gets controlled fallback",
    question: withHeaderFacility("Oakridge ALF", "What happens automatically when an incident is created?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["incident notifications", "follow-up tasks", "document generation"] },
  },
  {
    name: "family journal question gets family clarification",
    question: withHeaderFacility("Oakridge ALF", "What would family see in the journal and care team area?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["family journal", "care team", "messages"] },
  },
  {
    name: "family billing question gets family clarification",
    question: withHeaderFacility("Oakridge ALF", "What would family see in billing, invoices, and calendar?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["family journal", "care team", "messages"] },
  },
  {
    name: "document storage question with storage wording gets controlled fallback",
    question: withHeaderFacility("Oakridge ALF", "Can Haven store all of our facility documents and forms in one vault?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["KB uploads", "facility document vault", "Obsidian doctrine drafts"] },
  },
  {
    name: "workflow chain question gets controlled fallback",
    question: withHeaderFacility("Oakridge ALF", "If an admission starts, what workflow starts automatically and who gets notified?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["incident notifications", "follow-up tasks", "document generation"] },
  },
  {
    name: "ahca story question gets controlled fallback",
    question: withHeaderFacility("Oakridge ALF", "Could we show AHCA this as proof and reduce survey intrusions?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["AHCA evidence story", "survey-readiness proof", "commercialization narrative"] },
  },
  {
    name: "brookdale commercialization question gets controlled fallback",
    question: withHeaderFacility("Oakridge ALF", "Could this eventually be sold to Brookdale?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["AHCA evidence story", "survey-readiness proof", "commercialization narrative"] },
  },
  {
    name: "staffing gaps question gets executive clarification",
    question: withHeaderFacility("Oakridge ALF", "Which facilities have staffing gaps right now?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["who is on shift", "staffing gaps by facility", "certifications expiring"] },
  },
  {
    name: "owner visibility question gets executive clarification",
    question: withNoHeaderFacility("What should ownership be looking at across facilities right now?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["top alerts", "facility risk", "benchmark outliers"] },
  },
  {
    name: "who is on shift question gets staffing clarification",
    question: withHeaderFacility("Oakridge ALF", "Who is on shift right now at Oakridge?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["who is on shift", "staffing gaps by facility", "certifications expiring"] },
  },
  {
    name: "staffing gaps question gets staffing clarification",
    question: withNoHeaderFacility("Which facilities have staffing gaps today?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["who is on shift", "staffing gaps by facility", "certifications expiring"] },
  },
  {
    name: "emergency contact question gets resident contact clarification",
    question: withHeaderFacility("Oakridge ALF", "How do I find the emergency contact for a resident?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["emergency contacts", "responsible parties", "family messages"] },
  },
  {
    name: "responsible party question gets resident contact clarification",
    question: withHeaderFacility("Oakridge ALF", "Who is the responsible party for this resident?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["emergency contacts", "responsible parties", "family messages"] },
  },
  {
    name: "today leads question routes to referral pipeline",
    question: withHeaderFacility("Oakridge ALF", "Did we get any new leads today at Oakridge?"),
    accessibleFacilityNames,
    expected: { kind: "route", domain: "referral_pipeline" },
  },
  {
    name: "all facilities occupancy routes to census",
    question: withNoHeaderFacility("What is occupancy across all facilities right now?"),
    accessibleFacilityNames,
    expected: { kind: "route", domain: "census" },
  },
  {
    name: "all facilities attention clarifies scope",
    question: withNoHeaderFacility("Who needs attention right now?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["Oakridge ALF", "all facilities"] },
  },
  {
    name: "policy handbook query remains agentic",
    question: withHeaderFacility("Homewood Lodge ALF", "What does the employee handbook say about workplace safety?"),
    accessibleFacilityNames,
    expected: { kind: "agentic" },
  },
  {
    name: "sop query remains agentic",
    question: withHeaderFacility("Oakridge ALF", "Show me the transportation scheduling SOP."),
    accessibleFacilityNames,
    expected: { kind: "agentic" },
  },
  {
    name: "billing source of truth question gets integration clarification",
    question: withHeaderFacility("Oakridge ALF", "Should we keep billing in Haven or QuickBooks?"),
    accessibleFacilityNames,
    expected: { kind: "clarify", includes: ["native Haven billing", "QuickBooks sync", "facility billing workflow differences"] },
  },
];

function assertCase(evalCase: EvalCase) {
  const decision = decideGraceSafeMode({
    question: evalCase.question,
    accessibleFacilityNames: evalCase.accessibleFacilityNames,
  });

  if (evalCase.expected.kind === "route") {
    if (decision.kind !== "route" || decision.domain !== evalCase.expected.domain) {
      throw new Error(`${evalCase.name}: expected route ${evalCase.expected.domain}, received ${JSON.stringify(decision)}`);
    }
    return;
  }

  if (evalCase.expected.kind === "agentic") {
    if (decision.kind !== "agentic") {
      throw new Error(`${evalCase.name}: expected agentic decision, received ${JSON.stringify(decision)}`);
    }
    return;
  }

  if (decision.kind !== "clarify") {
    throw new Error(`${evalCase.name}: expected clarification, received ${JSON.stringify(decision)}`);
  }

  for (const token of evalCase.expected.includes) {
    if (!decision.text.toLowerCase().includes(token.toLowerCase())) {
      throw new Error(`${evalCase.name}: expected clarification to include "${token}", received "${decision.text}"`);
    }
  }
}

for (const evalCase of cases) {
  assertCase(evalCase);
}

const countOnlyAnswer = formatCountOnlyCensusAnswer([
  { name: "Oakridge ALF", activeResidents: 8 },
]);
for (const forbidden of ["occupancy", "available beds", "admissions", "discharges"]) {
  if (countOnlyAnswer.toLowerCase().includes(forbidden)) {
    throw new Error(`count-only census formatter leaked "${forbidden}" into "${countOnlyAnswer}"`);
  }
}

console.log(`Grace safe-mode evals passed (${cases.length} prompt cases + count-only answer contract).`);
