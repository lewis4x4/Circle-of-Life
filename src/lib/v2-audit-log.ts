import { createClient } from "@/lib/supabase/server";

export type V2AuditLogRow = {
  id: string;
  facilityId: string | null;
  alertId: string;
  action: string;
  actorId: string | null;
  actorRole: string | null;
  note: string | null;
  createdAt: string;
};

export type V2AuditLogLoad = {
  rows: V2AuditLogRow[];
  totalShown: number;
};

type DbRow = {
  id: string;
  facility_id: string | null;
  alert_id: string;
  action: string;
  actor_id: string | null;
  actor_role: string | null;
  note: string | null;
  created_at: string;
};

type Result = { data: DbRow[] | null; error: { message: string } | null };

export async function loadV2AuditLog(limit = 100): Promise<V2AuditLogLoad> {
  const supabase = await createClient();
  const result = (await supabase
    .from("alert_audit_log" as never)
    .select(
      "id, facility_id, alert_id, action, actor_id, actor_role, note, created_at",
    )
    .order("created_at" as never, { ascending: false })
    .limit(limit)) as unknown as Result;

  if (result.error || !result.data) {
    return { rows: [], totalShown: 0 };
  }

  const rows: V2AuditLogRow[] = result.data.map((row) => ({
    id: row.id,
    facilityId: row.facility_id,
    alertId: row.alert_id,
    action: row.action,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    note: row.note,
    createdAt: row.created_at,
  }));

  return { rows, totalShown: rows.length };
}
