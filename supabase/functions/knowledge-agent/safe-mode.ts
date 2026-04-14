export type SafeGraceDomain =
  | "clarification"
  | "census"
  | "resident_attention"
  | "referral_pipeline";

export type SafeGraceDecision =
  | { kind: "route"; domain: Exclude<SafeGraceDomain, "clarification"> }
  | { kind: "clarify"; domain: SafeGraceDomain; text: string; reason: "ambiguous_scope" | "ambiguous_time_window" | "ambiguous_domain" | "domain_not_implemented" }
  | { kind: "agentic" };

type UnsupportedLane =
  | "admissions"
  | "discharge"
  | "medications"
  | "incidents"
  | "compliance"
  | "training"
  | "transport"
  | "dietary"
  | "reputation"
  | "family"
  | "executive"
  | "finance"
  | "insurance"
  | "vendors"
  | "facility_admin"
  | "reporting"
  | "rounding";

const GENERIC_FACILITY_WORDS = new Set([
  "all",
  "any",
  "facility",
  "facilities",
  "header",
  "here",
  "organization",
  "org",
  "selected",
  "site",
  "this",
  "we",
]);

function stripGraceContextPrefix(question: string): string {
  return question.replace(/^\[Context:[\s\S]*?\]\s*/i, "").trim();
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

export function getGraceUserQuestion(question: string): string {
  return stripGraceContextPrefix(question);
}

export function getGraceHeaderFacility(question: string): string | null {
  const selectedMatch = question.match(/^\[Context: Header facility focus is "([^"]+)"/);
  if (selectedMatch?.[1]) return selectedMatch[1].trim();
  if (/^\[Context: No facility is selected in the header\./.test(question)) return null;
  return null;
}

export function isResidentAttentionQuestion(question: string): boolean {
  const q = normalizeText(getGraceUserQuestion(question));
  return includesAny(q, [
    "who needs attention",
    "care alerts",
    "open tasks",
    "follow up",
    "follow ups",
    "followup",
    "followups",
  ]);
}

export function isCensusQuestion(question: string): boolean {
  const q = normalizeText(getGraceUserQuestion(question));
  return includesAny(q, [
    "how many residents",
    "how many total residents",
    "resident count",
    "daily census",
    "census",
    "occupancy",
    "available beds",
    "licensed beds",
  ]);
}

export function isResidentCountOnlyQuestion(question: string): boolean {
  const q = normalizeText(getGraceUserQuestion(question));
  const asksForCount = includesAny(q, [
    "how many residents",
    "how many total residents",
    "resident count",
  ]);
  const asksForExpandedCensus = includesAny(q, [
    "occupancy",
    "available beds",
    "licensed beds",
    "admissions",
    "discharges",
    "census snapshot",
    "daily census",
  ]);
  return asksForCount && !asksForExpandedCensus;
}

export function isReferralPipelineQuestion(question: string): boolean {
  const q = normalizeText(getGraceUserQuestion(question));
  return includesAny(q, [
    "lead",
    "leads",
    "referral",
    "pipeline",
    "inquiry",
    "inquiries",
  ]);
}

export function isSemanticKbQuestion(question: string): boolean {
  const q = normalizeText(getGraceUserQuestion(question));
  return includesAny(q, [
    "policy",
    "policies",
    "procedure",
    "procedures",
    "protocol",
    "protocols",
    "sop",
    "handbook",
    "statute",
    "regulation",
    "rule",
    "rules",
    "what does the policy say",
    "how do i",
  ]);
}

function questionNeedsTimeClarification(question: string): boolean {
  const q = normalizeText(getGraceUserQuestion(question));
  return includesAny(q, ["recently", "recent", "changed lately", "what changed"]);
}

function questionNeedsCountClarification(question: string): boolean {
  const q = normalizeText(getGraceUserQuestion(question));
  return includesAny(q, [
    "how many do we have",
    "how many do i have",
    "how many do we currently have",
    "how many total do we have",
  ]);
}

function findUnsupportedLane(question: string): UnsupportedLane | null {
  const q = normalizeText(getGraceUserQuestion(question));
  if (includesAny(q, ["admission", "move in", "movein", "pending admission"])) return "admissions";
  if (includesAny(q, ["discharge", "move out", "moveout", "transition"])) return "discharge";
  if (includesAny(q, ["medication", "emar", "missed dose", "med error"])) return "medications";
  if (includesAny(q, ["incident", "incident follow up", "incident followup"])) return "incidents";
  if (includesAny(q, ["compliance", "deficiency", "plan of correction", "poc"])) return "compliance";
  if (includesAny(q, ["training", "certification", "in service", "inservice"])) return "training";
  if (includesAny(q, ["transport", "trip", "ride", "mileage", "driver"])) return "transport";
  if (includesAny(q, ["diet", "swallow", "iddsi", "texture", "fluid level"])) return "dietary";
  if (includesAny(q, ["review reply", "reputation", "google review", "yelp"])) return "reputation";
  if (includesAny(q, ["family portal", "family message", "family communication"])) return "family";
  if (includesAny(q, ["executive", "benchmark", "portfolio", "risk map"])) return "executive";
  if (includesAny(q, ["accounts receivable", "ar ", "invoice", "collections", "trial balance", "period close", "journal entry"])) return "finance";
  if (includesAny(q, ["insurance", "claim", "claims", "renewal", "renewals", "coi", "loss run"])) return "insurance";
  if (includesAny(q, ["vendor", "contract", "purchase order", "po ", "spend"])) return "vendors";
  if (includesAny(q, ["facility profile", "emergency contact", "building profile", "survey history"])) return "facility_admin";
  if (includesAny(q, ["scheduled report", "scheduled reports", "report run", "report runs", "saved report", "saved reports", "reports failed", "failed report", "failed reports"])) return "reporting";
  if (includesAny(q, ["rounding", "watch protocol", "resident assurance", "observation task"])) return "rounding";
  return null;
}

function buildUnsupportedLaneClarification(lane: UnsupportedLane): string {
  switch (lane) {
    case "admissions":
      return "I can answer that once you narrow it to one lane: pending admissions, move-in blockers, or resident count.";
    case "discharge":
      return "I can answer that once you narrow it to one lane: pending discharges, discharge paperwork, or resident count.";
    case "medications":
      return "I can answer that once you narrow it to one lane: meds due now, overdue passes, or medication errors.";
    case "incidents":
      return "I can answer that once you narrow it to one lane: open incidents, overdue follow-ups, or resident attention.";
    case "compliance":
      return "I can answer that once you narrow it to one lane: open deficiencies, overdue plans of correction, or policy acknowledgments.";
    case "training":
      return "I can answer that once you narrow it to one lane: certifications expiring, overdue completions, or upcoming in-service sessions.";
    case "transport":
      return "I can answer that once you narrow it to one lane: trips today, missed rides, or mileage approvals.";
    case "dietary":
      return "I can answer that once you narrow it to one lane: diet orders, swallow-risk items, or texture/liquid conflicts.";
    case "reputation":
      return "I can answer that once you narrow it to one lane: unreplied reviews, failed posts, or account status.";
    case "family":
      return "I can answer that once you narrow it to one lane: unread messages, open family triage items, or recent communication hotspots.";
    case "executive":
      return "I can answer that once you narrow it to one lane: top alerts, facility risk, or benchmark outliers.";
    case "finance":
      return "I can answer that once you narrow it to one lane: overdue invoices, collection follow-ups, or close blockers.";
    case "insurance":
      return "I can answer that once you narrow it to one lane: renewals due, open claims, or policy expirations.";
    case "vendors":
      return "I can answer that once you narrow it to one lane: expiring contracts, pending approvals, or recent spend.";
    case "facility_admin":
      return "I can answer that once you narrow it to one lane: facility profile, survey history, or emergency contacts.";
    case "reporting":
      return "I can answer that once you narrow it to one lane: scheduled reports, failed runs, or due-soon reports.";
    case "rounding":
      return "I can answer that once you narrow it to one lane: active watch protocols, overdue observation tasks, or open escalations.";
  }
}

function buildFacilityClarification(accessibleFacilityNames: string[]): string {
  const primary = accessibleFacilityNames[0] ?? "the selected facility";
  return `Do you mean ${primary} only or all facilities?`;
}

function hasExplicitFacilityReference(question: string, accessibleFacilityNames: string[]): boolean {
  const raw = normalizeText(getGraceUserQuestion(question));
  if (includesAny(raw, ["this facility", "here", "selected facility", "current facility"])) return true;
  return accessibleFacilityNames.some((name) => {
    const normalizedName = normalizeText(name);
    if (!normalizedName) return false;
    if (raw.includes(normalizedName)) return true;
    const tokens = normalizedName
      .split(" ")
      .filter((token) => token.length > 2 && !GENERIC_FACILITY_WORDS.has(token) && token !== "alf");
    return tokens.some((token) => raw.includes(token));
  });
}

function looksFacilityScopedQuestion(question: string): boolean {
  const raw = normalizeText(getGraceUserQuestion(question));
  if (questionNeedsCountClarification(question)) return false;
  if (isCensusQuestion(question) || isResidentAttentionQuestion(question)) return true;
  if (isReferralPipelineQuestion(question)) return true;
  if (includesAny(raw, [" in ", " at ", " for "])) {
    const tokens = raw.split(" ");
    return tokens.some((token) => !GENERIC_FACILITY_WORDS.has(token) && token.length > 3);
  }
  return false;
}

export function formatCountOnlyCensusAnswer(
  facilityBreakdown: Array<{ name: string; activeResidents: number }>,
): string {
  if (facilityBreakdown.length === 1) {
    const [facility] = facilityBreakdown;
    return `${facility.name} currently has ${facility.activeResidents} active resident${facility.activeResidents === 1 ? "" : "s"}.`;
  }

  const totalResidents = facilityBreakdown.reduce((sum, facility) => sum + facility.activeResidents, 0);
  return `${totalResidents} active residents are currently in scope across ${facilityBreakdown.length} facilities.\n\n${facilityBreakdown
    .map((facility, index) => `${index + 1}. ${facility.name}: ${facility.activeResidents} active resident${facility.activeResidents === 1 ? "" : "s"}.`)
    .join("\n")}`;
}

export function decideGraceSafeMode(input: {
  question: string;
  accessibleFacilityNames: string[];
}): SafeGraceDecision {
  const { question, accessibleFacilityNames } = input;
  const headerFacility = getGraceHeaderFacility(question);
  const multipleFacilities = accessibleFacilityNames.length > 1;

  if (questionNeedsCountClarification(question)) {
    return {
      kind: "clarify",
      domain: "clarification",
      text: "Do you want resident count, occupancy, or admissions activity?",
      reason: "ambiguous_domain",
    };
  }

  if (questionNeedsTimeClarification(question)) {
    return {
      kind: "clarify",
      domain: "clarification",
      text: "Do you mean today, past 7 days, or past 30 days?",
      reason: "ambiguous_time_window",
    };
  }

  if (isCensusQuestion(question)) {
    if (multipleFacilities && headerFacility === null && !hasExplicitFacilityReference(question, accessibleFacilityNames) && looksFacilityScopedQuestion(question)) {
      return {
        kind: "clarify",
        domain: "census",
        text: buildFacilityClarification(accessibleFacilityNames),
        reason: "ambiguous_scope",
      };
    }
    return { kind: "route", domain: "census" };
  }

  if (isResidentAttentionQuestion(question)) {
    if (multipleFacilities && headerFacility === null && !hasExplicitFacilityReference(question, accessibleFacilityNames)) {
      return {
        kind: "clarify",
        domain: "resident_attention",
        text: buildFacilityClarification(accessibleFacilityNames),
        reason: "ambiguous_scope",
      };
    }
    return { kind: "route", domain: "resident_attention" };
  }

  if (isReferralPipelineQuestion(question)) {
    if (multipleFacilities && headerFacility === null && !hasExplicitFacilityReference(question, accessibleFacilityNames) && !question.toLowerCase().includes("all facilities")) {
      return {
        kind: "clarify",
        domain: "referral_pipeline",
        text: buildFacilityClarification(accessibleFacilityNames),
        reason: "ambiguous_scope",
      };
    }
    return { kind: "route", domain: "referral_pipeline" };
  }

  if (isSemanticKbQuestion(question)) {
    return { kind: "agentic" };
  }

  const unsupportedLane = findUnsupportedLane(question);
  if (unsupportedLane) {
    return {
      kind: "clarify",
      domain: "clarification",
      text: buildUnsupportedLaneClarification(unsupportedLane),
      reason: "domain_not_implemented",
    };
  }

  if (getGraceUserQuestion(question).trim().split(/\s+/).length <= 5) {
    return {
      kind: "clarify",
      domain: "clarification",
      text: "Do you want resident count, new leads, or who needs attention?",
      reason: "ambiguous_domain",
    };
  }

  return { kind: "agentic" };
}
