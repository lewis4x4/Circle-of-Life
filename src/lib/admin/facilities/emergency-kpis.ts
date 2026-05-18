/**
 * Emergency Contacts tab KPI helpers (facility detail).
 * Verification / availability metrics require DB columns — surfaced as "—" until schema exists.
 */

import type { EmergencyContactRow } from "@/hooks/useFacilityEmergencyContacts";
import type { ContactCategory } from "@/lib/admin/facilities/facility-constants";

/** A required operational slot is satisfied if any of these stored categories exists for the facility. */
type SlotRule =
  | { id: string; anyOf: ContactCategory[]; skipIf?: (ctx: SlotContext) => boolean };

export type SlotContext = { floorCount: number; hasElevator: boolean };

function slotRules(): SlotRule[] {
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
  for (const rule of slotRules()) {
    if (rule.skipIf?.(ctx)) continue;
    const ok = rule.anyOf.some((cat) => present.has(cat));
    if (!ok) missing += 1;
  }
  return missing;
}
