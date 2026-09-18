/**
 * Witness statements: Section 3 of COL's paper incident form (spec 07A §5,
 * Appendix A), as follow-up tasks a caregiver completes with one tap.
 *
 * The three choices are the whole answer. A voice note is optional and nothing
 * on this path requires typing, which is the rule the observation form obeys
 * and the old incident form broke.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/types/database";

type Client = SupabaseClient<Database>;

export const WITNESS_TASK_TYPE = "witness_statement";

export type WitnessChoice = "saw_it" | "did_not_see_it" | "arrived_after";

export const WITNESS_CHOICES: ReadonlyArray<{ value: WitnessChoice; label: string; hint: string }> = [
  { value: "saw_it", label: "I saw it", hint: "You were there and watched it happen." },
  { value: "did_not_see_it", label: "I did not see it", hint: "You were on shift but did not see it." },
  { value: "arrived_after", label: "I arrived after", hint: "You came to help once it had already happened." },
];

const CHOICE_LABELS: Record<WitnessChoice, string> = {
  saw_it: "Saw it",
  did_not_see_it: "Did not see it",
  arrived_after: "Arrived after",
};

export function witnessChoiceLabel(choice: string | null | undefined): string {
  if (!choice) return "Not answered yet";
  return CHOICE_LABELS[choice as WitnessChoice] ?? "Not answered yet";
}

export function isWitnessChoice(value: unknown): value is WitnessChoice {
  return value === "saw_it" || value === "did_not_see_it" || value === "arrived_after";
}

export type WitnessTask = {
  id: string;
  incidentId: string;
  incidentNumber: string | null;
  careEventId: string | null;
  description: string;
  dueAt: string;
  assignedTo: string | null;
  assignedToName: string | null;
  completedAt: string | null;
  completedBy: string | null;
  choice: WitnessChoice | null;
  note: string | null;
};

type FollowupRow = {
  id: string;
  incident_id: string;
  description: string;
  due_at: string;
  assigned_to: string | null;
  completed_at: string | null;
  completed_by: string | null;
  witness_choice: string | null;
  completion_notes: string | null;
};

function toTask(
  row: FollowupRow,
  incidentNumbers: Map<string, string>,
  careEventIds: Map<string, string>,
  names: Map<string, string | null>,
): WitnessTask {
  return {
    id: row.id,
    incidentId: row.incident_id,
    incidentNumber: incidentNumbers.get(row.incident_id) ?? null,
    careEventId: careEventIds.get(row.incident_id) ?? null,
    description: row.description,
    dueAt: row.due_at,
    assignedTo: row.assigned_to,
    assignedToName: row.assigned_to ? (names.get(row.assigned_to) ?? null) : null,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    choice: isWitnessChoice(row.witness_choice) ? row.witness_choice : null,
    note: row.completion_notes,
  };
}

/**
 * Decorates raw follow-up rows with the incident number, the care event they
 * belong to and the assignee's name. Kept apart from the query so both the
 * caregiver list and the administrator card can reuse it.
 */
