/**
 * Facility & org fact-pack helper for AI surfaces (KB-NEXT-00).
 *
 * Loads a per-facility "fact card" used to ground Haven Insight answers about
 * who runs each facility, mailing addresses, and Medicaid provider enrollment.
 * Data sources:
 *   - facilities.administrator_name              (migration 179_update_col_admin_contacts.sql)
 *   - staff (administrator / assistant_administrator) (migration 024 + 102 + 179)
 *   - facility_medicaid_providers count          (migration 217_col_v2_status_and_medicaid_provider_foundation.sql)
 *   - entities.name                              (migration 002_core_hierarchy.sql)
 *
 * All queries scope to the caller's organization_id and filter deleted_at.
 * Defensive: any query error logs a structured JSON line and returns an empty
 * fact list — fact-pack failure must never break the Haven Insight surface.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { pickRedacted } from "./redact-pii.ts";

export type FacilityFact = {
  id: string;
  name: string;
  licensed_beds: number | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  entity_name: string | null;
  administrator_name: string | null;
  assistant_administrator_name: string | null;
  medicaid_provider_count: number;
};

type FacilityRow = {
  id: string;
  name: string;
  total_licensed_beds: number | null;
  address_line_1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  administrator_name: string | null;
  entity_id: string | null;
  entities: { name: string | null } | { name: string | null }[] | null;
};

type StaffRow = {
  facility_id: string;
  first_name: string | null;
  last_name: string | null;
  staff_role: string;
};

type MedicaidProviderRow = {
  facility_id: string;
};

/**
 * Known-safe keys for facility-facts logging. Whitelisting prevents accidental
 * PHI leakage when callers hand the logger a Supabase error or query payload.
 * Values are deep-redacted via `pickRedacted`.
 */
const FACTS_LOG_WHITELIST = [
  "organization_id",
  "facility_id",
  "status",
  "count",
  "error_code",
] as const;

function logError(event: string, error: unknown, extra: Record<string, unknown> = {}): void {
  const safe = pickRedacted(extra, FACTS_LOG_WHITELIST);
  console.error(
    JSON.stringify({
      fn: "facility-facts",
      event,
      outcome: "error",
      error_message: error instanceof Error ? error.message : String(error),
      ...safe,
    }),
  );
}

function fullName(first: string | null, last: string | null): string | null {
  const parts = [first, last].filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  if (parts.length === 0) return null;
  return parts.join(" ").trim();
}

function composeAddress(row: FacilityRow): string | null {
  const line1 = row.address_line_1?.trim();
  const city = row.city?.trim();
  const state = row.state?.trim();
  const zip = row.zip?.trim();
  if (!line1 || !city || !state || !zip) return null;
  return `${line1}, ${city}, ${state} ${zip}`;
}

function extractEntityName(entities: FacilityRow["entities"]): string | null {
  if (!entities) return null;
  if (Array.isArray(entities)) {
    return entities[0]?.name ?? null;
  }
  return entities.name ?? null;
}

/**
 * Load facility fact cards for an organization.
 *
 * @param admin — service-role Supabase client (RLS bypassed; we still scope by
 *   organization_id + deleted_at IS NULL).
 * @param organizationId — caller's tenant.
 * @returns sorted by facility name; empty array on any query failure.
 */
