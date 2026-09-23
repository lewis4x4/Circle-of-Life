import { NextResponse } from "next/server";
import { logError } from "@/lib/observability/logger";
import { assertRoundingFacilityAccess, getRoundingRequestContext } from "@/lib/rounding/auth";
import { emptyObservationVocabCatalog, type ObservationVocabOption } from "@/lib/rounding/observation-chips";

const VOCAB_FIELDS = ["location", "position", "state", "meal_intake", "mood_state", "med_response"] as const;

type VocabField = (typeof VOCAB_FIELDS)[number];

type VocabRow = {
  field_name: VocabField;
  value_code: string;
  display_label: string;
  display_order: number;
  facility_id: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const auth = await getRoundingRequestContext();
  if ("response" in auth) return auth.response;

  const { context } = auth;
  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get("facilityId")?.trim();

  if (!facilityId) {
    return NextResponse.json({ error: "facilityId is required" }, { status: 400 });
  }
  if (!UUID_PATTERN.test(facilityId)) {
    return NextResponse.json({ error: "The facility is missing or not valid." }, { status: 400 });
  }

  const hasAccess = await assertRoundingFacilityAccess(context, facilityId);
  if (!hasAccess) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const { data, error } = await context.admin
    .from("observation_vocab" as never)
    .select("field_name, value_code, display_label, display_order, facility_id")
    .eq("organization_id", context.organizationId)
    .in("field_name", [...VOCAB_FIELDS])
    .eq("active", true)
    .is("deleted_at", null)
    .or(`facility_id.is.null,facility_id.eq.${facilityId}`)
    .order("field_name", { ascending: true })
    .order("facility_id", { ascending: false })
    .order("display_order", { ascending: true })
    .order("display_label", { ascending: true });

  if (error) {
    logError("rounding.vocabulary.get", error, { facilityId });
    return NextResponse.json({ error: "Could not load rounds vocabulary" }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as VocabRow[];
  const catalog = emptyObservationVocabCatalog();

  for (const field of VOCAB_FIELDS) {
    // A facility row wins over the org-wide row carrying the same code.
    const byCode = new Map<string, ObservationVocabOption>();
    for (const row of rows) {
      if (row.field_name !== field) continue;
      if (!byCode.has(row.value_code) || row.facility_id === facilityId) {
        byCode.set(row.value_code, { code: row.value_code, label: row.display_label });
      }
    }
    catalog[field] = [...byCode.values()];
  }

  return NextResponse.json(catalog);
}
