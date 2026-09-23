/**
 * Quiet Operator copy for resident vitals on `/admin/residents/[id]/vitals`.
 * Empty states name real gaps — never fabricate readings or units.
 */

export const VITALS_NO_SYSTOLIC_COPY = "No systolic posted";
export const VITALS_NO_DIASTOLIC_COPY = "No diastolic posted";
export const VITALS_NO_BLOOD_PRESSURE_COPY = "No blood pressure posted";
export const VITALS_NO_PULSE_COPY = "No pulse posted";
export const VITALS_NO_OXYGEN_COPY = "No oxygen posted";
export const VITALS_NO_RESPIRATION_COPY = "No respiration posted";
export const VITALS_NO_TEMPERATURE_COPY = "No temperature posted";
export const VITALS_NO_WEIGHT_COPY = "No weight posted";

/** True when a numeric vital was posted (null/undefined/NaN are gaps). Real zero counts. */
export function isPostedVitalNumeric(value: number | null | undefined): value is number {
  if (value == null) return false;
  if (typeof value === "number" && Number.isNaN(value)) return false;
  return true;
}

/** Blood pressure line — keeps real zeros; names each missing component. */
export function formatVitalsBloodPressure(
  systolic: number | null | undefined,
  diastolic: number | null | undefined,
): string {
  const hasSystolic = isPostedVitalNumeric(systolic);
  const hasDiastolic = isPostedVitalNumeric(diastolic);

  if (!hasSystolic && !hasDiastolic) return VITALS_NO_BLOOD_PRESSURE_COPY;
  if (!hasSystolic) return `${VITALS_NO_SYSTOLIC_COPY}/${diastolic}`;
  if (!hasDiastolic) return `${systolic}/${VITALS_NO_DIASTOLIC_COPY}`;
  return `${systolic}/${diastolic}`;
}

/** Pulse with bpm suffix when posted. */
export function formatVitalsPulse(pulse: number | null | undefined): string {
  if (!isPostedVitalNumeric(pulse)) return VITALS_NO_PULSE_COPY;
  return `${pulse} bpm`;
}

/** SpO₂ with percent suffix when posted — real zero stays `0%`. */
export function formatVitalsOxygenSaturation(
  oxygenSaturation: number | null | undefined,
): string {
  if (!isPostedVitalNumeric(oxygenSaturation)) return VITALS_NO_OXYGEN_COPY;
  return `${oxygenSaturation}%`;
}

/** Respiration rate with resp suffix when posted. */
export function formatVitalsRespiration(respiration: number | null | undefined): string {
  if (!isPostedVitalNumeric(respiration)) return VITALS_NO_RESPIRATION_COPY;
  return `${respiration} resp`;
}

/** Temperature with degree suffix when posted — real zero stays `0°`. */
export function formatVitalsTemperature(temperature: number | null | undefined): string {
  if (!isPostedVitalNumeric(temperature)) return VITALS_NO_TEMPERATURE_COPY;
  return `${temperature}°`;
}

/** Weight with lbs suffix when posted — real zero stays `0 lbs`. */
export function formatVitalsWeight(weightLbs: number | null | undefined): string {
  if (!isPostedVitalNumeric(weightLbs)) return VITALS_NO_WEIGHT_COPY;
  return `${weightLbs} lbs`;
}

/**
 * The vital alerts panel (COL-649): red chrome only when there are alerts, and
 * "No alerts" only when vitals were actually logged — with nothing logged no
 * alert could fire, so an empty list is not reassurance.
 */
export type VitalAlertsPanel = {
  tone: "alert" | "neutral";
  /** Empty-list line; null when alerts are listed or the read is pending/failed. */
  emptyCopy: string | null;
};

export function describeVitalAlertsPanel(input: {
  loading: boolean;
  alertsError: string | null;
  logsError: string | null;
  alertCount: number;
  logCount: number;
}): VitalAlertsPanel {
  if (input.alertCount > 0) return { tone: "alert", emptyCopy: null };
  if (input.loading || input.alertsError) return { tone: "neutral", emptyCopy: null };
  if (!input.logsError && input.logCount === 0) {
    return { tone: "neutral", emptyCopy: "No vitals logged yet, so no alerts can fire." };
  }
  return { tone: "neutral", emptyCopy: "No alerts." };
}