async function decorate(supabase: Client, rows: FollowupRow[]): Promise<WitnessTask[]> {
  if (rows.length === 0) return [];
  const incidentIds = [...new Set(rows.map((row) => row.incident_id))];
  const userIds = [...new Set(rows.flatMap((row) => [row.assigned_to, row.completed_by].filter((id): id is string => Boolean(id))))];

  const [incidents, events, profiles] = await Promise.all([
    supabase.from("incidents").select("id, incident_number").in("id", incidentIds),
    supabase.from("care_events").select("id, incident_id").in("incident_id", incidentIds),
    userIds.length > 0
      ? supabase.from("user_profiles").select("id, full_name").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (incidents.error) throw incidents.error;
  if (events.error) throw events.error;
  if (profiles.error) throw profiles.error;

  const incidentNumbers = new Map((incidents.data ?? []).map((row) => [row.id, row.incident_number] as const));
  const careEventIds = new Map(
    (events.data ?? [])
      .filter((row): row is { id: string; incident_id: string } => Boolean(row.incident_id))
      .map((row) => [row.incident_id, row.id] as const),
  );
  const names = new Map((profiles.data ?? []).map((row) => [row.id, row.full_name] as const));

  return rows.map((row) => toTask(row, incidentNumbers, careEventIds, names));
}

const FOLLOWUP_COLUMNS = "id, incident_id, description, due_at, assigned_to, completed_at, completed_by, witness_choice, completion_notes";

/** The signed-in caregiver's own open witness statements, soonest due first. */
export async function fetchMyWitnessTasks(supabase: Client, userId: string): Promise<WitnessTask[]> {
  const result = await supabase
    .from("incident_followups")
    .select(FOLLOWUP_COLUMNS)
    .eq("task_type", WITNESS_TASK_TYPE)
    .eq("assigned_to", userId)
    .is("completed_at", null)
    .is("deleted_at", null)
    .order("due_at", { ascending: true })
    .limit(30);
  if (result.error) throw result.error;
  return decorate(supabase, (result.data ?? []) as FollowupRow[]);
}

/** Every witness statement on one incident, answered or not, for the card and the print. */
export async function fetchWitnessTasksForIncident(supabase: Client, incidentId: string): Promise<WitnessTask[]> {
  const result = await supabase
    .from("incident_followups")
    .select(FOLLOWUP_COLUMNS)
    .eq("task_type", WITNESS_TASK_TYPE)
    .eq("incident_id", incidentId)
    .is("deleted_at", null)
    .order("due_at", { ascending: true });
  if (result.error) throw result.error;
  return decorate(supabase, (result.data ?? []) as FollowupRow[]);
}

export async function completeWitnessTask(
  supabase: Client,
  input: { followupId: string; choice: WitnessChoice; note?: string | null },
): Promise<void> {
  const result = await supabase.rpc("complete_incident_followup", {
    p_followup_id: input.followupId,
    p_choice: input.choice,
    p_note: input.note?.trim() ? input.note.trim() : null,
  });
  if (result.error) throw result.error;
}

export async function addWitness(supabase: Client, careEventId: string, userId: string): Promise<void> {
  const result = await supabase.rpc("care_event_add_witness", {
    p_care_event_id: careEventId,
    p_user_id: userId,
  });
  if (result.error) throw result.error;
}

export async function removeWitness(supabase: Client, followupId: string, reason?: string | null): Promise<void> {
  const result = await supabase.rpc("care_event_remove_witness", {
    p_followup_id: followupId,
    p_reason: reason?.trim() ? reason.trim() : null,
  });
  if (result.error) throw result.error;
}

/** Staff at the caller's facility who could be added as a witness. */
export async function fetchWitnessCandidates(
  supabase: Client,
  facilityId: string,
): Promise<Array<{ userId: string; name: string }>> {
  const result = await supabase
    .from("staff")
    .select("user_id, first_name, last_name")
    .eq("facility_id", facilityId)
    .eq("employment_status", "active")
    .is("deleted_at", null)
    .not("user_id", "is", null)
    .order("last_name", { ascending: true })
    .limit(200);
  if (result.error) throw result.error;
  return (result.data ?? [])
    .filter((row): row is { user_id: string; first_name: string; last_name: string } => Boolean(row.user_id))
    .map((row) => ({ userId: row.user_id, name: `${row.last_name}, ${row.first_name}` }));
}

/** Plain lines for the failures this path can actually produce. */
export function describeWitnessError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/given by the person it was assigned to/i.test(message)) return "That statement belongs to somebody else.";
  if (/already complete/i.test(message)) return "That statement is already on file.";
  if (/choose I saw it/i.test(message)) return "Pick one of the three answers.";
  if (/stays on the record/i.test(message)) return "A statement that has been given cannot be removed.";
  if (/the reporter already gave the account/i.test(message)) return "The person who reported the event does not give a witness statement.";
  if (/not at a facility you can see/i.test(message)) return "That staff member is not at this facility.";
  if (/forbidden/i.test(message)) return "That is not yours to do.";
  return "That did not save. Try again.";
}

/** The answers as the printed form's Section 3 reads them. */
export function witnessSummaryLine(tasks: readonly WitnessTask[]): string {
  const answered = tasks.filter((task) => task.completedAt !== null).length;
  if (tasks.length === 0) return "No witness statements were requested.";
  if (answered === 0) return `${tasks.length} requested, none given yet.`;
  if (answered === tasks.length) return `${answered} of ${tasks.length} given.`;
  return `${answered} of ${tasks.length} given.`;
}

export type { Json };
