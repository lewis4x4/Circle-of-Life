import { NextResponse } from "next/server";
import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";
import { residentReviewHistoryReplySchema } from "@/lib/operations/resident-review-sources";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperationsActor({ allowedRoles: OPERATIONS_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!databaseUuidSchema.safeParse(id).success) return NextResponse.json({ error: "Review scope unavailable" }, { status: 404 });
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  if (current.actor.id !== auth.actor.id || current.actor.organizationId !== auth.actor.organizationId || current.actor.appRole !== auth.actor.appRole)
    return NextResponse.json({ error: "Review scope unavailable" }, { status: 404 });
  const { data, error } = await current.actor.currentActor.client.rpc("read_resident_source_reviews" as never, { p_task: id } as never);
  const parsed = residentReviewHistoryReplySchema.safeParse(data);
  if (error || !parsed.success || parsed.data.task_id.toLowerCase() !== id.toLowerCase()) return NextResponse.json({ error: "Source review history unavailable" }, { status: error?.code === "42501" ? 404 : 503, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(parsed.data, { headers: { "Cache-Control": "no-store" } });
}
