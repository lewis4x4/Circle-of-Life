import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

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

const REVIEWER_ROLES = new Set(["owner", "org_admin", "facility_admin", "manager"]);
const CATEGORIES = new Set(["bug", "confusion", "request", "friction", "praise"]);
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

async function requireActor() {
  const sessionClient = await createClient();
  const {
    data: { user },
    error: sessionError,
  } = await sessionClient.auth.getUser();

  if (sessionError || !user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }

  const admin = createServiceRoleClient();
  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("organization_id, app_role, email, full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile?.organization_id || !profile.app_role) {
    return { error: NextResponse.json({ error: "Profile not found" }, { status: 403 }) };
  }

  return { admin, user, profile };
}

export async function POST(request: Request) {
  let body: FeedbackBody;
  try {
    body = (await request.json()) as FeedbackBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const actor = await requireActor();
  if ("error" in actor) return actor.error;

  const category = body.category?.trim() ?? "";
  const severity = body.severity?.trim() ?? "medium";
  const title = body.title?.trim() ?? "";
  const detail = body.detail?.trim() ?? "";
  const route = body.route?.trim() ?? "/";
  const shellKind = body.shellKind?.trim() ?? "unknown";
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

  const { admin, user, profile } = actor;
  const insertPayload = {
    organization_id: profile.organization_id,
    facility_id: facilityId,
    user_id: user.id,
    user_email: user.email ?? profile.email ?? null,
    app_role: profile.app_role,
    shell_kind: shellKind,
    route,
    category,
    severity,
    title,
    detail,
    status: "new",
    metadata: {
      full_name: profile.full_name ?? null,
    },
  };

  const { data, error } = await admin
    .from("pilot_feedback_submissions" as never)
    .insert(insertPayload as never)
    .select("id, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, submission: data });
}

export async function GET(request: Request) {
  const actor = await requireActor();
  if ("error" in actor) return actor.error;

  const { admin, profile } = actor;
  const organizationId = String(profile.organization_id);
  if (!REVIEWER_ROLES.has(profile.app_role)) {
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

  if (facilityId) query = query.eq("facility_id", facilityId);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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

  const actor = await requireActor();
  if ("error" in actor) return actor.error;

  const { admin, user, profile } = actor;
  if (!REVIEWER_ROLES.has(profile.app_role)) {
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
    .select("id, organization_id, status, metadata")
    .eq("id", id)
    .maybeSingle();

  if (existingError || !existing) {
    return NextResponse.json({ error: "Feedback item not found" }, { status: 404 });
  }

  if (String(asRecord(existing).organization_id) !== String(profile.organization_id)) {
    return NextResponse.json({ error: "Organization mismatch" }, { status: 403 });
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
        changed_by: user.id,
      },
    ],
  };

  const { data, error } = await admin
    .from("pilot_feedback_submissions" as never)
    .update({
      status: nextStatus,
      updated_at: now,
      triaged_at: nextStatus === "new" ? null : now,
      triaged_by: nextStatus === "new" ? null : user.id,
      metadata: nextMetadata,
    } as never)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    feedback: {
      ...asRecord(data),
      metadata: asRecord(asRecord(data).metadata),
    },
  });
}
