export type IncidentFollowupAssigneeOption = {
  id: string;
  label: string;
  appRole: string;
};

export async function fetchIncidentFollowupAssignees(facilityId: string) {
  const response = await fetch(`/api/incidents/followup-assignees?facilityId=${encodeURIComponent(facilityId)}`, {
    method: "GET",
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; assigneeOptions?: IncidentFollowupAssigneeOption[]; error?: string }
    | null;

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || "Could not load incident assignees.");
  }

  return payload.assigneeOptions ?? [];
}
