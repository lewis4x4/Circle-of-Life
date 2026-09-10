import { NextResponse } from "next/server";

import { requireOperationsActor } from "@/lib/operations/auth";

export async function POST() {
  const auth = await requireOperationsActor();
  if ("response" in auth) return auth.response;
  // Bulk completion is excluded from the first facility-operations release.
  return NextResponse.json({ error: "Complete tasks individually" }, { status: 409 });
}
