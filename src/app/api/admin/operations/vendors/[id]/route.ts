import { NextRequest, NextResponse } from "next/server";

import { requireAdminApiActor } from "@/lib/admin/api-auth";
import type { AppRole } from "@/lib/rbac";

const MANAGE_ROLES = new Set<AppRole>(["owner", "org_admin", "facility_admin", "manager"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApiActor();
  if ("response" in auth) return auth.response;
  const { actor } = auth;
  if (!MANAGE_ROLES.has(actor.app_role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json()) as {
    accepts_bookings?: boolean;
    booking_confirmation_days_required?: number | null;
  };

  const { error } = await actor.admin
    .from("vendors" as never)
    .update({
      accepts_bookings: body.accepts_bookings ?? false,
      booking_confirmation_days_required: body.booking_confirmation_days_required ?? 0,
      updated_at: new Date().toISOString(),
      updated_by: actor.id,
    } as never)
    .eq("id", id)
    .eq("organization_id", actor.organization_id)
    .is("deleted_at", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
