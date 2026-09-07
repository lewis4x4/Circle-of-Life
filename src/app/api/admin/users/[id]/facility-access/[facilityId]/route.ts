import { NextRequest, NextResponse } from "next/server";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { DELETE as revokeFacilityAccess } from "../route";

export async function DELETE(request: NextRequest, context: {
  params: Promise<{ id: string; facilityId: string }>;
}) {
  const params = await context.params;
  if (!UUID_STRING_RE.test(params.id) || !UUID_STRING_RE.test(params.facilityId)) {
    return NextResponse.json({ error: "Invalid user or facility ID" }, { status: 400 });
  }
  return revokeFacilityAccess(request, { params: Promise.resolve(params) });
}
