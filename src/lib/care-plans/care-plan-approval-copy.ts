/**
 * Quiet Operator copy for care-plan approval: who may sign, and what signing does not do.
 * The refusal sentence is shared with the approve route and the 393 trigger so every
 * layer says the same thing.
 */

export const CARE_PLAN_AUTHOR_APPROVAL_REFUSED = "The author of a care plan cannot approve it";
export const CARE_PLAN_AUTHOR_CANNOT_APPROVE_COPY =
  "You drafted this version — another authorized reviewer signs it.";
export const CARE_PLAN_APPROVAL_RATE_COPY =
  "Approving does not change the resident's acuity level or care surcharge.";
export const CARE_PLAN_NO_ACUITY_COPY = "No acuity level posted";

/** True when the signed-in user is the version's recorded author. Unknown author → not the author. */
export function isCarePlanAuthor(createdBy: string | null | undefined, userId: string | null | undefined): boolean {
  if (!createdBy || !userId) return false;
  return createdBy === userId;
}

/** `level_2` → `Level 2`, matching the invoice line label; missing → explicit empty copy. */
export function formatCarePlanAcuityLabel(acuity: string | null | undefined): string {
  const match = /^level_(\d+)$/.exec((acuity ?? "").trim());
  if (!match) return CARE_PLAN_NO_ACUITY_COPY;
  return `Level ${match[1]}`;
}
