export type PublishStatus = "submitted" | "approved" | "rejected" | "published";

export const PUBLISH_AUDIENCES: { id: string; label: string }[] = [
  { id: "company_wide", label: "Company-wide" },
  { id: "clinical", label: "Clinical staff" },
  { id: "administrative", label: "Administrative" },
  { id: "leadership", label: "Leadership" },
];

export const REVIEWER_ROLES = ["owner", "org_admin", "facility_admin", "manager"] as const;

export type PublishRequestRow = {
  id: string;
  page_id: string;
  requested_by: string;
  title: string;
  body: string;
  target_audience: string;
  rationale: string | null;
  status: PublishStatus;
  reviewer_id: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  published_document_id: string | null;
  created_at: string;
};

export type QueryError = { message: string };
export type QueryResult<T> = { data: T[] | null; error: QueryError | null };

export function publishStatusTone(
  status: PublishStatus,
): "muted" | "info" | "success" | "danger" | "warning" {
  switch (status) {
    case "submitted":
      return "warning";
    case "approved":
      return "info";
    case "published":
      return "success";
    case "rejected":
      return "danger";
    default:
      return "muted";
  }
}

export function audienceLabel(id: string): string {
  return PUBLISH_AUDIENCES.find((a) => a.id === id)?.label ?? id.replace(/_/g, " ");
}

export function isReviewerRole(role: string | null): boolean {
  return !!role && (REVIEWER_ROLES as readonly string[]).includes(role);
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
