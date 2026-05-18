/**
 * Emergency Contacts directory — canonical grouping, KPIs, quick reference, search.
 * DB: `facility_emergency_contacts.contact_category` (no separate categories table per launch constraints).
 */

import type { EmergencyContactRow } from "@/hooks/useFacilityEmergencyContacts";
import type { ContactCategory } from "@/lib/admin/facilities/facility-constants";
import { CONTACT_CATEGORY_LABELS } from "@/lib/admin/facilities/facility-constants";

export type ParentGroupId =
  | "public_safety"
  | "county_city"
  | "utilities"
  | "building_systems"
  | "healthcare";

export const PARENT_GROUP_LABEL: Record<ParentGroupId, string> = {
  public_safety: "Public safety",
  county_city: "County & city government",
  utilities: "Utilities — emergency lines",
  building_systems: "Building systems vendors",
  healthcare: "Healthcare partners",
};

export type SlotContext = { floorCount: number; hasElevator: boolean };

/** KPI + gap detection — one row per operational requirement. */
type KpiSlot = {
  id: string;
  anyOf: ContactCategory[];
  skipIf?: (ctx: SlotContext) => boolean;
};

function kpiSlots(): KpiSlot[] {
  return [
    { id: "hospital_er", anyOf: ["hospital"] },
    { id: "sheriff", anyOf: ["law_enforcement"] },
    { id: "fire_dept", anyOf: ["fire_department"] },
    { id: "poison", anyOf: ["poison_control"] },
    { id: "county_em", anyOf: ["county_emergency_mgmt"] },
    { id: "health_dept", anyOf: ["county_health_dept"] },
    { id: "bldg_zoning", anyOf: ["county_bldg_zoning"] },
    { id: "city", anyOf: ["city_government"] },
    { id: "ahca", anyOf: ["ahca_hotline"] },
    { id: "ombudsman", anyOf: ["ombudsman"] },
    { id: "aps", anyOf: ["dcf_abuse_hotline"] },
    { id: "electric", anyOf: ["utility_electric"] },
    { id: "gas", anyOf: ["gas_provider", "utility_gas"] },
    { id: "water", anyOf: ["utility_water"] },
    { id: "telecom", anyOf: ["utility_internet"] },
    { id: "fire_alarm", anyOf: ["fire_alarm_monitoring"] },
    { id: "generator", anyOf: ["generator_service"] },
    { id: "hvac", anyOf: ["hvac_emergency"] },
    {
      id: "elevator",
      anyOf: ["elevator_service"],
      skipIf: (ctx) => ctx.floorCount <= 1 || !ctx.hasElevator,
    },
    { id: "plumbing", anyOf: ["plumbing_emergency"] },
    { id: "medical_oncall", anyOf: ["facility_on_call", "corporate_on_call"] },
    { id: "pharmacy", anyOf: ["pharmacy_after_hours"] },
  ];
}

function presentCategories(contacts: EmergencyContactRow[]): Set<string> {
  const s = new Set<string>();
  for (const c of contacts) {
    if (c.contact_category) s.add(c.contact_category);
  }
  return s;
}

export function countMissingEmergencySlots(
  contacts: EmergencyContactRow[],
  ctx: SlotContext,
): number {
  const present = presentCategories(contacts);
  let missing = 0;
  for (const rule of kpiSlots()) {
    if (rule.skipIf?.(ctx)) continue;
    const ok = rule.anyOf.some((cat) => present.has(cat));
    if (!ok) missing += 1;
  }
  return missing;
}

/** Map each DB category to a parent group for section layout. */
export const CATEGORY_GROUP: Partial<Record<ContactCategory, ParentGroupId>> = {
  law_enforcement: "public_safety",
  fire_department: "public_safety",
  poison_control: "public_safety",
  county_emergency_mgmt: "county_city",
  county_health_dept: "county_city",
  county_bldg_zoning: "county_city",
  city_government: "county_city",
  ahca_hotline: "county_city",
  ombudsman: "county_city",
  dcf_abuse_hotline: "county_city",
  utility_electric: "utilities",
  utility_gas: "utilities",
  gas_provider: "utilities",
  utility_water: "utilities",
  utility_internet: "utilities",
  fire_alarm_monitoring: "building_systems",
  generator_service: "building_systems",
  hvac_emergency: "building_systems",
  elevator_service: "building_systems",
  plumbing_emergency: "building_systems",
  electric_maintenance: "building_systems",
  locksmith: "building_systems",
  hospital: "healthcare",
  pharmacy_after_hours: "healthcare",
  corporate_on_call: "healthcare",
  facility_on_call: "healthcare",
  evacuation_partner: "healthcare",
  osha: "county_city",
  other: "healthcare",
};

export const GROUP_ORDER: ParentGroupId[] = [
  "public_safety",
  "county_city",
  "utilities",
  "building_systems",
  "healthcare",
];

export type DisplayLine = {
  org: string;
  subtitle?: string;
  metaTag?: string;
};

/** Strip parenthetical fuel/vendor tag from line 1; keep as meta. */
export function formatContactDisplay(name: string): DisplayLine {
  const trimmed = name.trim();
  const paren = trimmed.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (paren) {
    return { org: paren[1].trim(), metaTag: paren[2].trim() };
  }
  const emDash = trimmed.split(/\s*[—–-]\s*/);
  if (emDash.length >= 2) {
    return { org: emDash[0].trim(), subtitle: emDash.slice(1).join(" · ").trim() };
  }
  return { org: trimmed };
}

export function categoryLabelForRow(cat: string): string {
  if (cat === "hospital") return "Closest receiving hospital / ER";
  const key = cat as keyof typeof CONTACT_CATEGORY_LABELS;
  return CONTACT_CATEGORY_LABELS[key] ?? cat;
}

function contactMatchesQuery(c: EmergencyContactRow, digitQuery: string, lower: string): boolean {
  if (lower.length === 0) return true;
  const name = (c.contact_name ?? "").toLowerCase();
  const notes = (c.notes ?? "").toLowerCase();
  const phones = `${c.phone_primary} ${c.phone_secondary ?? ""}`.replace(/\D/g, "");
  const cat = categoryLabelForRow(c.contact_category).toLowerCase();
  if (name.includes(lower) || notes.includes(lower) || cat.includes(lower)) return true;
  if (digitQuery.length > 0 && phones.includes(digitQuery)) return true;
  return false;
}

export function filterEmergencyContacts(contacts: EmergencyContactRow[], query: string): EmergencyContactRow[] {
  const q = query.trim();
  if (!q) return contacts;
  const lower = q.toLowerCase();
  const digitQuery = q.replace(/\D/g, "");
  return contacts.filter((c) => contactMatchesQuery(c, digitQuery, lower));
}

export function firstByCategory(
  contacts: EmergencyContactRow[],
  categories: ContactCategory[],
): EmergencyContactRow | undefined {
  for (const c of contacts) {
    if (categories.includes(c.contact_category as ContactCategory)) return c;
  }
  return undefined;
}
