import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type DailyLogRow = Database["public"]["Tables"]["daily_logs"]["Row"];
type ThresholdRow = Database["public"]["Tables"]["vital_sign_alert_thresholds"]["Row"];
type VitalType = Database["public"]["Tables"]["vital_sign_alerts"]["Row"]["vital_type"];

export type VitalEvaluationResult = {
  alertsCreated: number;
  skippedReason?: string;
};

function hasVitalData(log: Pick<
  DailyLogRow,
  | "temperature"
  | "blood_pressure_systolic"
  | "blood_pressure_diastolic"
  | "pulse"
  | "respiration"
  | "oxygen_saturation"
  | "weight_lbs"
>): boolean {
  return (
    log.temperature != null ||
    log.blood_pressure_systolic != null ||
    log.blood_pressure_diastolic != null ||
    log.pulse != null ||
    log.respiration != null ||
    log.oxygen_saturation != null ||
    log.weight_lbs != null
  );
}

/**
 * Inserts vital_sign_alerts via service-role client after auth checks in the caller.
 * Idempotent: unique partial index on (daily_log_id, vital_type) WHERE open.
 */
export async function evaluateVitalSignAlertsForDailyLog(
  admin: SupabaseClient<Database>,
  dailyLog: DailyLogRow,
): Promise<VitalEvaluationResult> {
  if (!hasVitalData(dailyLog)) {
    return { alertsCreated: 0, skippedReason: "no_vitals" };
  }

  const { data: threshold, error: thErr } = await admin
    .from("vital_sign_alert_thresholds")
    .select("*")
    .eq("resident_id", dailyLog.resident_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (thErr) {
    console.error("[evaluateVitals] thresholds", thErr);
    return { alertsCreated: 0, skippedReason: "threshold_query_failed" };
  }

  if (!threshold) {
    return { alertsCreated: 0, skippedReason: "no_threshold_row" };
  }

  const t = threshold as ThresholdRow;
  let created = 0;

  const tryInsert = async (
    vitalType: VitalType,
    recorded: number,
    thresholdVal: number,
    direction: "above" | "below",
  ) => {
    const { data: existing } = await admin
      .from("vital_sign_alerts")
      .select("id")
      .eq("daily_log_id", dailyLog.id)
      .eq("vital_type", vitalType)
      .is("deleted_at", null)
      .in("status", ["open", "acknowledged"])
      .maybeSingle();

    if (existing) return;

    const { error } = await admin.from("vital_sign_alerts").insert({
      resident_id: dailyLog.resident_id,
      facility_id: dailyLog.facility_id,
      organization_id: dailyLog.organization_id,
      daily_log_id: dailyLog.id,
      vital_type: vitalType,
      recorded_value: recorded,
      threshold_value: thresholdVal,
      direction,
      status: "open",
    });

    if (!error) created += 1;
    else console.error("[evaluateVitals] insert alert", vitalType, error);
  };

  if (dailyLog.temperature != null && t.temperature_high != null && dailyLog.temperature > t.temperature_high) {
    await tryInsert("temperature", dailyLog.temperature, t.temperature_high, "above");
  }
  if (dailyLog.temperature != null && t.temperature_low != null && dailyLog.temperature < t.temperature_low) {
    await tryInsert("temperature", dailyLog.temperature, t.temperature_low, "below");
  }

  if (dailyLog.blood_pressure_systolic != null && t.bp_systolic_high != null && dailyLog.blood_pressure_systolic > t.bp_systolic_high) {
    await tryInsert("bp_systolic", dailyLog.blood_pressure_systolic, t.bp_systolic_high, "above");
  }
  if (dailyLog.blood_pressure_systolic != null && t.bp_systolic_low != null && dailyLog.blood_pressure_systolic < t.bp_systolic_low) {
    await tryInsert("bp_systolic", dailyLog.blood_pressure_systolic, t.bp_systolic_low, "below");
  }

  if (dailyLog.blood_pressure_diastolic != null && t.bp_diastolic_high != null && dailyLog.blood_pressure_diastolic > t.bp_diastolic_high) {
    await tryInsert("bp_diastolic", dailyLog.blood_pressure_diastolic, t.bp_diastolic_high, "above");
  }
  if (dailyLog.blood_pressure_diastolic != null && t.bp_diastolic_low != null && dailyLog.blood_pressure_diastolic < t.bp_diastolic_low) {
    await tryInsert("bp_diastolic", dailyLog.blood_pressure_diastolic, t.bp_diastolic_low, "below");
  }

  if (dailyLog.pulse != null && t.pulse_high != null && dailyLog.pulse > t.pulse_high) {
    await tryInsert("pulse", dailyLog.pulse, t.pulse_high, "above");
  }
  if (dailyLog.pulse != null && t.pulse_low != null && dailyLog.pulse < t.pulse_low) {
    await tryInsert("pulse", dailyLog.pulse, t.pulse_low, "below");
  }

  if (dailyLog.respiration != null && t.respiration_high != null && dailyLog.respiration > t.respiration_high) {
    await tryInsert("respiration", dailyLog.respiration, t.respiration_high, "above");
  }
  if (dailyLog.respiration != null && t.respiration_low != null && dailyLog.respiration < t.respiration_low) {
    await tryInsert("respiration", dailyLog.respiration, t.respiration_low, "below");
  }

  if (dailyLog.oxygen_saturation != null && t.oxygen_saturation_low != null && dailyLog.oxygen_saturation < t.oxygen_saturation_low) {
    await tryInsert("oxygen_saturation", dailyLog.oxygen_saturation, t.oxygen_saturation_low, "below");
  }

  if (dailyLog.weight_lbs != null && t.weight_change_lbs != null) {
    const prior = await admin
      .from("daily_logs")
      .select("weight_lbs, log_date")
      .eq("resident_id", dailyLog.resident_id)
      .eq("facility_id", dailyLog.facility_id)
      .neq("id", dailyLog.id)
      .is("deleted_at", null)
      .not("weight_lbs", "is", null)
      .lte("log_date", dailyLog.log_date)
      .gte("log_date", addDaysToDateString(dailyLog.log_date, -7))
      .order("log_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const priorRow = prior.data as { weight_lbs: number | null; log_date: string } | null;
    if (priorRow?.weight_lbs != null) {
      const delta = Math.abs(dailyLog.weight_lbs - priorRow.weight_lbs);
      if (delta > t.weight_change_lbs) {
        await tryInsert("weight_change", delta, t.weight_change_lbs, "above");
      }
    }
  }

  return { alertsCreated: created };
}

function addDaysToDateString(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map((x) => Number.parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
