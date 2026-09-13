import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";
import { residentReviewFamilySchema, residentSourceCandidatesReplySchema } from "@/lib/operations/resident-review-sources";

const querySchema = z.object({ task_id: databaseUuidSchema, family: residentReviewFamilySchema,
  start_date: z.iso.date(), end_date: z.iso.date(), cursor: databaseUuidSchema.optional() }).strict();
export async function GET(request: Request) {
  const auth = await requireOperationsActor({ allowedRoles: OPERATIONS_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Choose a task, supported source family and review period" }, { status: 400 });
  const input = parsed.data;
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  if (current.actor.id !== auth.actor.id || current.actor.organizationId !== auth.actor.organizationId || current.actor.appRole !== auth.actor.appRole)
    return NextResponse.json({ error: "Review scope unavailable" }, { status: 404 });
  const fresh = await current.actor.currentActor.client.rpc("list_resident_review_sources" as never, {
    p_task: input.task_id, p_family: input.family, p_start: input.start_date, p_end: input.end_date, p_cursor: input.cursor ?? null, p_limit: 50,
  } as never);
  const reply = residentSourceCandidatesReplySchema.safeParse(fresh.data);
  if (fresh.error || !reply.success || reply.data.task_id.toLowerCase() !== input.task_id.toLowerCase()
    || reply.data.period.start_date !== input.start_date || reply.data.period.end_date !== input.end_date)
    return NextResponse.json({ error: "Source candidates could not be confirmed" }, { status: fresh.error?.code === "42501" ? 404 : 503, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(reply.data, { headers: { "Cache-Control": "no-store" } });
}
