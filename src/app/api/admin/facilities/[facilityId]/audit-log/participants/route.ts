/**
 * Distinct authenticated actors with rows in facility_audit_log (recent window).
 */

import { NextRequest, NextResponse } from "next/server";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import { asUntypedAdmin } from "@/lib/admin/facilities/untyped-admin";
import { formatUploadedByProfile } from "@/lib/users/user-attribution";

interface RouteContext {
  params: Promise<{ facilityId: string }>;
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdminApiActor({
    allowedRoles: ["owner", "org_admin"],
  });
  if ("response" in auth) return auth.response;

  const { facilityId } = await ctx.params;
  if (!(await actorCanAccessFacility(auth.actor, facilityId))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const url = request.nextUrl;
  const from = url.searchParams.get("from")?.trim();
  const to = url.searchParams.get("to")?.trim();

  const untyped = asUntypedAdmin(auth.actor.admin);
  let q = untyped
    .from("facility_audit_log")
    .select("changed_by")
    .eq("facility_id", facilityId)
    .not("changed_by", "is", null)
    .order("changed_at", { ascending: false })
    .limit(4000);

  if (from) q = q.gte("changed_at", `${from}T00:00:00Z`);
  if (to) q = q.lte("changed_at", `${to}T23:59:59Z`);

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: "Failed to fetch participants" }, { status: 500 });

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const r of rows ?? []) {
    const id = typeof r.changed_by === "string" ? r.changed_by : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= 200) break;
  }

  let profiles = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profRows } = await auth.actor.admin
      .from("user_profiles")
      .select("id, email, full_name")
      .in("id", ids);
    profiles = new Map(
      (profRows ?? []).map((p: { id: string; email: string | null; full_name: string | null }) => [
        p.id,
        formatUploadedByProfile({ email: p.email ?? undefined, full_name: p.full_name ?? undefined }),
      ]),
    );
  }

  return NextResponse.json({
    data: ids.map((id) => ({
      id,
      label: profiles.get(id) ?? "Recorded user unavailable",
    })),
  });
}
