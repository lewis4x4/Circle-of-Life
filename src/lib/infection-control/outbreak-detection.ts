import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { infectionOutbreakGroup, storedTypesForOutbreakGroup } from "./outbreak-group";

type SurvRow = Database["public"]["Tables"]["infection_surveillance"]["Row"];

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

function onsetWithin72h(a: string, b: string): boolean {
  const da = new Date(a + "T12:00:00Z").getTime();
  const db = new Date(b + "T12:00:00Z").getTime();
  const ms = Math.abs(da - db);
  return ms <= 72 * 60 * 60 * 1000;
}

function unitMatch(a: string | null, b: string | null): boolean {
  if (a === null && b === null) return true;
  if (a !== null && b !== null) return a === b;
  return false;
}

/**
 * After a surveillance row is inserted/visible, run outbreak logic (service role).
 */
export async function runOutbreakDetectionAfterSurveillance(
  admin: SupabaseClient<Database>,
  surveillanceId: string,
  declaredByUserId: string,
): Promise<{ outcome: "none" | "linked" | "created" | "reopened" }> {
  const { data: row, error: loadErr } = await admin
    .from("infection_surveillance")
    .select("*")
    .eq("id", surveillanceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (loadErr || !row) {
    console.error("[outbreak] load surveillance", loadErr);
    return { outcome: "none" };
  }

  const s = row as SurvRow;
  if (s.status !== "suspected" && s.status !== "confirmed") {
    return { outcome: "none" };
  }

  const group = infectionOutbreakGroup(s.infection_type);
  const types = storedTypesForOutbreakGroup(group);

  const { data: candidates, error: candErr } = await admin
    .from("infection_surveillance")
    .select("id, onset_date, infection_type, unit_id, status")
    .eq("facility_id", s.facility_id)
    .is("deleted_at", null)
    .in("infection_type", types)
    .in("status", ["suspected", "confirmed"]);

  if (candErr || !candidates?.length) {
    return { outcome: "none" };
  }

  const related = candidates.filter(
    (c) =>
      unitMatch(c.unit_id ?? null, s.unit_id ?? null) &&
      onsetWithin72h(c.onset_date, s.onset_date),
  );

  if (related.length < 2) {
    return { outcome: "none" };
  }

  const { data: activeRows } = await admin
    .from("infection_outbreaks")
    .select("id, total_cases, unit_id, status, contained_at")
    .eq("facility_id", s.facility_id)
    .eq("infection_type", group)
    .is("deleted_at", null)
    .in("status", ["active", "contained"]);

  const activeOrContained = (activeRows ?? []).filter((o) => unitMatch(o.unit_id ?? null, s.unit_id ?? null));

  const activeOut = activeOrContained.find((o) => o.status === "active");
  if (activeOut) {
    await admin.from("infection_surveillance").update({ outbreak_id: activeOut.id }).eq("id", s.id);
    const nextTotal = (activeOut.total_cases ?? 0) + 1;
    await admin.from("infection_outbreaks").update({ total_cases: nextTotal }).eq("id", activeOut.id);
    return { outcome: "linked" };
  }

  const containedOut = activeOrContained.find((o) => o.status === "contained");
  if (containedOut?.contained_at) {
    const containedMs = new Date(containedOut.contained_at).getTime();
    const days = (Date.now() - containedMs) / (86400 * 1000);
    if (days <= 14) {
      await admin
        .from("infection_outbreaks")
        .update({
          status: "active",
          contained_at: null,
          total_cases: (containedOut.total_cases ?? 0) + 1,
        })
        .eq("id", containedOut.id);
      await admin.from("infection_surveillance").update({ outbreak_id: containedOut.id }).eq("id", s.id);
      return { outcome: "reopened" };
    }
  }

  const { data: created, error: insErr } = await admin
    .from("infection_outbreaks")
    .insert({
      facility_id: s.facility_id,
      organization_id: s.organization_id,
      unit_id: s.unit_id,
      infection_type: group,
      status: "active",
      detection_method: "algorithmic",
      declared_by: declaredByUserId,
      initial_case_count: related.length,
      total_cases: related.length,
    })
    .select("id")
    .single();

  if (insErr || !created) {
    console.error("[outbreak] insert", insErr);
    return { outcome: "none" };
  }

  const outbreakId = (created as { id: string }).id;

  await admin.from("infection_surveillance").update({ outbreak_id: outbreakId }).in(
    "id",
    related.map((r) => r.id),
  );

  const actions = CHECKLIST.map((c) => ({
    outbreak_id: outbreakId,
    facility_id: s.facility_id,
    organization_id: s.organization_id,
    action_type: c.action_type,
    title: c.title,
    priority: c.priority,
    sort_order: c.sort_order,
    status: "pending" as const,
  }));

  await admin.from("outbreak_actions").insert(actions);

  return { outcome: "created" };
}
