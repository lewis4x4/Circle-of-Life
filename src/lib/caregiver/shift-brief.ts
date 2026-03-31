import { toDate } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildEmarQueueSlots,
  documentedSlotKeys,
  zonedYmd,
  type EmarQueueSlot,
} from "@/lib/caregiver/emar-queue";
import { fetchActiveResidentsWithRooms } from "@/lib/caregiver/facility-residents";
import type { CaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import type { Database } from "@/types/database";

type MedRow = Database["public"]["Tables"]["resident_medications"]["Row"] & {
  residents: Pick<Database["public"]["Tables"]["residents"]["Row"], "first_name" | "last_name"> | null;
};

type ResidentMini = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  bed_id: string | null;
};

type BedRow = { id: string; room_id: string | null; bed_label: string | null };
type RoomRow = { id: string; room_number: string | null };

export type CriticalAlertItem = {
  id: string;
  residentId: string;
  title: string;
  detail: string;
  badge: string;
};

export type WatchlistItem = {
  id: string;
  name: string;
  room: string;
  flags: string[];
};

export type CaregiverShiftBrief = {
  census: number;
  highSeverityConditionCount: number;
  openConditionCount: number;
  pendingPrnCount: number;
  emarDueNow: number;
  emarDueSoon: number;
  emarTotal: number;
  criticalAlerts: CriticalAlertItem[];
  watchlist: WatchlistItem[];
};

/**
 * Aggregates live metrics for the caregiver shift dashboard (matches eMAR window logic on `/caregiver/meds`).
 */
