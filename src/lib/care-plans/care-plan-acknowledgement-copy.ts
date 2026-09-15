/**
 * Quiet Operator copy for resident / representative acknowledgement of a care plan.
 * Shared by the recording form, the API route, and the printed sheet.
 */

export const CARE_PLAN_ACK_SIGNER_ROLES = ["resident", "responsible_party", "poa", "guardian"] as const;
export type CarePlanAckSignerRole = (typeof CARE_PLAN_ACK_SIGNER_ROLES)[number];

export const CARE_PLAN_ACK_METHODS = ["in_person_signature", "paper_on_file", "verbal_review", "declined"] as const;
export type CarePlanAckMethod = (typeof CARE_PLAN_ACK_METHODS)[number];

export const CARE_PLAN_ACK_ROLE_LABELS: Record<CarePlanAckSignerRole, string> = {
  resident: "Resident",
  responsible_party: "Responsible party",
  poa: "Power of attorney",
  guardian: "Guardian",
};

export const CARE_PLAN_ACK_METHOD_LABELS: Record<CarePlanAckMethod, string> = {
  in_person_signature: "Signed in person",
  paper_on_file: "Signed on paper (on file)",
  verbal_review: "Reviewed verbally",
  declined: "Declined to sign",
};

export const CARE_PLAN_ACK_NONE_COPY = "No resident or representative acknowledgement recorded.";
export const CARE_PLAN_ACK_ONLY_ACTIVE_COPY = "Acknowledgements are recorded against the signed, active plan.";
export const CARE_PLAN_ACK_SIGNATURE_REQUIRED_COPY = "An in-person acknowledgement needs a signature.";
export const CARE_PLAN_ACK_NAME_REQUIRED_COPY = "Name the person acknowledging the plan.";
export const CARE_PLAN_ACK_PRINT_RESIDENT_LINE = "Resident signature";
export const CARE_PLAN_ACK_PRINT_REPRESENTATIVE_LINE = "Representative signature";

export function isCarePlanAckSignerRole(value: unknown): value is CarePlanAckSignerRole {
  return typeof value === "string" && (CARE_PLAN_ACK_SIGNER_ROLES as readonly string[]).includes(value);
}

export function isCarePlanAckMethod(value: unknown): value is CarePlanAckMethod {
  return typeof value === "string" && (CARE_PLAN_ACK_METHODS as readonly string[]).includes(value);
}

export function formatCarePlanAckRole(role: string | null | undefined): string {
  return isCarePlanAckSignerRole(role) ? CARE_PLAN_ACK_ROLE_LABELS[role] : "Signer";
}

export function formatCarePlanAckMethod(method: string | null | undefined): string {
  return isCarePlanAckMethod(method) ? CARE_PLAN_ACK_METHOD_LABELS[method] : "Acknowledged";
}

/** "Alice Hardin (daughter)" — relationship only when posted. */
export function formatCarePlanAckSigner(name: string | null | undefined, relationship: string | null | undefined): string {
  const trimmedName = (name ?? "").trim() || "No name posted";
  const trimmedRelationship = (relationship ?? "").trim();
  return trimmedRelationship ? `${trimmedName} (${trimmedRelationship})` : trimmedName;
}
