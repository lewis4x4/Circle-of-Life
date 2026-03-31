import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

type QueryError = { message: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };

export type DashboardCensusRow = {
  id: string;
  name: string;
  initials: string;
  dobDisplay: string;
  room: string;
  acuity: 1 | 2 | 3;
  statusLabel: string;
  statusTone: "active" | "away";
  updatedRelative: string;
};

export type DashboardActivityItem = {
  id: string;
  timeLabel: string;
  actor: string;
  message: string;
  tone: "critical" | "warning" | "normal";
};

export type AdminDashboardSnapshot = {
  headlineName: string;
  timezoneLabel: string;
  shiftSummary: string;
  residentCount: number;
  licensedBeds: number | null;
  activeStaffCount: number;
  openIncidentAlerts: number;
  censusPreview: DashboardCensusRow[];
  activity: DashboardActivityItem[];
};

type SupabaseResidentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  facility_id: string;
  status: string | null;
  acuity_level: string | null;
  updated_at: string | null;
  date_of_birth: string;
  deleted_at: string | null;
};

type SupabaseBedRow = {
  id: string;
  room_id: string | null;
  bed_label: string;
  current_resident_id: string | null;
};

type SupabaseRoomRow = { id: string; room_number: string; unit_id: string | null };

type SupabaseFacilityRow = {
  id: string;
  name: string;
  total_licensed_beds: number;
  timezone: string;
  deleted_at: string | null;
};

type SupabaseIncidentFeedRow = {
  id: string;
  occurred_at: string;
  category: string;
  severity: string;
  status: string;
  resident_id: string | null;
};

type SupabaseResidentMini = { id: string; first_name: string | null; last_name: string | null };

function mapAcuity(value: string | null): 1 | 2 | 3 {
  if (value === "level_3") return 3;
  if (value === "level_2") return 2;
  return 1;
}

function residencyUiLabel(status: string | null): { label: string; tone: "active" | "away" } {
  if (status === "hospital_hold") return { label: "Hospital", tone: "away" };
  if (status === "loa") return { label: "LOA", tone: "away" };
  return { label: "In facility", tone: "active" };
}

function formatDob(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return "—";
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "2-digit", day: "2-digit", year: "numeric" }).format(dt);
}

