import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type CaregiverResidentProfile = {
  id: string;
  displayName: string;
  roomLabel: string;
  acuityLevel: string | null;
  status: string;
  fallRiskLevel: string;
  elopementRisk: boolean;
  wanderingRisk: boolean;
  primaryDiagnosis: string | null;
  diagnosisList: string[];
  allergyList: string[];
  dietOrder: string | null;
  codeStatus: string;
  ambulatory: boolean;
  assistiveDevice: string | null;
  specialInstructions: string | null;
  carePlanNotes: string | null;
  carePlanStatus: string | null;
  activeMedCount: number;
  scheduledMedsDueNow: number;
  recentDailyLogMood: string | null;
  riskBanners: RiskBanner[];
};

export type RiskBanner = {
  title: string;
  detail: string;
  tone: "warning" | "danger" | "ok";
};

function acuityDisplay(level: string | null): string {
  if (!level) return "—";
  return level.replace("level_", "Level ");
}

function buildRiskBanners(r: {
  fall_risk_level: string | null;
  elopement_risk: boolean;
  wandering_risk: boolean;
  ambulatory: boolean;
  assistive_device: string | null;
  code_status: string;
  allergy_list: string[] | null;
  diet_order: string | null;
}): RiskBanner[] {
  const banners: RiskBanner[] = [];

  if (r.fall_risk_level === "high") {
    const details: string[] = [];
    if (r.assistive_device) details.push(`Use ${r.assistive_device}`);
    details.push("2-hour rounding");
    details.push("Bed alarm active");
    banners.push({
      title: "High Fall Risk",
      detail: details.join(" · "),
      tone: "danger",
    });
  } else if (r.fall_risk_level === "moderate") {
    banners.push({
      title: "Moderate Fall Risk",
      detail: r.assistive_device
        ? `Ensure ${r.assistive_device} within reach. Assist with transfers.`
        : "Assist with transfers. Non-skid footwear required.",
      tone: "warning",
    });
  }

  if (r.elopement_risk) {
    banners.push({
      title: "Elopement Risk",
      detail: "WanderGuard active. Verify door alarms each shift. Do not leave unattended near exits.",
      tone: "danger",
    });
  }

  if (r.wandering_risk) {
    banners.push({
      title: "Wandering Risk",
      detail: "Monitor during sundowning hours. Redirect to safe areas. Door alarms active.",
      tone: "warning",
    });
  }

  if (r.code_status !== "full_code") {
    banners.push({
      title: `Code Status: ${r.code_status.toUpperCase().replace(/_/g, "/")}`,
      detail: "Advance directive on file. Follow documented wishes.",
      tone: "warning",
    });
  }

  if (r.allergy_list && r.allergy_list.length > 0) {
    banners.push({
      title: `Allergies: ${r.allergy_list.join(", ")}`,
      detail: "Verify all medications and meals against allergy list.",
      tone: "danger",
    });
  }

  if (r.diet_order && r.diet_order.toLowerCase() !== "regular") {
    banners.push({
      title: `Diet: ${r.diet_order}`,
      detail: "Verify meal tray matches diet order before serving.",
      tone: "ok",
    });
  }

  return banners;
}

type ResidentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  bed_id: string | null;
  acuity_level: string | null;
  status: string;
  fall_risk_level: string | null;
  elopement_risk: boolean;
  wandering_risk: boolean;
  primary_diagnosis: string | null;
  diagnosis_list: string[] | null;
  allergy_list: string[] | null;
  diet_order: string | null;
  code_status: string;
  ambulatory: boolean;
  assistive_device: string | null;
  special_instructions: string | null;
};

type BedRow = { bed_label: string; room_id: string | null };
type RoomRow = { room_number: string };
type CarePlanRow = { status: string; notes: string | null };
type LogRow = { mood: string | null };