export async function loadFacilityFacts(
  admin: SupabaseClient,
  organizationId: string,
  facilityIds?: string[],
): Promise<FacilityFact[]> {
  if (!organizationId) return [];
  if (facilityIds && facilityIds.length === 0) return [];

  let facilityRows: FacilityRow[] = [];
  try {
    let q = admin
      .from("facilities")
      .select(
        "id, name, total_licensed_beds, address_line_1, city, state, zip, phone, email, administrator_name, entity_id, entities ( name )",
      )
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(500);
    if (facilityIds) q = q.in("id", facilityIds);
    const { data, error } = await q;
    if (error) {
      logError("facilities_query_failed", error, { organization_id: organizationId });
      return [];
    }
    facilityRows = (data ?? []) as FacilityRow[];
  } catch (err) {
    logError("facilities_query_threw", err, { organization_id: organizationId });
    return [];
  }

  if (facilityRows.length === 0) return [];

  const loadedFacilityIds = facilityRows.map((f) => f.id);

  const staffByFacility = new Map<string, { admin?: string; assistant?: string }>();
  try {
    const { data, error } = await admin
      .from("staff")
      .select("facility_id, first_name, last_name, staff_role")
      .eq("organization_id", organizationId)
      .in("facility_id", loadedFacilityIds)
      .in("staff_role", ["administrator", "assistant_administrator"])
      .is("deleted_at", null);
    if (error) {
      logError("staff_query_failed", error, { organization_id: organizationId });
    } else {
      for (const row of (data ?? []) as StaffRow[]) {
        const bucket = staffByFacility.get(row.facility_id) ?? {};
        const name = fullName(row.first_name, row.last_name);
        if (!name) continue;
        if (row.staff_role === "administrator" && !bucket.admin) {
          bucket.admin = name;
        } else if (row.staff_role === "assistant_administrator" && !bucket.assistant) {
          bucket.assistant = name;
        }
        staffByFacility.set(row.facility_id, bucket);
      }
    }
  } catch (err) {
    logError("staff_query_threw", err, { organization_id: organizationId });
  }

  const medicaidCounts = new Map<string, number>();
  try {
    const { data, error } = await admin
      .from("facility_medicaid_providers")
      .select("facility_id")
      .eq("organization_id", organizationId)
      .in("facility_id", loadedFacilityIds)
      .is("deleted_at", null);
    if (error) {
      logError("medicaid_query_failed", error, { organization_id: organizationId });
    } else {
      for (const row of (data ?? []) as MedicaidProviderRow[]) {
        medicaidCounts.set(row.facility_id, (medicaidCounts.get(row.facility_id) ?? 0) + 1);
      }
    }
  } catch (err) {
    logError("medicaid_query_threw", err, { organization_id: organizationId });
  }

  const facts: FacilityFact[] = facilityRows.map((row) => {
    const staff = staffByFacility.get(row.id) ?? {};
    return {
      id: row.id,
      name: row.name,
      licensed_beds: row.total_licensed_beds ?? null,
      address: composeAddress(row),
      phone: row.phone?.trim() || null,
      email: row.email?.trim() || null,
      entity_name: extractEntityName(row.entities),
      administrator_name: row.administrator_name?.trim() || staff.admin || null,
      assistant_administrator_name: staff.assistant ?? null,
      medicaid_provider_count: medicaidCounts.get(row.id) ?? 0,
    };
  });

  facts.sort((a, b) => a.name.localeCompare(b.name));
  return facts;
}

/**
 * Render a fact list as a plain-text block for system-prompt injection.
 * Missing nullable fields are omitted; required slots (Administrator,
 * Assistant Administrator, Medicaid providers enrolled) always render.
 */
export function formatFacilityFactsBlock(facts: FacilityFact[]): string {
  if (!facts || facts.length === 0) {
    return "FACILITY DIRECTORY: (none available)";
  }

  const lines: string[] = ["FACILITY DIRECTORY:"];
  for (const f of facts) {
    const entityPart = f.entity_name ? ` (entity: ${f.entity_name})` : "";
    const bedsPart = typeof f.licensed_beds === "number" ? ` — ${f.licensed_beds} licensed beds` : "";
    lines.push(`  ${f.name}${entityPart}${bedsPart}`);
    lines.push(`    Administrator: ${f.administrator_name ?? "—"}`);
    lines.push(`    Assistant Administrator: ${f.assistant_administrator_name ?? "—"}`);
    if (f.address) lines.push(`    Address: ${f.address}`);
    if (f.phone) lines.push(`    Phone: ${f.phone}`);
    if (f.email) lines.push(`    Email: ${f.email}`);
    lines.push(`    Medicaid providers enrolled: ${f.medicaid_provider_count}`);
  }
  return lines.join("\n");
}
