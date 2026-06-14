export type CommentSubjectType =
  | "workspace_page"
  | "workspace_card"
  | "shift_handoff_note"
  | "team_space";

export type CommentRow = {
  id: string;
  subject_type: CommentSubjectType;
  subject_id: string;
  author_user_id: string;
  body: string;
  mentioned_user_ids: string[];
  created_at: string;
};

export type CommentUserMini = {
  id: string;
  full_name: string;
  email: string;
};

export type QueryError = { message: string };
export type QueryResult<T> = { data: T[] | null; error: QueryError | null };

export function commentUserLabel(id: string, users: CommentUserMini[]): string {
  const u = users.find((x) => x.id === id);
  return u ? u.full_name || u.email : "Someone";
}

export const SUBJECT_LABELS: Record<CommentSubjectType, string> = {
  workspace_page: "Page",
  workspace_card: "Card",
  shift_handoff_note: "Handoff note",
  team_space: "Team space",
};
