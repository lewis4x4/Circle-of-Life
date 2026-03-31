import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type FamilyCalendarEventRow = {
  id: string;
  title: string;
  dayLabel: string;
  timeLabel: string;
  locationLine: string;
  tag: string;
  cancelled: boolean;
};

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayUtcYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDayLabel(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function formatTimeRange(start: string | null, end: string | null): string {
  if (!start && !end) return "Time TBD";
  const fmt = (iso: string) => {
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return null;
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(t);
  };
  const a = start ? fmt(start) : null;
  const b = end ? fmt(end) : null;
  if (a && b) return `${a} – ${b}`;
  if (a) return a;
  if (b) return b;
  return "Time TBD";
}

type SessionRow = {
  id: string;
  session_date: string;
  start_time: string | null;
  end_time: string | null;
  facilitator_name: string | null;
  notes: string | null;
  cancelled: boolean;
  cancel_reason: string | null;
  activities: { name: string; facilitator: string | null } | null;
  facilities: { name: string } | null;
};

/**
 * Upcoming (and recent) activity sessions visible to the signed-in family user (RLS).
 */
export async function fetchFamilyCalendarEvents(
  supabase: SupabaseClient<Database>,
): Promise<{ ok: true; rows: FamilyCalendarEventRow[] } | { ok: false; error: string }> {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr) return { ok: false, error: userErr.message };
  if (!user) return { ok: false, error: "Sign in to view the calendar." };

  const from = addDaysYmd(todayUtcYmd(), -7);
  const to = addDaysYmd(todayUtcYmd(), 120);

  const q = await supabase
    .from("activity_sessions")
    .select(
      `
      id,
      session_date,
      start_time,
      end_time,
      facilitator_name,
      notes,
      cancelled,
      cancel_reason,
      activities ( name, facilitator ),
      facilities ( name )
    `,
    )
    .gte("session_date", from)
    .lte("session_date", to)
    .is("deleted_at", null)
    .order("session_date", { ascending: true })
    .order("start_time", { ascending: true, nullsFirst: false })
    .limit(80);

  if (q.error) return { ok: false, error: q.error.message };

  const raw = (q.data ?? []) as unknown as SessionRow[];

  const rows: FamilyCalendarEventRow[] = raw.map((s) => {
    const title = s.activities?.name?.trim() || "Community activity";
    const facilityName = s.facilities?.name?.trim();
    const who = s.facilitator_name?.trim() || s.activities?.facilitator?.trim();
    const parts: string[] = [];
    if (facilityName) parts.push(facilityName);
    if (who) parts.push(`Facilitator: ${who}`);
    if (s.notes?.trim()) parts.push(s.notes.trim());
    const locationLine = parts.length > 0 ? parts.join(" · ") : "Community program";

    return {
      id: s.id,
      title,
      dayLabel: formatDayLabel(s.session_date),
      timeLabel: formatTimeRange(s.start_time, s.end_time),
      locationLine,
      tag: s.cancelled ? "Cancelled" : "Community",
      cancelled: s.cancelled,
    };
  });

  return { ok: true, rows };
}
