import { NextResponse } from "next/server";

import { requireCurrentApiActor, revalidateCurrentApiActor } from "@/lib/auth/current-api-actor";
import { logError } from "@/lib/observability/logger";
import { ALL_APP_ROLES, type AppRole } from "@/lib/rbac";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";

type FeedbackBody = {
  id?: string;
  facilityId?: string | null;
  shellKind?: string;
  route?: string;
  category?: string;
  severity?: string;
  title?: string;
  detail?: string;
  status?: string;
};

const REVIEWER_ROLE_LIST = ["owner", "org_admin", "facility_admin", "manager"] as const;
const REVIEWER_ROLES = new Set<AppRole>(REVIEWER_ROLE_LIST);
const CATEGORIES = new Set(["bug", "confusion", "request", "friction", "praise"]);
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const MAX_SHELL_KIND_LENGTH = 80;
const MAX_ROUTE_LENGTH = 240;
const MAX_TITLE_LENGTH = 180;
const MAX_DETAIL_LENGTH = 4_000;

function trimToMax(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

async function requireActor(allowedRoles: readonly AppRole[]) {
  const result = await requireCurrentApiActor({ allowedRoles, scope: "pilot-feedback" });
  if ("response" in result) return { error: result.response };
  return result.actor;
}

export async function POST(request: Request) {
  let body: FeedbackBody;
  try {
    body = (await request.json()) as FeedbackBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const actor = await requireActor(ALL_APP_ROLES);
  if ("error" in actor) return actor.error;

  const { admin } = actor;

  const category = body.category?.trim() ?? "";
  const severity = body.severity?.trim() ?? "medium";
  const title = body.title?.trim() ?? "";
  const detail = body.detail?.trim() ?? "";
  const route = body.route?.trim() ?? "/";
  const shellKind = trimToMax(body.shellKind?.trim() || "unknown", MAX_SHELL_KIND_LENGTH);
  const facilityId = body.facilityId?.trim() || null;

  if (!CATEGORIES.has(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  if (!SEVERITIES.has(severity)) {
    return NextResponse.json({ error: "Invalid severity" }, { status: 400 });
  }
  if (!title || !detail) {
    return NextResponse.json({ error: "Title and detail are required" }, { status: 400 });
  }

  if (facilityId) {
    const canAccessFacility = await serviceRoleUserHasFacilityAccess(admin, {
      userId: actor.id,
      facilityId,
      organizationId: actor.organizationId,
    });
    if (!canAccessFacility) {
      return NextResponse.json({ error: "Facility not found" }, { status: 404 });
    }
  }

  const insertPayload = {
    organization_id: actor.organizationId,
    facility_id: facilityId,
    user_id: actor.id,
    user_email: actor.sessionEmail ?? actor.email,
    app_role: actor.appRole,
    shell_kind: shellKind,
    route: trimToMax(route, MAX_ROUTE_LENGTH),
    category,
    severity,
    title: trimToMax(title, MAX_TITLE_LENGTH),
    detail: trimToMax(detail, MAX_DETAIL_LENGTH),
    status: "new",
    metadata: {
      full_name: actor.fullName,
    },
  };

  const currentResult = await revalidateCurrentApiActor(actor, {
    allowedRoles: ALL_APP_ROLES,
    scope: "pilot-feedback.create-revalidate",
  });
  if ("response" in currentResult) return currentResult.response;
  const currentActor = currentResult.actor;
  if (facilityId) {
    const stillCanAccessFacility = await serviceRoleUserHasFacilityAccess(currentActor.admin, {
      userId: currentActor.id,
      facilityId,
      organizationId: currentActor.organizationId,
    });
    if (!stillCanAccessFacility) {
      return NextResponse.json({ error: "Facility not found" }, { status: 404 });
    }
  }

  const { data, error } = await currentActor.admin
    .from("pilot_feedback_submissions" as never)
    .insert({
      ...insertPayload,
      organization_id: currentActor.organizationId,
      user_id: currentActor.id,
      user_email: currentActor.sessionEmail ?? currentActor.email,
      app_role: currentActor.appRole,
      metadata: { full_name: currentActor.fullName },
    } as never)
    .select("id, created_at")
    .single();

  if (error) {
    logError("pilot-feedback", error, { action: "create" });
    return NextResponse.json({ error: "Could not save feedback" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, submission: data });
}

export async function GET(request: Request) {
  const actor = await requireActor(REVIEWER_ROLE_LIST);
  if ("error" in actor) return actor.error;

  const { admin } = actor;
  const organizationId = actor.organizationId;
  if (!REVIEWER_ROLES.has(actor.appRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "100"), 1), 250);
  const facilityId = url.searchParams.get("facilityId");
  const status = url.searchParams.get("status");

  let query = admin
    .from("pilot_feedback_submissions" as never)
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (facilityId) {
    const canAccessFacility = await serviceRoleUserHasFacilityAccess(admin, {
      userId: actor.id,
      facilityId,
      organizationId,
    });
    if (!canAccessFacility) {
      return NextResponse.json({ error: "Facility not found" }, { status: 404 });
    }
    query = query.eq("facility_id", facilityId);
  }
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    logError("pilot-feedback", error, { action: "list" });
    return NextResponse.json({ error: "Could not load feedback" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    feedback: (data ?? []).map((row) => ({
      ...asRecord(row),
      metadata: asRecord(asRecord(row).metadata),
    })),
  });
}

export async function PATCH(request: Request) {
  let body: FeedbackBody;
  try {
    body = (await request.json()) as FeedbackBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const actor = await requireActor(REVIEWER_ROLE_LIST);
  if ("error" in actor) return actor.error;

  const { admin } = actor;
  if (!REVIEWER_ROLES.has(actor.appRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = body.id?.trim();
  const nextStatus = body.status?.trim();
  if (!id || !nextStatus) {
    return NextResponse.json({ error: "id and status are required" }, { status: 400 });
  }

  const allowedStatuses = new Set(["new", "triaged", "planned", "done", "dismissed"]);
  if (!allowedStatuses.has(nextStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const { data: existing, error: existingError } = await admin
    .from("pilot_feedback_submissions" as never)
    .select("id, organization_id, facility_id, status, metadata")
    .eq("id", id)
    .eq("organization_id", actor.organizationId)
    .maybeSingle();

  if (existingError || !existing) {
    return NextResponse.json({ error: "Feedback item not found" }, { status: 404 });
  }

  const existingFacilityId = asRecord(existing).facility_id;
  const currentResult = await revalidateCurrentApiActor(actor, {
    allowedRoles: REVIEWER_ROLE_LIST,
    scope: "pilot-feedback.update-revalidate",
  });
  if ("response" in currentResult) return currentResult.response;
  const currentActor = currentResult.actor;
  if (currentActor.organizationId !== actor.organizationId) {
    return NextResponse.json({ error: "Feedback item not found" }, { status: 404 });
  }
  if (typeof existingFacilityId === "string") {
    const canAccessFacility = await serviceRoleUserHasFacilityAccess(currentActor.admin, {
      userId: currentActor.id,
      facilityId: existingFacilityId,
      organizationId: currentActor.organizationId,
    });
    if (!canAccessFacility) {
      return NextResponse.json({ error: "Feedback item not found" }, { status: 404 });
    }
  }

  const now = new Date().toISOString();
  const nextMetadata = {
    ...asRecord(asRecord(existing).metadata),
    status_history: [
      ...(Array.isArray(asRecord(asRecord(existing).metadata).status_history)
        ? (asRecord(asRecord(existing).metadata).status_history as unknown[])
        : []),
      {
        from: asRecord(existing).status ?? null,
        to: nextStatus,
        changed_at: now,
        changed_by: currentActor.id,
      },
    ],
  };

  let updateQuery = currentActor.admin
    .from("pilot_feedback_submissions" as never)
    .update({
      status: nextStatus,
      updated_at: now,
      triaged_at: nextStatus === "new" ? null : now,
      triaged_by: nextStatus === "new" ? null : currentActor.id,
      metadata: nextMetadata,
    } as never)
    .eq("id", id)
    .eq("organization_id", currentActor.organizationId);
  if (typeof existingFacilityId === "string") {
    updateQuery = updateQuery.eq("facility_id", existingFacilityId);
  }
  const { data, error } = await updateQuery
    .select("*")
    .single();

  if (error) {
    logError("pilot-feedback", error, { action: "update", id });
    return NextResponse.json({ error: "Could not update feedback" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    feedback: {
      ...asRecord(data),
      metadata: asRecord(asRecord(data).metadata),
    },
  });
}
