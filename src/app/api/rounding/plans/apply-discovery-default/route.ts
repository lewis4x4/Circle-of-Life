import { NextResponse } from "next/server";

import { logError } from "@/lib/observability/logger";
import { assertRoundingFacilityAccess, getRoundingRequestContext, isRoundingManagerRole } from "@/lib/rounding/auth";
import { getColDiscoveryCadenceProfile, resolveColDiscoveryCadenceKey } from "@/lib/rounding/col-discovery-round-cadence";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function mapRpcError(message: string): { error: string; status: number } {
  const normalized = message.toLowerCase();

  if (normalized.includes("plantation") && normalized.includes("pending")) {
    return {
      error: "Plantation discovery cadence is pending owner decision. Apply defaults after Jessica supplies times.",
      status: 409,
    };
  }

  if (normalized.includes("not configured for col discovery")) {
    return { error: "This facility is not configured for COL discovery-round cadence.", status: 409 };
  }

  if (normalized.includes("facility access denied") || normalized.includes("insufficient role")) {
    return { error: "You do not have permission to apply discovery-round defaults.", status: 403 };
  }

  return { error: "Could not apply discovery-round default.", status: 500 };
}

export async function POST(request: Request) {
  const auth = await getRoundingRequestContext();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { context } = auth;
  if (!isRoundingManagerRole(context.appRole)) {
    return NextResponse.json({ error: "Only clinical and facility leaders can apply discovery defaults" }, { status: 403 });
  }

  let body: { residentId?: string; facilityId?: string };
  try {
    const parsed = (await request.json()) as unknown;
    if (!isRecord(parsed)) {
      return NextResponse.json({ error: "JSON body must be an object" }, { status: 400 });
    }
    body = parsed as { residentId?: string; facilityId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const residentId = body.residentId?.trim();
  const facilityId = body.facilityId?.trim();

  if (!residentId || !facilityId) {
    return NextResponse.json({ error: "residentId and facilityId are required" }, { status: 400 });
  }

  const hasAccess = await assertRoundingFacilityAccess(context, facilityId);
  if (!hasAccess) {
    return NextResponse.json({ error: "No access to this facility" }, { status: 403 });
  }

  const { data: facility, error: facilityError } = await context.admin
    .from("facilities")
    .select("name")
    .eq("id", facilityId)
    .eq("organization_id", context.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (facilityError || !facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const cadenceKey = resolveColDiscoveryCadenceKey(facility.name);
  if (!cadenceKey) {
    return NextResponse.json({ error: "This facility is not configured for COL discovery-round cadence." }, { status: 409 });
  }

  if (getColDiscoveryCadenceProfile(cadenceKey) === "pending") {
    return NextResponse.json(
      {
        error: "Plantation discovery cadence is pending owner decision. Apply defaults after Jessica supplies times.",
      },
      { status: 409 },
    );
  }

  const { data: resident, error: residentError } = await context.admin
    .from("residents")
    .select("id")
    .eq("id", residentId)
    .eq("facility_id", facilityId)
    .eq("organization_id", context.organizationId)
    .is("deleted_at", null)
    .maybeSingle();

  if (residentError || !resident) {
    return NextResponse.json({ error: "residentId must belong to the selected facility" }, { status: 400 });
  }

  const { data, error: rpcError } = await context.admin.rpc(
    "apply_col_discovery_round_observation_plan" as never,
    { p_resident_id: residentId } as never,
  );

  if (rpcError) {
    logError("rounding.plans.apply-discovery-default", rpcError, { facilityId, residentId });
    const mapped = mapRpcError(rpcError.message);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }

  const planId = data as string | null;
  if (typeof planId !== "string" || !planId) {
    return NextResponse.json({ error: "Discovery-round default did not return a plan id." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, planId });
}
