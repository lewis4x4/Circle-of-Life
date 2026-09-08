import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { SavedControlledCount } from "./controlled-count-batch";

export type ResidentIdentity = {
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  name_suffix: string | null;
  preferred_name: string | null;
};
export type ControlledMedicationIdentity = {
  id: string;
  medication_name: string;
  strength: string | null;
  form: string | null;
  route: string;
  frequency: string;
  residents: ResidentIdentity | null;
};

/** First and last legal names are required; a nickname or suffix cannot identify a resident. */
export function hasUsableResidentIdentity(resident: ResidentIdentity | null): resident is ResidentIdentity {
  return Boolean(resident?.first_name?.trim() && resident?.last_name?.trim());
}

export function requireControlledMedicationResidentIdentities(
  medications: Array<{ residents: ResidentIdentity | null }>,
): void {
  if (medications.some((medication) => !hasUsableResidentIdentity(medication.residents))) {
    throw new Error("A controlled medication record is missing its resident identity (first and last legal name). Do not count it until the record is corrected.");
  }
}

export function formatResidentIdentity(resident: ResidentIdentity | null): string {
  if (!hasUsableResidentIdentity(resident)) return "Unavailable";
  const legalName = [resident.first_name, resident.middle_name, resident.last_name, resident.name_suffix]
    .map((part) => part?.trim()).filter(Boolean).join(" ");
  return resident.preferred_name?.trim() ? `${legalName} (${resident.preferred_name.trim()})` : legalName;
}

export function formatMedicationDose(medication: Pick<ControlledMedicationIdentity, "strength" | "form" | "route" | "frequency">): string {
  const dose = [medication.strength, medication.form].filter(Boolean).join(" ");
  return [dose || "Dose not recorded", medication.route, medication.frequency].join(" · ");
}

export function formatControlledMedicationIdentity(medication: ControlledMedicationIdentity): string {
  return `Resident: ${formatResidentIdentity(medication.residents)} · ${medication.medication_name} · Dose: ${formatMedicationDose(medication)} · Medication record: ${medication.id}`;
}

export async function resolvePendingCountIdentities(
  client: SupabaseClient<Database>, facilityId: string, medicationIds: string[],
): Promise<Map<string, string>> {
  // A saved count remains identifiable after its medication is stopped.
  const result = await client.from("resident_medications")
    .select("id, medication_name, strength, form, route, frequency, residents!resident_medications_resident_id_fkey(first_name, middle_name, last_name, name_suffix, preferred_name)")
    .eq("facility_id", facilityId).in("id", medicationIds).is("deleted_at", null);
  if (result.error) throw new Error(result.error.message);
  const medications = (result.data ?? []) as ControlledMedicationIdentity[];
  requireControlledMedicationResidentIdentities(medications);
  const labels = new Map(medications.filter((medication) => medication.medication_name?.trim() && medication.route?.trim() && medication.frequency?.trim())
    .map((medication) => [medication.id, formatControlledMedicationIdentity(medication)]));
  if (medicationIds.some((id) => !labels.has(id))) throw new Error("A saved medication record could not be identified.");
  return labels;
}

/** Receipt readiness is bound to this facility and exact count set, never a previous async request. */
export function usePendingCountIdentities(client: SupabaseClient<Database>, facilityId: string | null, counts: SavedControlledCount[]) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([facilityId, counts.map((count) => [count.id, count.resident_medication_id]), attempt]);
  const [result, setResult] = useState<{ key: string; labels: Map<string, string>; error: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const [scope, savedCounts] = JSON.parse(key) as [string | null, [string, string][], number];
    if (!scope || !savedCounts.length) return;
    void resolvePendingCountIdentities(client, scope, [...new Set(savedCounts.map(([, id]) => id))])
      .then((labels) => { if (!cancelled) setResult({ key, labels, error: null }); })
      .catch(() => { if (!cancelled) setResult({ key, labels: new Map(), error: "Saved count identity could not be resolved. Co-signing is blocked. Retry identity lookup; if it still fails, have the resident and medication records corrected." }); });
    return () => { cancelled = true; };
  }, [client, key]);
  const current = result?.key === key ? result : null;
  const emptyLabels = useMemo(() => new Map<string, string>(), []);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { labels: current?.labels ?? emptyLabels, ready: Boolean(facilityId && counts.length && current && !current.error), error: current?.error ?? null, retry };
}
