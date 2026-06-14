export type TemplateKind =
  | "blank"
  | "shift_report"
  | "incident_follow_up"
  | "one_on_one"
  | "meeting_notes"
  | "family_call_log";

export type PageVisibility = "private" | "team" | "org";

export const PAGE_TEMPLATES: { id: TemplateKind; label: string; title: string; body: string }[] = [
  { id: "blank", label: "Blank page", title: "Untitled", body: "" },
  {
    id: "shift_report",
    label: "Shift report",
    title: "Shift report",
    body: "Shift:\nStaff on duty:\n\nResident updates:\n- \n\nIncidents / concerns:\n- \n\nFollow-ups for next shift:\n- ",
  },
  {
    id: "incident_follow_up",
    label: "Incident follow-up",
    title: "Incident follow-up",
    body: "Incident reference:\nDate:\n\nWhat happened:\n\nActions taken:\n- \n\nOpen follow-ups:\n- ",
  },
  {
    id: "one_on_one",
    label: "1:1 notes",
    title: "1:1 notes",
    body: "With:\nDate:\n\nWins:\n- \n\nChallenges:\n- \n\nAction items:\n- ",
  },
  {
    id: "meeting_notes",
    label: "Meeting notes",
    title: "Meeting notes",
    body: "Meeting:\nDate:\nAttendees:\n\nDiscussion:\n- \n\nDecisions:\n- \n\nAction items:\n- ",
  },
  {
    id: "family_call_log",
    label: "Family call log",
    title: "Family call log",
    body: "Resident:\nCaller / relationship:\nDate / time:\n\nSummary:\n\nFollow-up needed:",
  },
];

export type WorkspacePageRow = {
  id: string;
  owner_user_id: string;
  title: string;
  body: string;
  template_kind: TemplateKind;
  visibility: PageVisibility;
  version: number;
  updated_at: string;
  created_at: string;
};

export type WorkspacePageVersionRow = {
  id: string;
  version: number;
  title: string;
  body: string;
  created_at: string;
};

export type QueryError = { message: string };
export type QueryResult<T> = { data: T[] | null; error: QueryError | null };

export function templateLabel(id: string): string {
  return PAGE_TEMPLATES.find((t) => t.id === id)?.label ?? id.replace(/_/g, " ");
}

export function templateById(id: TemplateKind) {
  return PAGE_TEMPLATES.find((t) => t.id === id) ?? PAGE_TEMPLATES[0];
}
