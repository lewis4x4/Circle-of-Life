import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const facilityIdSchema = z.string().uuid();

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
