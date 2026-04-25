import { NextResponse } from "next/server";
import { z } from "zod";

import { getAppRoleFromClaims } from "@/lib/auth/app-role";
import { createClient } from "@/lib/supabase/server";

const facilityIdSchema = z.string().uuid();

const putBodySchema = z.object({
  organizationId: z.string().uuid(),
  metricKey: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/, "metric_key must be snake_case"),
  targetValue: z.number().finite(),
  direction: z.enum(["up", "down"]),
  warningBandPct: z.number().min(0).max(500).optional(),
});

type WriteRow = {
  id: string;
  facility_id: string;
  metric_key: string;
  target_value: number;
  direction: "up" | "down";
  warning_band_pct: number | null;
};

type SingleResult = { data: WriteRow | null; error: { message: string; code?: string } | null };

type ThresholdRow = {
  metric_key: string;
  target_value: number;
  direction: "up" | "down";
  warning_band_pct: number | null;
};

type ResultArr<T> = { data: T[] | null; error: { message: string } | null };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ facilityId: string }> },
) {
  const { facilityId } = await params;
  if (!facilityIdSchema.safeParse(facilityId).success) {
    return NextResponse.json({ error: "Invalid facilityId" }, { status: 400 });
  }

  const url = new URL(request.url);
  const requestedMetrics = url.searchParams
    .get("metrics")
    ?.split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let query = supabase
    .from("facility_metric_targets" as never)
    .select("metric_key, target_value, direction, warning_band_pct")
    .eq("facility_id" as never, facilityId as never)
    .is("deleted_at" as never, null as never);

  if (requestedMetrics && requestedMetrics.length > 0) {
    query = query.in("metric_key" as never, requestedMetrics as never);
  }

  const result = (await query) as unknown as ResultArr<ThresholdRow>;

  if (result.error) {
    return NextResponse.json(
      { error: "Failed to load thresholds", detail: result.error.message },
      { status: 500 },
    );
  }

  const map: Record<
    string,
    { target: number; direction: "up" | "down"; warningBandPct: number }
  > = {};
  for (const row of result.data ?? []) {
    map[row.metric_key] = {
      target: Number(row.target_value),
      direction: row.direction,
      warningBandPct: row.warning_band_pct == null ? 10 : Number(row.warning_band_pct),
    };
  }

  return NextResponse.json({ facilityId, thresholds: map }, { status: 200 });
}

/**
 * `PUT /api/v2/thresholds/[facilityId]` — upsert a single
 * `facility_metric_targets` row.
 *
 * Authorization: caller must be authenticated AND carry an `app_role` of
 * `owner` or `org_admin` (matches the spec §11 authorization matrix and the
 * S2 RLS write policy on the underlying table).
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ facilityId: string }> },
) {
  const { facilityId } = await params;
  if (!facilityIdSchema.safeParse(facilityId).success) {
    return NextResponse.json({ error: "Invalid facilityId" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const role = getAppRoleFromClaims(user);
  if (role !== "owner" && role !== "org_admin") {
    return NextResponse.json(
      { error: "Forbidden — owner or org_admin required" },
      { status: 403 },
    );
  }

  let payload: z.infer<typeof putBodySchema>;
  try {
    payload = putBodySchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        detail: error instanceof z.ZodError ? error.flatten() : String(error),
      },
      { status: 400 },
    );
  }

  const upsertResult = (await supabase
    .from("facility_metric_targets" as never)
    .upsert(
      {
        organization_id: payload.organizationId,
        facility_id: facilityId,
        metric_key: payload.metricKey,
        target_value: payload.targetValue,
        direction: payload.direction,
        warning_band_pct: payload.warningBandPct ?? 10,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      } as never,
      { onConflict: "facility_id,metric_key" } as never,
    )
    .select(
      "id, facility_id, metric_key, target_value, direction, warning_band_pct",
    )
    .single()) as unknown as SingleResult;

  if (upsertResult.error || !upsertResult.data) {
    const denied =
      upsertResult.error?.code === "42501" ||
      /row-level security/i.test(upsertResult.error?.message ?? "");
    return NextResponse.json(
      {
        error: denied
          ? "Forbidden — RLS denied facility access"
          : "Failed to save threshold",
        detail: upsertResult.error?.message,
      },
      { status: denied ? 403 : 500 },
    );
  }

  return NextResponse.json(
    {
      id: upsertResult.data.id,
      facilityId: upsertResult.data.facility_id,
      metricKey: upsertResult.data.metric_key,
      target: Number(upsertResult.data.target_value),
      direction: upsertResult.data.direction,
      warningBandPct:
        upsertResult.data.warning_band_pct == null
          ? 10
          : Number(upsertResult.data.warning_band_pct),
    },
    { status: 200 },
  );
}
