import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type FamilyCarePlanItemRow = {
  id: string;
  title: string;
  bodyLines: string[];
};

export type FamilyCarePlanSection = {
  category: Database["public"]["Enums"]["care_plan_item_category"];
  categoryLabel: string;
  items: FamilyCarePlanItemRow[];
};

export type FamilyResidentCarePlanView = {
  residentId: string;
  residentName: string;
  planId: string;
  status: Database["public"]["Enums"]["care_plan_status"];
  statusLabel: string;
  version: number;
  effectiveDateLabel: string;
  reviewDueDateLabel: string;
  lastUpdatedLabel: string;
  planNotes: string | null;
  sections: FamilyCarePlanSection[];
};

export type FamilyCarePlanOverview = {
  residents: FamilyResidentCarePlanView[];
};

function residentDisplayName(row: {
  preferred_name: string | null;
  first_name: string | null;
  last_name: string | null;
}): string {
  return (
    row.preferred_name?.trim() ||
    [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
    "Your loved one"
  );
}

function formatMediumDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function statusLabel(s: Database["public"]["Enums"]["care_plan_status"]): string {
  return s.replace(/_/g, " ");
}

function categoryLabel(c: Database["public"]["Enums"]["care_plan_item_category"]): string {
  const map: Partial<Record<Database["public"]["Enums"]["care_plan_item_category"], string>> = {
    mobility: "Mobility & transfers",
    fall_prevention: "Fall prevention",
    medication_assistance: "Medication & monitoring",
    dietary: "Nutrition",
    eating: "Nutrition & dining",
    behavioral: "Behavioral support",
    cognitive: "Cognition & communication",
    social: "Social & activities",
    bathing: "Bathing",
    dressing: "Dressing",
    grooming: "Grooming",
    toileting: "Toileting",
    skin_integrity: "Skin integrity",
    pain_management: "Pain management",
    other: "Other care areas",
  };
  return map[c] ?? c.replace(/_/g, " ").replace(/\b\w/g, (x) => x.toUpperCase());
}

const STATUS_RANK: Record<Database["public"]["Enums"]["care_plan_status"], number> = {
  active: 0,
  under_review: 1,
  draft: 2,
  archived: 3,
};

function itemBodyLines(row: {
  description: string;
  frequency: string | null;
  special_instructions: string | null;
  goal: string | null;
  interventions: string[] | null;
}): string[] {
  const lines: string[] = [row.description.trim()];
  if (row.frequency?.trim()) lines.push(`Frequency: ${row.frequency.trim()}`);
  if (row.special_instructions?.trim()) lines.push(row.special_instructions.trim());
  if (row.goal?.trim()) lines.push(`Goal: ${row.goal.trim()}`);
  if (row.interventions?.length) {
    for (const inv of row.interventions) {
      if (inv?.trim()) lines.push(inv.trim());
    }
  }
  return lines;
}

/**
 * Active / in-review care plans and items visible to the signed-in family user (RLS).
 */
export async function fetchFamilyCarePlanOverview(
  supabase: SupabaseClient<Database>,
): Promise<{ ok: true; data: FamilyCarePlanOverview } | { ok: false; error: string }> {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr) return { ok: false, error: userErr.message };
  if (!user) return { ok: false, error: "Sign in to view the care summary." };

  const plansQ = await supabase
    .from("care_plans")
    .select(
      "id, resident_id, status, version, effective_date, review_due_date, notes, updated_at",
    )
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(80);

  if (plansQ.error) return { ok: false, error: plansQ.error.message };

  const rawPlans = (plansQ.data ?? []) as Array<{
    id: string;
    resident_id: string;
    status: Database["public"]["Enums"]["care_plan_status"];
    version: number;
    effective_date: string;
    review_due_date: string;
    notes: string | null;
    updated_at: string;
  }>;

  const bestByResident = new Map<string, (typeof rawPlans)[0]>();
  for (const p of rawPlans) {
    const existing = bestByResident.get(p.resident_id);
    if (!existing) {
      bestByResident.set(p.resident_id, p);
      continue;
    }
    const rNew = STATUS_RANK[p.status];
    const rOld = STATUS_RANK[existing.status];
    if (rNew < rOld) bestByResident.set(p.resident_id, p);
  }

  const chosen = [...bestByResident.values()];
  if (chosen.length === 0) {
    return { ok: true, data: { residents: [] } };
  }

  const planIds = chosen.map((p) => p.id);
  const resIds = [...new Set(chosen.map((p) => p.resident_id))];

  const [itemsQ, resQ] = await Promise.all([
    supabase
      .from("care_plan_items")
      .select(
        "id, care_plan_id, resident_id, category, title, description, frequency, special_instructions, goal, interventions, sort_order, is_active",
      )
      .in("care_plan_id", planIds)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
    supabase
      .from("residents")
      .select("id, first_name, last_name, preferred_name")
      .in("id", resIds)
      .is("deleted_at", null),
  ]);

  if (itemsQ.error) return { ok: false, error: itemsQ.error.message };
  if (resQ.error) return { ok: false, error: resQ.error.message };

  const nameById = new Map<string, string>();
  for (const r of resQ.data ?? []) {
    const row = r as {
      id: string;
      first_name: string | null;
      last_name: string | null;
      preferred_name: string | null;
    };
    nameById.set(row.id, residentDisplayName(row));
  }

  type ItemRow = {
    id: string;
    care_plan_id: string;
    resident_id: string;
    category: Database["public"]["Enums"]["care_plan_item_category"];
    title: string;
    description: string;
    frequency: string | null;
    special_instructions: string | null;
    goal: string | null;
    interventions: string[] | null;
    sort_order: number;
  };

  const itemsByPlan = new Map<string, ItemRow[]>();
  for (const row of (itemsQ.data ?? []) as ItemRow[]) {
    const list = itemsByPlan.get(row.care_plan_id) ?? [];
    list.push(row);
    itemsByPlan.set(row.care_plan_id, list);
  }

  const residents: FamilyResidentCarePlanView[] = chosen.map((plan) => {
    const items = itemsByPlan.get(plan.id) ?? [];
    const byCat = new Map<Database["public"]["Enums"]["care_plan_item_category"], ItemRow[]>();
    for (const it of items) {
      const list = byCat.get(it.category) ?? [];
      list.push(it);
      byCat.set(it.category, list);
    }

    const sections: FamilyCarePlanSection[] = [...byCat.entries()].map(([category, catItems]) => ({
      category,
      categoryLabel: categoryLabel(category),
      items: catItems.map((it) => ({
        id: it.id,
        title: it.title,
        bodyLines: itemBodyLines(it),
      })),
    }));

    sections.sort((a, b) => a.categoryLabel.localeCompare(b.categoryLabel));

    return {
      residentId: plan.resident_id,
      residentName: nameById.get(plan.resident_id) ?? "Your loved one",
      planId: plan.id,
      status: plan.status,
      statusLabel: statusLabel(plan.status),
      version: plan.version,
      effectiveDateLabel: formatMediumDate(plan.effective_date),
      reviewDueDateLabel: formatMediumDate(plan.review_due_date),
      lastUpdatedLabel: formatDateTime(plan.updated_at),
      planNotes: plan.notes?.trim() ?? null,
      sections,
    };
  });

  residents.sort((a, b) => a.residentName.localeCompare(b.residentName));

  return { ok: true, data: { residents } };
}
