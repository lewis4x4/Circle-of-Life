import { describeClinicalQueue, type ClinicalQueueState } from "@/lib/clinical/clinical-queue-state";

/**
 * Quiet Operator resident labels for overdue assessment and care-plan review queues.
 * Missing resident rows and blank names name real gaps — never fabricate resident names.
 */

export const OVERDUE_ASSESSMENTS_NO_RESIDENT_POSTED_COPY = "No resident posted";
export const OVERDUE_ASSESSMENTS_NO_NAME_POSTED_COPY = "No name posted";

const EM_DASH = "—";

function isBlankOrEmDash(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = String(value).trim();
  return trimmed === "" || trimmed === EM_DASH;
}

export type OverdueAssessmentsResidentNameFields = {
  first_name: string | null;
  last_name: string | null;
};

/** Trim/join resident name fields — no fabricated fallback. */
export function overdueAssessmentsResidentNameFromFields(
  resident: OverdueAssessmentsResidentNameFields,
): string {
  return `${resident.first_name?.trim() ?? ""} ${resident.last_name?.trim() ?? ""}`.trim();
}

/** Resident label on an overdue assessment or care-plan review row when the join or name is unset, blank, or em dash. */
export function formatOverdueAssessmentsResidentLabel(
  resident: OverdueAssessmentsResidentNameFields | null | undefined,
): string {
  if (!resident) return OVERDUE_ASSESSMENTS_NO_RESIDENT_POSTED_COPY;
  const name = overdueAssessmentsResidentNameFromFields(resident);
  if (isBlankOrEmDash(name)) return OVERDUE_ASSESSMENTS_NO_NAME_POSTED_COPY;
  return name;
}

export type ClinicalDeskEmptyCopy = { title: string; body: string };

/**
 * Empty-queue copy for the two Clinical Desk panes (COL-649). "All Clear" is
 * reachable only through describeClinicalQueue → canClaimAllClear: a
 * successful read over records that exist. No facility, a failed read, or
 * nothing on file each say so instead.
 */
const CLINICAL_DESK_EMPTY: Record<"assessments" | "carePlans", Record<Exclude<ClinicalQueueState, "items">, ClinicalDeskEmptyCopy>> = {
  assessments: {
    needs_facility: { title: "Select a facility", body: "Choose a facility to check its assessment due dates." },
    unavailable: { title: "Couldn't load", body: "Assessment due dates could not be read, so this is not an all-clear." },
    nothing_on_file: {
      title: "No assessments on file",
      body: "No resident in this facility has an assessment yet, so nothing can be overdue. That is a gap, not an all-clear.",
    },
    clear: { title: "All Clear", body: "No overdue assessments." },
  },
  carePlans: {
    needs_facility: { title: "Select a facility", body: "Choose a facility to check its care plan reviews." },
    unavailable: { title: "Couldn't load", body: "Care plan reviews could not be read, so this is not an all-clear." },
    nothing_on_file: {
      title: "No active care plans",
      body: "No resident in this facility has an active care plan, so no review can be due. Start from the Form 1823 alignment queue.",
    },
    clear: { title: "All Clear", body: "No drafts awaiting review." },
  },
};

export function clinicalDeskQueueState(input: {
  scopeReady: boolean;
  error?: unknown;
  scopeSize: number | null | undefined;
  itemCount: number;
}): ClinicalQueueState {
  return describeClinicalQueue(input);
}

export function clinicalDeskEmptyCopy(
  pane: "assessments" | "carePlans",
  state: Exclude<ClinicalQueueState, "items">,
): ClinicalDeskEmptyCopy {
  return CLINICAL_DESK_EMPTY[pane][state];
}