function formatRelativeShort(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diffMin = Math.round((Date.now() - t) / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 48) return `${diffHr} hr ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));
}

function shiftSummaryForTimezone(timeZone: string): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = Number.parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const safeHour = Number.isNaN(hour) ? 12 : hour;
  if (safeHour >= 7 && safeHour < 15) return `Day shift · local (${timeZone})`;
  if (safeHour >= 15 && safeHour < 23) return `Evening shift · local (${timeZone})`;
  return `Night shift · local (${timeZone})`;
}

function formatIncidentCategory(raw: string): string {
  return raw.replace(/_/g, " ");
}

export async function fetchAdminDashboardSnapshot(
  selectedFacilityId: string | null,
): Promise<AdminDashboardSnapshot> {
  const supabase = createClient();

  let facilitiesQuery = supabase
    .from("facilities" as never)
    .select("id, name, total_licensed_beds, timezone, deleted_at")
    .is("deleted_at", null);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    facilitiesQuery = facilitiesQuery.eq("id", selectedFacilityId);
  }

  let residentsCountQuery = supabase
    .from("residents" as never)
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .in("status", ["active", "hospital_hold", "loa"]);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    residentsCountQuery = residentsCountQuery.eq("facility_id", selectedFacilityId);
  }

  let staffCountQuery = supabase
    .from("staff" as never)
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("employment_status", "active");

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    staffCountQuery = staffCountQuery.eq("facility_id", selectedFacilityId);
  }

  let incidentsCountQuery = supabase
    .from("incidents" as never)
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .in("status", ["open", "investigating"]);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    incidentsCountQuery = incidentsCountQuery.eq("facility_id", selectedFacilityId);
  }

  let residentsPreviewQuery = supabase
    .from("residents" as never)
    .select(
      "id, first_name, last_name, facility_id, status, acuity_level, updated_at, date_of_birth, deleted_at",
    )
    .is("deleted_at", null)
    .in("status", ["active", "hospital_hold", "loa"])
    .order("updated_at", { ascending: false })
    .limit(8);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    residentsPreviewQuery = residentsPreviewQuery.eq("facility_id", selectedFacilityId);
  }

  let incidentsFeedQuery = supabase
    .from("incidents" as never)
    .select("id, occurred_at, category, severity, status, resident_id, deleted_at")
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false })
    .limit(6);

  if (isValidFacilityIdForQuery(selectedFacilityId)) {
    incidentsFeedQuery = incidentsFeedQuery.eq("facility_id", selectedFacilityId);
  }

  const [
    facilitiesResult,
    residentsCountRes,
    staffCountRes,
    incidentsCountRes,
    residentsPreviewResult,
    incidentsFeedResult,
  ] = await Promise.all([
    facilitiesQuery as unknown as Promise<QueryResult<SupabaseFacilityRow[]>>,
    residentsCountQuery as unknown as Promise<{ count: number | null; error: QueryError | null }>,
    staffCountQuery as unknown as Promise<{ count: number | null; error: QueryError | null }>,
    incidentsCountQuery as unknown as Promise<{ count: number | null; error: QueryError | null }>,
    residentsPreviewQuery as unknown as Promise<QueryResult<SupabaseResidentRow[]>>,
    incidentsFeedQuery as unknown as Promise<QueryResult<SupabaseIncidentFeedRow[]>>,
  ]);

  if (facilitiesResult.error) throw facilitiesResult.error;
  if (residentsCountRes.error) throw residentsCountRes.error;
  if (staffCountRes.error) throw staffCountRes.error;
  if (incidentsCountRes.error) throw incidentsCountRes.error;
  if (residentsPreviewResult.error) throw residentsPreviewResult.error;
  if (incidentsFeedResult.error) throw incidentsFeedResult.error;

  const facilityRows = facilitiesResult.data ?? [];
  const licensedBedsSum = facilityRows.reduce((acc, f) => acc + (f.total_licensed_beds ?? 0), 0);
  const primaryTz = facilityRows[0]?.timezone?.trim() || "America/New_York";
  const headlineName =
    isValidFacilityIdForQuery(selectedFacilityId) && facilityRows.length === 1
      ? facilityRows[0].name
      : "All facilities";

  const previewResidents = residentsPreviewResult.data ?? [];
  const incidentRows = incidentsFeedResult.data ?? [];

  const [censusPreview, activity] = await Promise.all([
    mapResidentsToCensusRows(supabase, previewResidents),
    mapIncidentsToActivity(supabase, incidentRows),
  ]);

  const residentCount = residentsCountRes.count ?? 0;
  const activeStaffCount = staffCountRes.count ?? 0;
  const openIncidentAlerts = incidentsCountRes.count ?? 0;

  return {
    headlineName,
    timezoneLabel: primaryTz,
    shiftSummary: shiftSummaryForTimezone(primaryTz),
    residentCount,
    licensedBeds: licensedBedsSum > 0 ? licensedBedsSum : null,
    activeStaffCount,
    openIncidentAlerts,
    censusPreview,
    activity,
  };
}

async function mapResidentsToCensusRows(
  supabase: ReturnType<typeof createClient>,
  residents: SupabaseResidentRow[],
): Promise<DashboardCensusRow[]> {
  if (residents.length === 0) {
    return [];
  }

  const residentIds = residents.map((r) => r.id);
  const bedsResult = (await supabase
    .from("beds" as never)
    .select("id, room_id, bed_label, current_resident_id")
    .in("current_resident_id", residentIds)) as unknown as QueryResult<SupabaseBedRow>;
  if (bedsResult.error) {
    throw bedsResult.error;
  }
  const beds: SupabaseBedRow[] = Array.isArray(bedsResult.data) ? bedsResult.data : [];

  const roomIds = Array.from(
    new Set(
      beds.map((b) => b.room_id).filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  const roomsResult = roomIds.length
    ? ((await supabase.from("rooms" as never).select("id, room_number, unit_id").in("id", roomIds)) as unknown as QueryResult<
        SupabaseRoomRow[]
      >)
    : ({ data: [], error: null } as QueryResult<SupabaseRoomRow[]>);
  if (roomsResult.error) {
    throw roomsResult.error;
  }
  const rooms = roomsResult.data ?? [];

  const bedByResident = new Map(
    beds.filter((b) => b.current_resident_id).map((b) => [b.current_resident_id as string, b] as const),
  );
  const roomById = new Map(rooms.map((r) => [r.id, r] as const));

  return residents.map((resident) => {
    const firstName = resident.first_name ?? "";
    const lastName = resident.last_name ?? "";
    const fullName = `${firstName} ${lastName}`.trim() || "Unknown resident";
    const initials = `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase() || "NA";
    const bed = bedByResident.get(resident.id);
    const room = bed?.room_id ? roomById.get(bed.room_id) : null;
    const roomLabel = room?.room_number
      ? `${room.room_number}${bed?.bed_label ? `-${bed.bed_label}` : ""}`
      : "Unassigned";
    const acuity = mapAcuity(resident.acuity_level);
    const { label, tone } = residencyUiLabel(resident.status);

    return {
      id: resident.id,
      name: fullName,
      initials,
      dobDisplay: formatDob(resident.date_of_birth),
      room: roomLabel,
      acuity,
      statusLabel: label,
      statusTone: tone,
      updatedRelative: formatRelativeShort(resident.updated_at),
    };
  });
}

async function mapIncidentsToActivity(
  supabase: ReturnType<typeof createClient>,
  incidents: SupabaseIncidentFeedRow[],
): Promise<DashboardActivityItem[]> {
  if (incidents.length === 0) {
    return [];
  }

  const residentIds = Array.from(
    new Set(
      incidents.map((i) => i.resident_id).filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );

  const residentsResult = residentIds.length
    ? ((await supabase
        .from("residents" as never)
        .select("id, first_name, last_name")
        .in("id", residentIds)) as unknown as QueryResult<SupabaseResidentMini[]>)
    : ({ data: [], error: null } as QueryResult<SupabaseResidentMini[]>);
  if (residentsResult.error) {
    throw residentsResult.error;
  }
  const resById = new Map((residentsResult.data ?? []).map((r) => [r.id, r] as const));

  return incidents.map((row) => {
    const res = row.resident_id ? resById.get(row.resident_id) : null;
    const resName = res
      ? `${res.first_name ?? ""} ${res.last_name ?? ""}`.trim() || "Resident"
      : "Resident";
    const sev = row.severity ?? "";
    const tone: DashboardActivityItem["tone"] =
      sev === "level_4" || sev === "level_3" ? "critical" : sev === "level_2" ? "warning" : "normal";
    const message = `${resName} · ${formatIncidentCategory(row.category)} (${row.status})`;

    return {
      id: row.id,
      timeLabel: formatRelativeShort(row.occurred_at),
      actor: "Incident",
      message,
      tone,
    };
  });
}
