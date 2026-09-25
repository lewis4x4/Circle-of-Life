/**
 * Destination choice rules for the review page.
 *
 * The reviewer approves who or what a document is about. A proposal may
 * suggest a candidate, but when two candidates share a name the page never
 * picks one for them: identity is an explicit choice.
 */
import type { Candidate, CatalogRow, ProposalRow, SubjectKind } from "@/lib/document-intake/contracts";

export type SubjectChoice = {
  subject_id: string;
  label: string;
  requirement_id?: string | null;
};

/** "Jane Doe — Room 12" → "jane doe". The name part is what collides. */
export function candidateName(label: string): string {
  return label.split(/\s[—–-]\s|\s·\s|,\s/)[0].trim().replace(/\s+/g, " ").toLowerCase();
}

/** Candidates of one kind whose name is shared with another candidate of that kind. */
export function ambiguousCandidateIndexes(candidates: readonly Candidate[]): Set<number> {
  const byName = new Map<string, number[]>();
  candidates.forEach((candidate, index) => {
    if (candidate.kind === "none" || !candidate.subject_id) return;
    const key = `${candidate.kind}:${candidateName(candidate.label)}`;
    byName.set(key, [...(byName.get(key) ?? []), index]);
  });
  const out = new Set<number>();
  for (const indexes of byName.values()) {
    const distinctSubjects = new Set(indexes.map((i) => candidates[i].subject_id));
    if (distinctSubjects.size > 1) indexes.forEach((i) => out.add(i));
  }
  return out;
}

/**
 * The candidate the page may start with, or null. Null when the proposal named
 * none, named "none", named one without a subject, or named one whose name is
 * shared with a different subject.
 */
export function initialCandidateIndex(proposal: Pick<ProposalRow, "candidates" | "proposed_candidate"> | null): number | null {
  if (!proposal || proposal.proposed_candidate == null) return null;
  const index = proposal.proposed_candidate;
  const candidate = proposal.candidates[index];
  if (!candidate || candidate.kind === "none" || !candidate.subject_id) return null;
  if (ambiguousCandidateIndexes(proposal.candidates).has(index)) return null;
  return index;
}

/** Does this candidate fit the chosen document type? */
export function candidateFitsCatalog(candidate: Candidate, catalog: Pick<CatalogRow, "destination_kind"> | null): boolean {
  return !!catalog && candidate.kind !== "none" && candidate.kind === catalog.destination_kind && !!candidate.subject_id;
}

/**
 * No safe destination: the reader looked but proposed nothing a reviewer can
 * file to. Distinct from "no matching requirement" (staff file exists, but the
 * facility has no requirement of that kind).
 */
export function hasNoSafeDestination(proposal: Pick<ProposalRow, "candidates" | "proposed_candidate"> | null): boolean {
  if (!proposal) return false;
  const usable = proposal.candidates.filter((c) => c.kind !== "none" && c.subject_id);
  if (usable.length === 0) return true;
  const proposed = proposal.proposed_candidate == null ? null : proposal.candidates[proposal.proposed_candidate];
  return proposed?.kind === "none";
}

export type CatalogGroup = { group: CatalogRow["document_group"]; label: string; rows: CatalogRow[] };

const GROUP_LABELS: Record<CatalogRow["document_group"], string> = {
  resident: "Resident record",
  medicaid: "Medicaid case",
  staff: "Staff file",
  facility: "Facility",
  vendor: "Vendor",
  other: "Other",
};
const GROUP_ORDER: CatalogRow["document_group"][] = ["resident", "medicaid", "staff", "facility", "vendor", "other"];

export function groupCatalog(rows: readonly CatalogRow[]): CatalogGroup[] {
  return GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    rows: rows.filter((row) => row.active && row.document_group === group).sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label)),
  })).filter((g) => g.rows.length > 0);
}

export const SUBJECT_NOUN: Record<SubjectKind, string> = {
  resident: "resident",
  staff: "employee",
  medicaid_case: "Medicaid case",
  facility: "facility",
  none: "destination",
};

/**
 * Same-name disambiguation for a search result list: people who share a
 * display name get their date of birth shown, nobody else does.
 */
export function namesNeedingDisambiguation(names: readonly string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const name of names) {
    const key = name.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n > 1).map(([key]) => key));
}

export type FilingDraft = {
  title: string;
  catalogCode: string;
  subject: SubjectChoice | null;
  requirementId: string | null;
  documentDate: string;
  expirationDate: string;
};

/** The filing RPC's own wording, shown as-is when the facility has no requirement of the type's kind. */
export const NO_REQUIREMENT_MESSAGE = "No staff file requirement of this kind exists for the facility";

export type FilingReadiness = { ready: true } | { ready: false; reason: string };

export function filingReadiness(
  draft: FilingDraft,
  catalog: CatalogRow | null,
  opts: { requirementRequired: boolean; facilityKnown: boolean },
): FilingReadiness {
  if (!opts.facilityKnown) return { ready: false, reason: "Set the facility first." };
  if (!catalog) return { ready: false, reason: "Pick a document type." };
  if (catalog.destination_kind === "none") return { ready: false, reason: "This type has no filing destination." };
  if (!draft.title.trim()) return { ready: false, reason: "Give the document a title." };
  if (draft.title.trim().length > 200) return { ready: false, reason: "Titles must be 200 characters or fewer." };
  if (catalog.subject_kind !== "facility" && !draft.subject) return { ready: false, reason: `Pick the ${SUBJECT_NOUN[catalog.subject_kind]}.` };
  if (catalog.destination_kind === "employee_file" && opts.requirementRequired && !draft.requirementId) {
    return { ready: false, reason: NO_REQUIREMENT_MESSAGE };
  }
  if (draft.documentDate && draft.expirationDate && draft.expirationDate < draft.documentDate) {
    return { ready: false, reason: "The expiration date is before the document date." };
  }
  return { ready: true };
}
