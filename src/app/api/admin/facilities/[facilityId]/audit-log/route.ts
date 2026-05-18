/**
 * GET    /api/admin/facilities/[facilityId]/audit-log  — Paginated audit log (owner/org_admin only)
 */

import { NextRequest, NextResponse } from "next/server";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";
import { auditLogQuerySchema } from "@/lib/validation/facility-admin";
import { formatUploadedByProfile } from "@/lib/users/user-attribution";

import { asUntypedAdmin } from "@/lib/admin/facilities/untyped-admin";
import { formatAuditJsonCell } from "@/lib/admin/facilities/facility-audit-ui";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

interface RouteContext {
  params: Promise<{ facilityId: string }>;
}

type AuditDbRow = {
  id: string;
  table_name: string;
  record_id: string;
  action: string;
  field_name: string | null;
  old_value: unknown;
  new_value: unknown;
  changed_by: string | null;
  changed_at: string;
  ip_address: unknown;
  user_agent: string | null;
};

function humanizeTable(table: string): string {
  return table.replace(/_/g, " ");
}

function summarizeAuditRow(row: AuditDbRow): string {
  const t = humanizeTable(row.table_name ?? "record");
  if (row.action === "INSERT") return `Created ${t} record`;
  if (row.action === "DELETE") return `Archived or removed ${t} record`;
  if (row.field_name) return `Updated ${t} · ${humanizeTable(row.field_name)}`;
  return `Updated ${t}`;
}

async function enrichAuditRows(admin: SupabaseClient<Database>, rows: AuditDbRow[]): Promise<
  Array<
    AuditDbRow & {
      changed_by_display: string;
      summary: string;
      old_value_text: string | null;
      new_value_text: string | null;
    }
  >
> {
  const ids = [...new Set(rows.map((r) => r.changed_by).filter((x): x is string => x != null && x !== ""))];
  let profileMap = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles } = await admin.from("user_profiles").select("id, email, full_name").in("id", ids);
    profileMap = new Map(
      (profiles ?? []).map((p: { id: string; email: string | null; full_name: string | null }) => [
        p.id,
        formatUploadedByProfile({
          email: p.email ?? undefined,
          full_name: p.full_name ?? undefined,
        }),
      ]),
    );
  }

  return rows.map((row) => {
    const cid = row.changed_by;
    const changedByDisplay =
      cid != null ? profileMap.get(cid) ?? "" : ""; // fallback below
    return {
      ...row,
      changed_by_display:
        cid != null ? (changedByDisplay || "Recorded user unavailable") : "Service session · actor not propagated",
      summary: summarizeAuditRow(row),
      old_value_text: row.old_value == null ? null : formatAuditJsonCell(row.old_value),
      new_value_text: row.new_value == null ? null : formatAuditJsonCell(row.new_value),
    };
  });
}

function splitCsv(s: string | undefined): string[] | undefined {
  if (s == null || s.trim() === "") return undefined;
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

/** PostgREST `ilike` fragments must escape SQL wildcards. */
function sanitizeAuditIlike(q: string): string {
  return q
    .replace(/[%_\\]/g, "\\$&")
    .replace(/,/g, " ")
    .trim()
    .slice(0, 120);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  const {
    page,
    per_page,
    field_name,
    user_id,
    table_name,
    table_name_in,
    action_in,
    search,
    from,
    to,
  } = parsed.data;
  const offset = (page - 1) * per_page;

  const admin = actor.admin;
  const untypedAdmin = asUntypedAdmin(admin);

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
    const tables = splitCsv(table_name_in);
    const requestedActions = splitCsv(action_in)?.map((a) => a.toUpperCase()).filter((a) =>
      ["INSERT", "UPDATE", "DELETE"].includes(a),
    );
    const userIdCsvProvided = parsed.data.user_ids != null && parsed.data.user_ids.trim() !== "";
    const requestedActorIds =
      splitCsv(parsed.data.user_ids)?.map((id) => id.trim()).filter((id) => UUID_RE.test(id)) ?? undefined;

    if (user_id == null && userIdCsvProvided && (requestedActorIds == null || requestedActorIds.length === 0)) {
      return NextResponse.json({
        data: [],
        pagination: {
          total: 0,
          page,
          per_page,
          total_pages: 0,
          has_next: false,
        },
      });
    }

    let query = untypedAdmin
      .from("facility_audit_log")
      .select(
        "id, table_name, record_id, action, field_name, old_value, new_value, changed_by, changed_at, ip_address, user_agent",
        { count: "exact" },
      )
      .eq("facility_id", facilityId);

    if (field_name) query = query.eq("field_name", field_name);

    if (requestedActorIds && requestedActorIds.length > 0) {
      query = query.in("changed_by", requestedActorIds);
    } else if (user_id) query = query.eq("changed_by", user_id);

    if (tables && tables.length === 0) {
      return NextResponse.json({
        data: [],
        pagination: {
          total: 0,
          page,
          per_page,
          total_pages: 0,
          has_next: false,
        },
      });
    }

    if (tables && tables.length > 0) query = query.in("table_name", tables);
    else if (table_name) query = query.eq("table_name", table_name);

    const actionCsvProvided = action_in != null && action_in.trim() !== "";

    if (actionCsvProvided && (requestedActions == null || requestedActions.length === 0)) {
      return NextResponse.json({
        data: [],
        pagination: {
          total: 0,
          page,
          per_page,
          total_pages: 0,
          has_next: false,
        },
      });
    }

    if (requestedActions && requestedActions.length > 0) query = query.in("action", requestedActions);

    if (from) query = query.gte("changed_at", `${from}T00:00:00Z`);
    if (to) query = query.lte("changed_at", `${to}T23:59:59Z`);

    const trimmedSearch = search?.trim();
    if (trimmedSearch && trimmedSearch.length > 1) {
      const pattern = `%${sanitizeAuditIlike(trimmedSearch)}%`;
      query = query.or(`field_name.ilike.${pattern},table_name.ilike.${pattern}`);
    }

    query = query.order("changed_at", { ascending: false });
    query = query.range(offset, offset + per_page - 1);

    const { data: logs, count, error } = await query;

    if (error) {
      console.error("[audit-log] query:", error.message);
      return NextResponse.json({ error: "Failed to fetch audit log" }, { status: 500 });
    }

    const rows = (logs ?? []) as AuditDbRow[];
    const enriched = await enrichAuditRows(admin, rows);

    return NextResponse.json({
      data: enriched,
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
