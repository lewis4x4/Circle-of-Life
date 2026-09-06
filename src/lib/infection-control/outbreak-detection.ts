import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { infectionOutbreakGroup, storedTypesForOutbreakGroup } from "./outbreak-group";

const CHECKLIST: {
  sort_order: number;
  action_type: Database["public"]["Tables"]["outbreak_actions"]["Row"]["action_type"];
  title: string;
  priority: Database["public"]["Tables"]["outbreak_actions"]["Row"]["priority"];
}[] = [
  { sort_order: 1, action_type: "isolation_cohorting", title: "Isolate/cohort affected residents on the unit", priority: "immediate" },
  { sort_order: 2, action_type: "enhanced_ppe", title: "Implement enhanced PPE for unit staff (type based on infection)", priority: "immediate" },
  { sort_order: 3, action_type: "physician_notification", title: "Notify attending physicians for all affected residents", priority: "immediate" },
  { sort_order: 4, action_type: "family_notification", title: "Notify families of affected residents about the outbreak", priority: "standard" },
  { sort_order: 5, action_type: "visitor_restriction", title: "Post visitor restriction notices; notify regular visitors", priority: "standard" },
  { sort_order: 6, action_type: "staff_screening", title: "Implement daily staff symptom screening before shift", priority: "standard" },
  { sort_order: 7, action_type: "environmental_cleaning", title: "Escalate cleaning protocol (frequency + disinfectant)", priority: "standard" },
  { sort_order: 8, action_type: "testing_protocol", title: "Determine testing scope: unit-wide or facility-wide", priority: "standard" },
  { sort_order: 9, action_type: "ahca_notification", title: "Report to AHCA if required (≥3 cases or specific organism)", priority: "standard" },
  { sort_order: 10, action_type: "treatment_protocol", title: "Establish treatment protocol with facility physician", priority: "when_possible" },
];

/** Runs once per surveillance record; retries cannot inflate outbreak totals. */
export async function runOutbreakDetectionAfterSurveillance(admin: SupabaseClient<Database>, surveillanceId: string, declaredByUserId: string): Promise<{ outcome: "none" | "linked" | "created" | "reopened" }> {
  const { data: row, error: loadError } = await admin.from("infection_surveillance").select("infection_type").eq("id", surveillanceId).is("deleted_at", null).single();
  if (loadError) throw loadError;
  const group = infectionOutbreakGroup(row.infection_type);
  const { data, error } = await admin.rpc("evaluate_infection_outbreak_atomic" as never, { p_surveillance_id: surveillanceId, p_actor_id: declaredByUserId, p_group: group, p_types: storedTypesForOutbreakGroup(group), p_checklist: CHECKLIST } as never);
  if (error) throw error;
  if (!["none", "linked", "created", "reopened"].includes(String(data))) throw new Error("Outbreak review was not acknowledged");
  return { outcome: data as "none" | "linked" | "created" | "reopened" };
}
