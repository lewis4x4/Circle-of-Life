import { NextResponse } from "next/server";
import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";
import { recheckResidentSourceReviewSchema, residentReviewHistoryReplySchema } from "@/lib/operations/resident-review-sources";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperationsActor({ allowedRoles: OPERATIONS_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const input = recheckResidentSourceReviewSchema.safeParse(await request.json().catch(() => null));
  if (!databaseUuidSchema.safeParse(id).success || !input.success) return NextResponse.json({ error: "Choose an existing review reference and request key" }, { status: 400 });
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { error } = await current.actor.currentActor.client.rpc("recheck_resident_source_review" as never, { p_task: id, p_reference: input.data.reference_id, p_request_key: input.data.request_key } as never);
  if (error) return NextResponse.json({ error: "Source recheck could not be confirmed; retain the request before retry" },
    { status: error.code === "42501" ? 404 : error.code === "23505" ? 409 : 503, headers: { "Cache-Control": "no-store" } });
  const latest = await revalidateOperationsActor(current.actor);
  if ("response" in latest) return latest.response;
  if (latest.actor.id !== auth.actor.id || latest.actor.organizationId !== auth.actor.organizationId || latest.actor.appRole !== auth.actor.appRole)
    return NextResponse.json({ error: "Review scope unavailable" }, { status: 404 });
  const fresh = await latest.actor.currentActor.client.rpc("read_resident_source_reviews" as never, { p_task: id } as never);
  const parsed = residentReviewHistoryReplySchema.safeParse(fresh.data);
  if (fresh.error || !parsed.success || parsed.data.task_id.toLowerCase() !== id.toLowerCase())
    return NextResponse.json({ error: "Source review history unavailable" }, { status: fresh.error?.code === "42501" ? 404 : 503 });
  return NextResponse.json(parsed.data, { headers: { "Cache-Control": "no-store" } });
}
