import { NextRequest, NextResponse } from "next/server";

import { requireAdminApiActor } from "@/lib/admin/api-auth";
import { executeStaffReactivate } from "@/lib/staff/staff-offboard-server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdminApiActor({
    allowedRoles: ["owner", "org_admin", "facility_admin"],
  });
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const result = await executeStaffReactivate(
    auth.actor,
    id,
    body,
    request.headers.get("idempotency-key"),
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    {
      data: result.staff,
      haven_access: result.haven_access,
      access_control_sync: result.access_control_sync,
    },
    { status: result.status },
  );
}
