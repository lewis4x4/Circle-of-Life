import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type StaffMessageThread = {
  residentId: string;
  residentName: string;
  roomLabel: string;
  facilityName: string;
  lastMessageBody: string;
  lastMessageAt: string;
  lastMessageAtIso: string;
  lastAuthorKind: "family" | "staff";
  unreadHint: boolean;
  messageCount: number;
  triageItemId: string | null;
  triageStatus: Database["public"]["Enums"]["family_message_triage_status"] | null;
  triageKeywords: string[];
};

export type StaffMessageRow = {
  id: string;
  authorName: string;
  authorKind: "family" | "staff";
  body: string;
  createdAt: string;
};

type MsgRow = {
  id: string;
  resident_id: string;
  author_user_id: string;
  author_kind: "family" | "staff";
  body: string;
  created_at: string;
};

type ResRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  bed_id: string | null;
};

type ProfileRow = {
  id: string;
  full_name: string;
};

type TriageMini = {
  id: string;
  resident_id: string;
  triage_status: Database["public"]["Enums"]["family_message_triage_status"];
  matched_keywords: string[];
  updated_at: string;
};

function residentName(r: ResRow): string {
  return `${r.first_name?.trim() ?? ""} ${r.last_name?.trim() ?? ""}`.trim() || "Resident";
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export async function fetchStaffMessageThreads(
  supabase: SupabaseClient<Database>,
): Promise<{ ok: true; threads: StaffMessageThread[] } | { ok: false; error: string }> {
  const { data: msgs, error: msgErr } = await supabase
    .from("family_portal_messages")
    .select("id, resident_id, author_user_id, author_kind, body, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(500);

  if (msgErr) return { ok: false, error: msgErr.message };
  const rows = (msgs ?? []) as unknown as MsgRow[];
  if (rows.length === 0) return { ok: true, threads: [] };

  const residentIds = [...new Set(rows.map((m) => m.resident_id))];

  const { data: residents } = await supabase
    .from("residents")
    .select("id, first_name, last_name, bed_id")
    .in("id", residentIds)
    .is("deleted_at", null);
  const resMap = new Map((((residents ?? []) as unknown as ResRow[]).map((r) => [r.id, r])));

  const bedIds = [...new Set(
    (residents as unknown as ResRow[] ?? [])
      .map((r) => r.bed_id)
      .filter(Boolean),
  )] as string[];

  const roomByResident = new Map<string, string>();
  if (bedIds.length > 0) {
    const { data: beds } = await supabase
      .from("beds")
      .select("id, room_id")
      .in("id", bedIds);
    const roomIds = [...new Set(
      ((beds ?? []) as unknown as { id: string; room_id: string | null }[])
        .map((b) => b.room_id)
        .filter(Boolean),
    )] as string[];
    if (roomIds.length > 0) {
      const { data: rooms } = await supabase
        .from("rooms")
        .select("id, room_number")
        .in("id", roomIds);
      const roomMap = new Map(
        ((rooms ?? []) as unknown as { id: string; room_number: string }[]).map((r) => [r.id, r.room_number]),
      );
      const bedToRoom = new Map(
        ((beds ?? []) as unknown as { id: string; room_id: string | null }[]).map((b) => [b.id, b.room_id]),
      );
      for (const res of (residents ?? []) as unknown as ResRow[]) {
        if (!res.bed_id) continue;
        const roomId = bedToRoom.get(res.bed_id);
        if (roomId) {
          const num = roomMap.get(roomId);
          if (num) roomByResident.set(res.id, `Room ${num}`);
        }
      }
    }
  }

  const grouped = new Map<string, MsgRow[]>();
  for (const m of rows) {
    const arr = grouped.get(m.resident_id) ?? [];
    arr.push(m);
    grouped.set(m.resident_id, arr);
  }

  const { data: triageRows } = residentIds.length > 0
    ? await supabase
        .from("family_message_triage_items")
        .select("id, resident_id, triage_status, matched_keywords, updated_at")
        .in("resident_id", residentIds)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
    : { data: [] };
  const triageByResident = new Map<string, TriageMini>();
  for (const row of ((triageRows ?? []) as unknown as TriageMini[])) {
    if (!triageByResident.has(row.resident_id)) {
      triageByResident.set(row.resident_id, row);
    }
  }

  const threads: StaffMessageThread[] = [];
  for (const [resId, msgs] of grouped) {
    const latest = msgs[0];
    const res = resMap.get(resId);
    const triage = triageByResident.get(resId);
    threads.push({
      residentId: resId,
      residentName: res ? residentName(res) : "Unknown Resident",
      roomLabel: roomByResident.get(resId) ?? "—",
      facilityName: "Oakridge ALF",
      lastMessageBody: latest.body.length > 120 ? latest.body.slice(0, 120) + "…" : latest.body,
      lastMessageAt: timeAgo(latest.created_at),
      lastMessageAtIso: latest.created_at,
      lastAuthorKind: latest.author_kind,
      unreadHint: latest.author_kind === "family",
      messageCount: msgs.length,
      triageItemId: triage?.id ?? null,
      triageStatus: triage?.triage_status ?? null,
      triageKeywords: triage?.matched_keywords ?? [],
    });
  }

  const triagePriority: Record<string, number> = {
    pending_review: 0,
    in_review: 1,
    resolved: 2,
    false_positive: 3,
  };
  threads.sort((a, b) => {
    const aTriage = a.triageStatus ? (triagePriority[a.triageStatus] ?? 9) : 9;
    const bTriage = b.triageStatus ? (triagePriority[b.triageStatus] ?? 9) : 9;
    if (aTriage !== bTriage) return aTriage - bTriage;
    if (a.unreadHint !== b.unreadHint) return a.unreadHint ? -1 : 1;
    return new Date(b.lastMessageAtIso).getTime() - new Date(a.lastMessageAtIso).getTime();
  });

  return { ok: true, threads };
}

export async function fetchStaffMessagesForResident(
  supabase: SupabaseClient<Database>,
  residentId: string,
): Promise<{ ok: true; messages: StaffMessageRow[]; residentName: string } | { ok: false; error: string }> {
  const [resQ, msgQ] = await Promise.all([
    supabase
      .from("residents")
      .select("first_name, last_name")
      .eq("id", residentId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("family_portal_messages")
      .select("id, author_user_id, author_kind, body, created_at")
      .eq("resident_id", residentId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(200),
  ]);

  const { data: res, error: resErr } = resQ;
  if (resErr) return { ok: false, error: resErr.message };
  const rn = res
    ? `${(res as unknown as { first_name: string | null; last_name: string | null }).first_name?.trim() ?? ""} ${(res as unknown as { first_name: string | null; last_name: string | null }).last_name?.trim() ?? ""}`.trim() || "Resident"
    : "Resident";

  const { data: msgs, error: msgErr } = msgQ;
  if (msgErr) return { ok: false, error: msgErr.message };
  const rows = (msgs ?? []) as unknown as MsgRow[];

  const userIds = [...new Set(rows.map((m) => m.author_user_id))];
  const { data: profiles } = await supabase
    .from("user_profiles")
    .select("id, full_name")
    .in("id", userIds);
  const nameMap = new Map(
    ((profiles ?? []) as unknown as ProfileRow[]).map((p) => [p.id, p.full_name]),
  );

  const messages: StaffMessageRow[] = rows.map((m) => ({
    id: m.id,
    authorName: nameMap.get(m.author_user_id) ?? "Unknown",
    authorKind: m.author_kind,
    body: m.body,
    createdAt: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(m.created_at)),
  }));

  return { ok: true, messages, residentName: rn };
}

export async function postStaffMessage(
  supabase: SupabaseClient<Database>,
  residentId: string,
  body: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: "Message cannot be empty." };
  if (trimmed.length > 8000) return { ok: false, error: "Message is too long (max 8000 characters)." };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  const { data: res, error: resErr } = await supabase
    .from("residents")
    .select("facility_id, organization_id")
    .eq("id", residentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (resErr) return { ok: false, error: resErr.message };
  if (!res) return { ok: false, error: "Resident not found." };
  const r = res as unknown as { facility_id: string; organization_id: string };

  const { error: insErr } = await supabase.from("family_portal_messages").insert({
    organization_id: r.organization_id,
    facility_id: r.facility_id,
    resident_id: residentId,
    author_user_id: user.id,
    author_kind: "staff" as const,
    body: trimmed,
  });

  if (insErr) return { ok: false, error: insErr.message };
  return { ok: true };
}
