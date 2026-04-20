/**
 * GET    /api/admin/facilities/[facilityId]/audit-log  — Paginated audit log (owner/org_admin only)
 */

import { NextRequest, NextResponse } from "next/server";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import { auditLogQuerySchema } from "@/lib/validation/facility-admin";

import { asUntypedAdmin } from "@/lib/admin/facilities/untyped-admin";

interface RouteContext {
  params: Promise<{ facilityId: string }>;
}

// ── GET: Paginated Audit Log ──────────────────────────────────────

export async function GET(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdminApiActor({
    allowedRoles: ["owner", "org_admin"],
  });
  if ("response" in auth) return auth.response;
  const { actor } = auth;

  const { facilityId } = await ctx.params;
  if (!(await actorCanAccessFacility(actor, facilityId))) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  // Parse query params
  const url = new URL(request.url);
  const rawParams: Record<string, string | string[]> = {};
  url.searchParams.forEach((value, key) => {
    const existing = rawParams[key];
    if (existing) {
      rawParams[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      rawParams[key] = value;
    }
  });

  const parsed = auditLogQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { page, per_page, field_name, user_id, table_name, from, to } = parsed.data;
  const offset = (page - 1) * per_page;

  const admin = actor.admin;
  const untypedAdmin = asUntypedAdmin(admin);

  // Verify facility exists and belongs to org
  const { data: facility } = await admin
    .from("facilities")
    .select("id, organization_id")
    .eq("id", facilityId)
    .eq("organization_id", actor.organization_id!)
    .is("deleted_at", null)
    .maybeSingle();
  if (!facility) {
    return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  try {
    // Build query
    let query = untypedAdmin
      .from("facility_audit_log")
      .select(
        "id, table_name, record_id, action, field_name, old_value, new_value, changed_by, changed_at, ip_address, user_agent",
        { count: "exact" },
      )
      .eq("facility_id", facilityId);

    // Optional filters
    if (field_name) {
      query = query.eq("field_name", field_name);
    }

    if (user_id) {
      query = query.eq("changed_by", user_id);
    }

    if (table_name) {
      query = query.eq("table_name", table_name);
    }

    if (from) {
      query = query.gte("changed_at", `${from}T00:00:00Z`);
    }

    if (to) {
      query = query.lte("changed_at", `${to}T23:59:59Z`);
    }

    // Sort by changed_at descending
    query = query.order("changed_at", { ascending: false });
    query = query.range(offset, offset + per_page - 1);

    const { data: logs, count, error } = await query;

    if (error) {
      return NextResponse.json({ error: "Failed to fetch audit log" }, { status: 500 });
    }

    return NextResponse.json({
      data: logs ?? [],
      pagination: {
        total: count ?? 0,
        page,
        per_page,
        total_pages: Math.ceil((count ?? 0) / per_page),
        has_next: offset + per_page < (count ?? 0),
      },
    });
  } catch (err) {
    console.error("[audit-log] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
