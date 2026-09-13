import { NextRequest, NextResponse } from "next/server";
import { requireOperationsActor, revalidateOperationsActor, actorCanViewOperations } from "@/lib/operations/auth";
import { OPERATIONS_VIEW_ROLES } from "@/lib/operations/constants";
import { ATTENTION_CATEGORIES, composeNeedsAttention, type AttentionCategory } from "@/lib/operations/needs-attention";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function GET(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: OPERATIONS_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const params = request.nextUrl.searchParams;
  const facilityId = params.get("facility_id"), category = params.get("category"), cursor = params.get("cursor");
  if (facilityId !== null && !UUID.test(facilityId)) return NextResponse.json({ error: "facility_id is invalid" }, { status: 400 });
  if (category !== null && !(ATTENTION_CATEGORIES as readonly string[]).includes(category)) return NextResponse.json({ error: "category is invalid" }, { status: 400 });
  if (cursor !== null && !/^[A-Za-z0-9_-]{1,1000}$/.test(cursor)) return NextResponse.json({ error: "cursor is invalid" }, { status: 400 });
  const args = { facilityId, category: category as AttentionCategory | null, cursor, now: new Date() };
  const outcome = await composeNeedsAttention({ ...args, actor: auth.actor });
  if (outcome.status !== 200) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  if (!actorCanViewOperations(current.actor) || current.actor.organizationId !== auth.actor.organizationId || current.actor.appRole !== auth.actor.appRole) return NextResponse.json({ error: "Authority changed; reload Needs Attention" }, { status: 503 });
  // Re-read the complete permitted source set after waits, including grants, counts and row projections.
  const fresh = await composeNeedsAttention({ ...args, actor: current.actor });
  if (fresh.status !== 200) return NextResponse.json({ error: fresh.error }, { status: fresh.status });
  if (JSON.stringify(fresh.body) !== JSON.stringify(outcome.body)) return NextResponse.json({ error: "Attention records changed; reload to see current records" }, { status: 409 });
  return NextResponse.json(fresh.body);
}
