import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type MeetingStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type ActionItemStatus = "open" | "completed" | "cancelled";

export type MeetingTemplateRow = {
  id: string;
  name: string;
  description: string | null;
  cadence: string;
  default_agenda: string[];
};

export type MeetingRow = {
  id: string;
  template_id: string | null;
  title: string;
  scheduled_at: string;
  status: MeetingStatus;
  agenda: string[];
  minutes: string | null;
  attendees: string[];
};

export type ActionItemRow = {
  id: string;
  meeting_id: string;
  description: string;
  assigned_to: string | null;
  due_date: string | null;
  status: ActionItemStatus;
  oce_task_instance_id: string | null;
};

export type QueryError = { message: string };
export type QueryResult<T> = { data: T[] | null; error: QueryError | null };

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function meetingStatusTone(
  status: string,
): "warning" | "info" | "muted" | "danger" {
  if (status === "in_progress") return "warning";
  if (status === "scheduled") return "info";
  if (status === "cancelled") return "danger";
  return "muted";
}

/** Splits textarea input into trimmed non-empty lines. */
export function linesToArray(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export type ActorContext = {
  userId: string;
  organizationId: string;
};

export async function fetchActorContext(
  supabase: SupabaseClient<Database>,
): Promise<ActorContext | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return null;
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("organization_id")
    .eq("id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  const organizationId = (profile as { organization_id: string | null } | null)?.organization_id;
  if (!organizationId) return null;
  return { userId: user.id, organizationId };
}
