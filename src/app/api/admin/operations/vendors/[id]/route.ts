import { NextResponse } from "next/server";

import { requireOperationsActor } from "@/lib/operations/auth";

export async function PATCH() {
  const auth = await requireOperationsActor({ allowedRoles: ["owner", "org_admin", "facility_admin", "manager"] });
  if ("response" in auth) return auth.response;
  // Booking preferences alter an organization-wide vendor shared by multiple sites.
  // This surface cannot authorize that mutation from a single site's task access.
  return NextResponse.json({ error: "Vendor booking changes require a scoped vendor command" }, { status: 409 });
}
