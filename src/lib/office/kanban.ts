export type CardStatus = "todo" | "in_progress" | "done";

export const KANBAN_COLUMNS: { id: CardStatus; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "in_progress", label: "In progress" },
  { id: "done", label: "Done" },
];

export type WorkspaceCardRow = {
  id: string;
  title: string;
  details: string | null;
  status: CardStatus;
  position: number;
  due_date: string | null;
  source_oce_instance_id: string | null;
};

export type OceTaskMini = {
  id: string;
  template_name: string;
  priority: string;
  status: string;
  due_at: string | null;
  assigned_shift_date: string;
};

export type QueryError = { message: string };
export type QueryResult<T> = { data: T[] | null; error: QueryError | null };

/** Map an OCE task status onto a kanban column. */
export function oceStatusToColumn(status: string): CardStatus {
  if (status === "completed") return "done";
  if (status === "in_progress") return "in_progress";
  return "todo";
}

/** Next column when moving a card right; null at the end. */
export function nextColumn(status: CardStatus): CardStatus | null {
  if (status === "todo") return "in_progress";
  if (status === "in_progress") return "done";
  return null;
}

/** Previous column when moving a card left; null at the start. */
export function prevColumn(status: CardStatus): CardStatus | null {
  if (status === "done") return "in_progress";
  if (status === "in_progress") return "todo";
  return null;
}

export function priorityTone(priority: string): "danger" | "warning" | "info" | "muted" {
  switch (priority) {
    case "critical":
      return "danger";
    case "high":
      return "warning";
    case "normal":
      return "info";
    default:
      return "muted";
  }
}
