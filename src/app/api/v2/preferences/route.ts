import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const dashboardIdSchema = z.string().trim().min(1).max(200);

const savedViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  filters: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().optional(),
});

const putBodySchema = z.object({
  dashboardId: dashboardIdSchema,
  columnOrder: z.array(z.string()).optional(),
  columnVisibility: z.record(z.string(), z.boolean()).optional(),
  savedViews: z.array(savedViewSchema).optional(),
});

type PrefRow = {
  id: string;
  user_id: string;
  dashboard_id: string;
  column_order: string[];
  column_visibility: Record<string, boolean>;
  saved_views: unknown[];
  updated_at: string;
};

type ResultMaybe<T> = { data: T | null; error: { message: string } | null };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = dashboardIdSchema.safeParse(url.searchParams.get("dashboardId") ?? "");
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid dashboardId" }, { status: 400 });
  }
  const dashboardId = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const result = (await supabase
    .from("user_dashboard_preferences" as never)
    .select(
      "id, user_id, dashboard_id, column_order, column_visibility, saved_views, updated_at",
    )
    .eq("user_id" as never, user.id as never)
    .eq("dashboard_id" as never, dashboardId as never)
    .is("deleted_at" as never, null as never)
    .maybeSingle()) as unknown as ResultMaybe<PrefRow>;

  if (result.error) {
    return NextResponse.json(
      { error: "Failed to load preferences", detail: result.error.message },
      { status: 500 },
    );
  }

  if (!result.data) {
    return NextResponse.json(
      {
        dashboardId,
        columnOrder: [],
        columnVisibility: {},
        savedViews: [],
        exists: false,
      },
      { status: 200 },
    );
  }

  return NextResponse.json(
    {
      dashboardId: result.data.dashboard_id,
      columnOrder: result.data.column_order ?? [],
      columnVisibility: result.data.column_visibility ?? {},
      savedViews: result.data.saved_views ?? [],
      updatedAt: result.data.updated_at,
      exists: true,
    },
    { status: 200 },
  );
}

export async function PUT(request: Request) {
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

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const upsertResult = (await supabase
    .from("user_dashboard_preferences" as never)
    .upsert(
      {
        user_id: user.id,
        dashboard_id: payload.dashboardId,
        column_order: payload.columnOrder ?? [],
        column_visibility: payload.columnVisibility ?? {},
        saved_views: payload.savedViews ?? [],
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "user_id,dashboard_id" } as never,
    )
    .select(
      "id, user_id, dashboard_id, column_order, column_visibility, saved_views, updated_at",
    )
    .single()) as unknown as ResultMaybe<PrefRow>;

  if (upsertResult.error || !upsertResult.data) {
    return NextResponse.json(
      {
        error: "Failed to save preferences",
        detail: upsertResult.error?.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      dashboardId: upsertResult.data.dashboard_id,
      columnOrder: upsertResult.data.column_order ?? [],
      columnVisibility: upsertResult.data.column_visibility ?? {},
      savedViews: upsertResult.data.saved_views ?? [],
      updatedAt: upsertResult.data.updated_at,
      exists: true,
    },
    { status: 200 },
  );
}
