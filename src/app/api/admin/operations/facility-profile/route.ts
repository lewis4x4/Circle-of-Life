import { NextRequest, NextResponse } from "next/server";
import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { REQUIREMENT_VIEW_ROLES } from "@/lib/operations/requirements";
import { profileRuleProposalSchema, validateProfileRuleProposal } from "@/lib/operations/facility-profile";
import { readFacilityProfile } from "@/lib/operations/facility-profile-server";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "no-store" };
export async function GET(request: NextRequest) {
  const auth = await requireOperationsActor({ allowedRoles: REQUIREMENT_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const id = request.nextUrl.searchParams.get("facility_id");
  if (!id || !UUID.test(id)) return NextResponse.json({ error: "facility_id is required" }, { status: 400, headers });
  try {
    if (!(await actorCanAccessFacility(auth.actor, id))) return NextResponse.json({ error: "Facility not found" }, { status: 404, headers });
    const now = new Date();
    const initial = await readFacilityProfile(auth.actor, id, now);
    const current = await revalidateOperationsActor(auth.actor);
    if ("response" in current) return current.response;
    if (current.actor.id !== auth.actor.id || current.actor.organizationId !== auth.actor.organizationId || current.actor.appRole !== auth.actor.appRole
      || !(await actorCanAccessFacility(current.actor, id))) return NextResponse.json({ error: "Facility not found" }, { status: 404, headers });
    const fresh = await readFacilityProfile(current.actor, id, now);
    if (!initial || !fresh) return NextResponse.json({ error: "Facility not found" }, { status: 404, headers });
    if (JSON.stringify(initial) !== JSON.stringify(fresh)) return NextResponse.json({ error: "Profile changed; reload the complete profile" }, { status: 503, headers });
    return NextResponse.json(fresh, { headers });
  } catch {
    return NextResponse.json({ error: "Profile unavailable; retry the complete read" }, { status: 503, headers });
  }
}
/** Review-only validation. Client claims never create approvals, drafts, or active rules. */
export async function POST(request: Request) {
  const auth = await requireOperationsActor({ allowedRoles: REQUIREMENT_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const parsed = profileRuleProposalSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ valid: false, problems: ["Provide a scoped rule with source, answer, approver and effective date"] }, { status: 400, headers });
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  if (current.actor.id !== auth.actor.id || current.actor.organizationId !== auth.actor.organizationId || !(await actorCanAccessFacility(current.actor, parsed.data.facility_id))) return NextResponse.json({ error: "Facility not found" }, { status: 404, headers });
  return NextResponse.json({ ...validateProfileRuleProposal(parsed.data), activated: false, imported: false }, { headers });
}
