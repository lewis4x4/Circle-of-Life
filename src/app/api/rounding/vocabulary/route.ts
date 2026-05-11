import { NextResponse } from "next/server";
import { assertRoundingFacilityAccess, getRoundingRequestContext } from "@/lib/rounding/auth";

type VocabField = "location" | "position" | "state";

type VocabRow = {
  field_name: VocabField;
  display_label: string;
  display_order: number;
  facility_id: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const auth = await getRoundingRequestContext();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { context } = auth;
  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get("facilityId")?.trim();

  if (!facilityId) {
    return NextResponse.json({ error: "facilityId is required" }, { status: 400 });
  }
  if (!UUID_PATTERN.test(facilityId)) {
    return NextResponse.json({ error: "facilityId must be a UUID" }, { status: 400 });
  }

  const hasAccess = await assertRoundingFacilityAccess(context, facilityId);
  if (!hasAccess) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const { data, error } = await context.admin
    .from("observation_vocab" as never)
    .select("field_name, display_label, display_order, facility_id")
    .eq("organization_id", context.organizationId)
    .in("field_name", ["location", "position", "state"])
    .eq("active", true)
    .is("deleted_at", null)
    .or(`facility_id.is.null,facility_id.eq.${facilityId}`)
    .order("field_name", { ascending: true })
    .order("facility_id", { ascending: false })
    .order("display_order", { ascending: true })
    .order("display_label", { ascending: true });

  if (error) {
    console.error("[rounding/vocabulary] get", error);
    return NextResponse.json({ error: "Could not load rounds vocabulary" }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as VocabRow[];
  const out: Record<VocabField, string[]> = {
    location: [],
    position: [],
    state: [],
  };

  for (const field of ["location", "position", "state"] as const) {
    const fieldRows = rows.filter((row) => row.field_name === field);
    const byLabel = new Map<string, string>();

    for (const row of fieldRows) {
      if (!byLabel.has(row.display_label) || row.facility_id === facilityId) {
        byLabel.set(row.display_label, row.display_label);
      }
    }

    out[field] = [...byLabel.values()];
  }

  return NextResponse.json(out);
}
