import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiActor } from "@/lib/admin/api-auth";
import { alertError, alertRpc, deliverTest, testInput } from "@/lib/system-alerts/server";
export async function POST(request: NextRequest) {
  const auth = await requireAdminApiActor({ allowedRoles: ["owner", "org_admin"] });
  if ("response" in auth) return auth.response;
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = testInput.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Save settings before sending a test." }, { status: 422 });
  const { data, error } = await alertRpc("system_alert_email_test", { p_expected_version: parsed.data.expectedVersion });
  if (error) return alertError(error);
  return deliverTest((data as { id: string }).id);
}
