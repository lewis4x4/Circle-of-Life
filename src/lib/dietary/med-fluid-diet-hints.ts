import type { Database } from "@/types/database";

type FluidLevel = Database["public"]["Enums"]["iddsi_fluid_level"];

/** True when IDDSI fluid is something other than thin or not assessed (resident expected on modified/thickened fluids). */
export function isThickenedOrModifiedFluidsDiet(fluid: FluidLevel): boolean {
  return fluid !== "not_assessed" && fluid !== "level_0_thin";
}

const LIQUID_FORM_RE = /\b(liquid|solution|suspension|syrup|elixir|drops)\b/i;

/** Heuristic on free-text `resident_medications.form` — not clinical classification. */
export function medicationFormLooksLiquid(form: string | null | undefined): boolean {
  const t = form?.trim();
  if (!t) return false;
  return LIQUID_FORM_RE.test(t);
}

export type ResidentMedForHint = {
  id: string;
  medication_name: string;
  form: string | null;
  status: Database["public"]["Enums"]["medication_status"];
};

/**
 * Surfaces a **review hint** when diet text implies thickened/modified fluids and an active med
 * has a liquid-like form string. Advisory only — pharmacy / prescriber confirm.
 */
export function liquidFormVsThickenedFluidsHint(
  iddsi_fluid_level: FluidLevel,
  medications: ResidentMedForHint[],
): { show: boolean; matches: { id: string; medication_name: string; form: string | null }[] } {
  if (!isThickenedOrModifiedFluidsDiet(iddsi_fluid_level)) {
    return { show: false, matches: [] };
  }
  const matches = medications
    .filter((m) => m.status === "active" && medicationFormLooksLiquid(m.form))
    .map((m) => ({ id: m.id, medication_name: m.medication_name, form: m.form }));
  return { show: matches.length > 0, matches };
}
