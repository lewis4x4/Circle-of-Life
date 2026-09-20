import { NextResponse } from "next/server";
import { getRoundingRequestContext, revalidateRoundingRequestContext } from "@/lib/rounding/auth";
import type { CompletionPayload } from "@/lib/rounding/types";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getRoundingRequestContext();
  if ("response" in auth) return auth.response;
  let body: { retryOwner?: CompletionPayload["retryOwner"] } | null;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  const owner = body?.retryOwner;
  if (!owner || typeof owner.facilityId !== "string" || !owner.facilityId || owner.userId !== auth.context.userId
    || owner.sessionId !== auth.context.sessionId || owner.organizationId !== auth.context.organizationId) {
    return NextResponse.json({ error: "The account or session changed. Reopen this check." }, { status: 403 });
  }
  const fresh = await revalidateRoundingRequestContext(auth.context, { facilityId: owner.facilityId });
  if ("response" in fresh) return fresh.response;
  if (fresh.context.userId !== owner.userId || fresh.context.sessionId !== owner.sessionId || fresh.context.organizationId !== owner.organizationId || !fresh.context.currentStaffId) {
    return NextResponse.json({ error: "Current staff authorization is required." }, { status: 403 });
  }
  const taskId = (await params).id;
  const { data: task, error: taskError } = await fresh.context.admin.from("resident_observation_tasks")
    .select("id").eq("id", taskId).eq("organization_id", owner.organizationId)
    .eq("facility_id", owner.facilityId).is("deleted_at", null).maybeSingle();
  if (taskError || !task) return NextResponse.json({ error: "Observation task not found" }, { status: 404 });
  // Use the signed request's client. The locked RPC verifies current authority
  // and records a rescue assignment without replacing the primary owner.
  const { data, error } = await fresh.context.actor.client.rpc("claim_observation_task" as never, { p_task_id: taskId } as never);
  const result = data as { claimed?: boolean; staff_id?: string } | null;
  if (error || !result?.claimed || result.staff_id !== fresh.context.currentStaffId) {
    return NextResponse.json({ error: "This check could not be claimed. Refresh the queue and try again." }, { status: error?.code === "42501" ? 403 : 409 });
  }
  return NextResponse.json({ ok: true, taskId });
}
