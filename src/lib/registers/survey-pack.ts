import { SURVEY_PACK_DEFAULT_MONTHS } from "@/lib/registers/register";
import { easternDateInputValue, monthsAgoEastern } from "@/lib/registers/register-display-copy";

/**
 * The survey print pack.
 *
 * What a surveyor asks for at the door: who is in which room right now, who
 * moved in and out, what the census was, and who has been in the building. Printed from Haven, stamped with who
 * printed it, and recorded as an audit event so there is a record of what was
 * handed over. No PDF library: it is a Haven page with print styles.
 */

export const SURVEY_PACK_SECTIONS = [
  // First because it is the first thing asked for, and the sheet a fire crew needs (DEC-2026-09-22-10).
  { id: "room_census", label: "Current census by room" },
  { id: "register", label: "Admission and discharge register" },
  { id: "census", label: "Census record" },
  { id: "visitors", label: "Visitor log" },
] as const;

export type SurveyPackSectionId = (typeof SURVEY_PACK_SECTIONS)[number]["id"];

export function surveyPackSectionLabel(id: string): string {
  return SURVEY_PACK_SECTIONS.find((section) => section.id === id)?.label ?? id;
}

export type SurveyPackRequest = {
  sections: SurveyPackSectionId[];
  includeHolds: boolean;
  from: string;
  to: string;
};

/** The prior six months ending today, which is what a walk in usually asks for. */
export function defaultSurveyPackRequest(now: Date = new Date()): SurveyPackRequest {
  return {
    sections: ["room_census", "register", "census", "visitors"],
    includeHolds: true,
    from: monthsAgoEastern(SURVEY_PACK_DEFAULT_MONTHS, now),
    to: easternDateInputValue(now),
  };
}

export function validateSurveyPackRequest(request: SurveyPackRequest): string[] {
  const problems: string[] = [];
  if (request.sections.length === 0) problems.push("Choose at least one section to print.");
  if (!request.from || !request.to) problems.push("Choose a date range to print.");
  else if (request.to < request.from) problems.push("The end of the range is before the start.");
  return problems;
}

/** The address of the print view for a request. */
export function surveyPackPrintHref(request: SurveyPackRequest): string {
  const params = new URLSearchParams({
    from: request.from,
    to: request.to,
    sections: request.sections.join(","),
    holds: request.includeHolds ? "1" : "0",
  });
  return `/print/survey-pack?${params.toString()}`;
}

export function parseSurveyPackRequest(params: URLSearchParams): SurveyPackRequest {
  const raw = (params.get("sections") ?? "").split(",").filter(Boolean);
  const sections = SURVEY_PACK_SECTIONS.map((section) => section.id).filter((id) =>
    raw.includes(id),
  );
  return {
    sections,
    includeHolds: params.get("holds") !== "0",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };
}

export const SURVEY_PACK_AUDIT_FAILURE_COPY = "Print could not be recorded. Try again.";

/** `January 5, 2026 to June 30, 2026` for a section heading. */
export function formatSurveyPackRange(from: string, to: string): string {
  const format = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(new Date(`${value}T12:00:00Z`));
  return `${format(from)} to ${format(to)}`;
}