export async function fetchCaregiverResidentProfile(
  supabase: SupabaseClient<Database>,
  residentId: string,
): Promise<{ ok: true; profile: CaregiverResidentProfile } | { ok: false; error: string }> {
  const { data: raw, error: rErr } = await supabase
    .from("residents")
    .select(
      "id, first_name, last_name, preferred_name, bed_id, acuity_level, status, " +
        "fall_risk_level, elopement_risk, wandering_risk, primary_diagnosis, " +
        "diagnosis_list, allergy_list, diet_order, code_status, ambulatory, " +
        "assistive_device, special_instructions",
    )
    .eq("id", residentId)
    .is("deleted_at", null)
    .single();

  if (rErr || !raw) return { ok: false, error: rErr?.message ?? "Resident not found" };
  const r = raw as unknown as ResidentRow;

  let roomLabel = "—";
  if (r.bed_id) {
    const { data: bedRaw } = await supabase
      .from("beds")
      .select("bed_label, room_id")
      .eq("id", r.bed_id)
      .single();
    const bed = bedRaw as unknown as BedRow | null;
    if (bed?.room_id) {
      const { data: roomRaw } = await supabase
        .from("rooms")
        .select("room_number")
        .eq("id", bed.room_id)
        .single();
      const room = roomRaw as unknown as RoomRow | null;
      if (room) roomLabel = `Room ${room.room_number}`;
    }
  }

  const { count: medCount } = await supabase
    .from("resident_medications")
    .select("id", { count: "exact", head: true })
    .eq("resident_id", residentId)
    .eq("status", "active")
    .is("deleted_at", null);

  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const oneHourAhead = new Date(now.getTime() + 60 * 60 * 1000);
  const { count: dueMedCount } = await supabase
    .from("emar_records")
    .select("id", { count: "exact", head: true })
    .eq("resident_id", residentId)
    .eq("status", "scheduled")
    .is("deleted_at", null)
    .gte("scheduled_time", twoHoursAgo.toISOString())
    .lte("scheduled_time", oneHourAhead.toISOString());

  const { data: cpRaw } = await supabase
    .from("care_plans")
    .select("status, notes")
    .eq("resident_id", residentId)
    .is("deleted_at", null)
    .in("status", ["active", "under_review"])
    .order("effective_date", { ascending: false })
    .limit(1)
    .single();
  const activeCarePlan = cpRaw as unknown as CarePlanRow | null;

  const { data: logRaw } = await supabase
    .from("daily_logs")
    .select("mood")
    .eq("resident_id", residentId)
    .is("deleted_at", null)
    .order("log_date", { ascending: false })
    .limit(1)
    .single();
  const latestLog = logRaw as unknown as LogRow | null;

  const displayName =
    (r.preferred_name?.trim() || r.first_name?.trim() || "") +
    " " +
    (r.last_name?.trim() || "");

  return {
    ok: true,
    profile: {
      id: r.id,
      displayName: displayName.trim() || "Resident",
      roomLabel,
      acuityLevel: acuityDisplay(r.acuity_level),
      status: r.status,
      fallRiskLevel: r.fall_risk_level ?? "standard",
      elopementRisk: r.elopement_risk,
      wanderingRisk: r.wandering_risk,
      primaryDiagnosis: r.primary_diagnosis,
      diagnosisList: (r.diagnosis_list as string[]) ?? [],
      allergyList: (r.allergy_list as string[]) ?? [],
      dietOrder: r.diet_order,
      codeStatus: r.code_status,
      ambulatory: r.ambulatory,
      assistiveDevice: r.assistive_device,
      specialInstructions: r.special_instructions,
      carePlanNotes: activeCarePlan?.notes ?? null,
      carePlanStatus: activeCarePlan?.status ?? null,
      activeMedCount: medCount ?? 0,
      scheduledMedsDueNow: dueMedCount ?? 0,
      recentDailyLogMood: latestLog?.mood ?? null,
      riskBanners: buildRiskBanners(r),
    },
  };
}
