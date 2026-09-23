import { formatDisplayDate } from "@/lib/format/datetime";

/**
 * Review-queue labels for /admin/knowledge/admin.
 *
 * The Ready / Assigned to me / Unassigned / Overdue tiles count documents in
 * `pending_review` only. The row column used to print "Unassigned / No due
 * date" for every document, published ones included, so the page showed
 * "Unassigned 0" above a table where every row read Unassigned (COL-649).
 * A document outside review has no reviewer to assign.
 */

export const KB_NOT_IN_REVIEW_COPY = "Not in review";

export function knowledgeReviewOwnerLabel(
  doc: { status: string; review_owner: string | null },
  currentUserId: string | null | undefined,
): string {
  if (doc.status !== "pending_review") return KB_NOT_IN_REVIEW_COPY;
  if (!doc.review_owner) return "Unassigned";
  if (currentUserId && doc.review_owner === currentUserId) return "You";
  return "Assigned";
}

/** Second line of the review column; empty for documents outside review. */
export function knowledgeReviewDueLabel(
  doc: { status: string; review_due_at: string | null },
): string | null {
  if (doc.status !== "pending_review") return null;
  return doc.review_due_at ? `Due ${formatDisplayDate(doc.review_due_at)}` : "No due date";
}
