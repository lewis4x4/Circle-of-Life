import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type FamilyLinkedResidentOption = {
  id: string;
  displayName: string;
};

export type FamilyMessageRow = {
  id: string;
  authorUserId: string;
  authorKind: Database["public"]["Enums"]["family_message_author"];
  body: string;
  createdAt: string;
  timeLabel: string;
};

function residentDisplayName(row: {
  preferred_name: string | null;
  first_name: string | null;
  last_name: string | null;
}): string {
  return (
    row.preferred_name?.trim() ||
    [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
    "Your loved one"
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(d);
}

export async function fetchFamilyMessageResidents(
  supabase: SupabaseClient<Database>,
): Promise<{ ok: true; residents: FamilyLinkedResidentOption[] } | { ok: false; error: string }> {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr) return { ok: false, error: userErr.message };
  if (!user) return { ok: false, error: "Sign in to view messages." };

  const q = await supabase
    .from("family_resident_links")
    .select("resident_id, residents!fk_frl_resident ( id, first_name, last_name, preferred_name )")
    .eq("user_id", user.id)
    .is("revoked_at", null);

  if (q.error) return { ok: false, error: q.error.message };

  const residents: FamilyLinkedResidentOption[] = [];
  const seen = new Set<string>();
  for (const row of q.data ?? []) {
    const r = row as {
      resident_id: string;
      residents: {
        id: string;
        first_name: string | null;
        last_name: string | null;
        preferred_name: string | null;
      } | null;
    };
    if (seen.has(r.resident_id)) continue;
    seen.add(r.resident_id);
    residents.push({
      id: r.resident_id,
      displayName: r.residents ? residentDisplayName(r.residents) : "Your loved one",
    });
  }
  residents.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { ok: true, residents };
}

export async function fetchFamilyMessagesForResident(
  supabase: SupabaseClient<Database>,
  residentId: string,
  cursor?: { createdAt: string; id: string },
): Promise<{ ok: true; messages: FamilyMessageRow[] } | { ok: false; error: string }> {
  if (cursor && (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(cursor.id)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.createdAt)
    || Number.isNaN(new Date(cursor.createdAt).getTime()))) return { ok: false, error: "Invalid updates cursor" };
  let query = supabase
    .from("family_portal_messages")
    .select("id, author_user_id, author_kind, body, created_at")
    .eq("resident_id", residentId)
    .eq("author_kind", "staff")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(200);
  if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  const q = await query;

  if (q.error) return { ok: false, error: q.error.message };

  const raw = (q.data ?? []) as Array<{
    id: string;
    author_user_id: string;
    author_kind: Database["public"]["Enums"]["family_message_author"];
    body: string;
    created_at: string;
  }>;

  const messages: FamilyMessageRow[] = raw.map((m) => ({
    id: m.id,
    authorUserId: m.author_user_id,
    authorKind: m.author_kind,
    body: m.body,
    createdAt: m.created_at,
    timeLabel: formatTime(m.created_at),
  }));

  return { ok: true, messages };
}