export async function fetchCaregiverShiftBrief(
  supabase: SupabaseClient<Database>,
  ctx: CaregiverFacilityContext,
): Promise<CaregiverShiftBrief> {
  const now = new Date();
  const ymd = zonedYmd(now, ctx.timeZone);
  const startUtc = toDate(`${ymd}T00:00:00`, { timeZone: ctx.timeZone }).toISOString();
  const endUtc = toDate(`${ymd}T23:59:59.999`, { timeZone: ctx.timeZone }).toISOString();

  const [
    slots,
    censusRes,
    highSevRes,
    openCondRes,
    prnRes,
    critRes,
    residentsWithRooms,
    riskRows,
  ] = await Promise.all([
    loadTodayEmarSlots(supabase, ctx, now, ymd, startUtc, endUtc),
    supabase
      .from("residents")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", ctx.facilityId)
      .is("deleted_at", null)
      .in("status", ["active", "hospital_hold", "loa"]),
    supabase
      .from("condition_changes")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", ctx.facilityId)
      .is("deleted_at", null)
      .is("resolved_at", null)
      .in("severity", ["critical", "high"]),
    supabase
      .from("condition_changes")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", ctx.facilityId)
      .is("deleted_at", null)
      .is("resolved_at", null),
    supabase
      .from("emar_records")
      .select("id", { count: "exact", head: true })
      .eq("facility_id", ctx.facilityId)
      .eq("is_prn", true)
      .in("status", ["given", "self_administered"])
      .not("actual_time", "is", null)
      .is("deleted_at", null)
      .or("prn_effectiveness_checked.is.null,prn_effectiveness_checked.eq.false"),
    supabase
      .from("condition_changes")
      .select(
        "id, resident_id, description, severity, reported_at, residents!inner ( first_name, last_name, preferred_name )",
      )
      .eq("facility_id", ctx.facilityId)
      .is("deleted_at", null)
      .is("resolved_at", null)
      .in("severity", ["critical", "high"])
      .order("reported_at", { ascending: false })
      .limit(2),
    fetchActiveResidentsWithRooms(supabase, ctx.facilityId),
    supabase
      .from("residents")
      .select("id, acuity_level, fall_risk_level, wandering_risk, elopement_risk")
      .eq("facility_id", ctx.facilityId)
      .is("deleted_at", null)
      .in("status", ["active", "hospital_hold", "loa"]),
  ]);

  if (censusRes.error) throw censusRes.error;
  if (highSevRes.error) throw highSevRes.error;
  if (openCondRes.error) throw openCondRes.error;
  if (prnRes.error) throw prnRes.error;
  if (critRes.error) throw critRes.error;
  if (riskRows.error) throw riskRows.error;

  const dueNow = slots.filter((s) => s.urgency === "due-now").length;
  const dueSoon = slots.filter((s) => s.urgency === "due-soon").length;

  const criticalAlerts: CriticalAlertItem[] = (critRes.data ?? []).map((raw) => {
    const row = raw as {
      id: string;
      resident_id: string;
      description: string;
      severity: string;
      reported_at: string;
      residents: { first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
    };
    const res = row.residents;
    const name =
      res?.preferred_name?.trim() ||
      [res?.first_name, res?.last_name].filter(Boolean).join(" ").trim() ||
      "Resident";
    const sev = (row.severity ?? "high").toLowerCase();
    return {
      id: row.id,
      residentId: row.resident_id,
      title: `${sev === "critical" ? "Critical" : "High priority"}: ${name}`,
      detail: truncate(row.description, 160),
      badge: sev === "critical" ? "Critical" : "High priority",
    };
  });

  const riskById = new Map((riskRows.data ?? []).map((r) => [r.id, r] as const));
  const watchlist: WatchlistItem[] = [];
  for (const r of residentsWithRooms) {
    const risk = riskById.get(r.id);
    if (!risk) continue;
    const flags: string[] = [];
    if (risk.acuity_level === "level_3") flags.push("Acuity 3");
    if (risk.wandering_risk) flags.push("Wandering");
    if (risk.elopement_risk) flags.push("Elopement risk");
    if (risk.fall_risk_level?.trim()) {
      const fr = risk.fall_risk_level.trim();
      if (/high|severe|max/i.test(fr)) flags.push(`Fall risk: ${fr}`);
    }
    if (flags.length === 0) continue;
    watchlist.push({
      id: r.id,
      name: r.displayName,
      room: r.roomLabel,
      flags: flags.slice(0, 4),
    });
    if (watchlist.length >= 5) break;
  }

  return {
    census: censusRes.count ?? 0,
    highSeverityConditionCount: highSevRes.count ?? 0,
    openConditionCount: openCondRes.count ?? 0,
    pendingPrnCount: prnRes.count ?? 0,
    emarDueNow: dueNow,
    emarDueSoon: dueSoon,
    emarTotal: slots.length,
    criticalAlerts,
    watchlist,
  };
}

async function loadTodayEmarSlots(
  supabase: SupabaseClient<Database>,
  ctx: CaregiverFacilityContext,
  now: Date,
  ymd: string,
  startUtc: string,
  endUtc: string,
): Promise<EmarQueueSlot[]> {
  const medRes = await supabase
    .from("resident_medications")
    .select(
      `
      id,
      resident_id,
      facility_id,
      organization_id,
      medication_name,
      strength,
      route,
      frequency,
      scheduled_times,
      instructions,
      status,
      residents!inner ( first_name, last_name )
    `,
    )
    .eq("facility_id", ctx.facilityId)
    .eq("status", "active")
    .is("deleted_at", null);

  if (medRes.error) throw medRes.error;
  const raw = (medRes.data ?? []) as unknown as MedRow[];
  const medsFiltered = raw.filter((m) => m.residents != null);

  const resIds = [...new Set(medsFiltered.map((m) => m.resident_id))];
  const resById = new Map<string, ResidentMini>();
  if (resIds.length > 0) {
    const resQ = await supabase
      .from("residents")
      .select("id, first_name, last_name, bed_id")
      .in("id", resIds)
      .is("deleted_at", null);
    if (resQ.error) throw resQ.error;
    for (const r of resQ.data ?? []) {
      resById.set(r.id, r as ResidentMini);
    }
  }

  const bedIds = [...new Set([...resById.values()].map((r) => r.bed_id).filter(Boolean))] as string[];
  const roomByResident = new Map<string, string>();
  if (bedIds.length > 0) {
    const bedsQ = await supabase
      .from("beds")
      .select("id, room_id, bed_label")
      .in("id", bedIds)
      .is("deleted_at", null);
    if (bedsQ.error) throw bedsQ.error;
    const beds = (bedsQ.data ?? []) as BedRow[];
    const roomIds = [...new Set(beds.map((b) => b.room_id).filter(Boolean))] as string[];
    let roomById = new Map<string, RoomRow>();
    if (roomIds.length > 0) {
      const roomsQ = await supabase.from("rooms").select("id, room_number").in("id", roomIds).is("deleted_at", null);
      if (roomsQ.error) throw roomsQ.error;
      roomById = new Map((roomsQ.data ?? []).map((r) => [r.id, r as RoomRow]));
    }
    const bedById = new Map(beds.map((b) => [b.id, b]));
    for (const [rid, res] of resById) {
      if (!res.bed_id) {
        roomByResident.set(rid, "—");
        continue;
      }
      const bed = bedById.get(res.bed_id);
      const room = bed?.room_id ? roomById.get(bed.room_id) : null;
      const label = room?.room_number
        ? `${room.room_number}${bed?.bed_label ? `-${bed.bed_label}` : ""}`
        : "—";
      roomByResident.set(rid, label);
    }
  }

  const emarQ = await supabase
    .from("emar_records")
    .select("resident_medication_id, scheduled_time, is_prn, status")
    .eq("facility_id", ctx.facilityId)
    .gte("scheduled_time", startUtc)
    .lte("scheduled_time", endUtc)
    .is("deleted_at", null);

  if (emarQ.error) throw emarQ.error;
  const docKeys = documentedSlotKeys(
    (emarQ.data ?? []) as {
      resident_medication_id: string;
      scheduled_time: string;
      is_prn: boolean;
      status: string;
    }[],
    ctx.timeZone,
    ymd,
  );

  const medInputs = medsFiltered.map((m) => {
    const res = resById.get(m.resident_id);
    const r = m.residents!;
    return {
      id: m.id,
      resident_id: m.resident_id,
      medication_name: m.medication_name,
      strength: m.strength,
      route: m.route,
      frequency: m.frequency,
      scheduled_times: (m.scheduled_times ?? []) as string[],
      instructions: m.instructions,
      resident: { first_name: res?.first_name ?? r.first_name, last_name: res?.last_name ?? r.last_name },
      roomLabel: roomByResident.get(m.resident_id) ?? "—",
    };
  });

  return buildEmarQueueSlots(medInputs, ctx.timeZone, now, docKeys);
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}
