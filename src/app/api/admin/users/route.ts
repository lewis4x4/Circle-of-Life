/**
 * GET /api/admin/users — List users with filtering and pagination.
 * POST /api/admin/users — Create new user.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  actorHasOrgWideFacilityScope,
  listActorAccessibleFacilityIds,
  requireAdminApiActor,
} from "@/lib/admin/api-auth";
import { canManageUser } from "@/lib/rbac";
import type { Database } from "@/types/database";
import { listUsersQuerySchema, createUserSchema } from "@/lib/validation/user-management";
import { adminInviteUser, adminCreateUser } from "@/lib/supabase/admin-client";
import { writeUserAuditEntry } from "@/lib/audit/user-management-audit";

type UserProfileRow = Pick<
  Database["public"]["Tables"]["user_profiles"]["Row"],
  | "id"
  | "email"
  | "full_name"
  | "phone"
  | "app_role"
  | "job_title"
  | "avatar_url"
  | "is_active"
  | "last_login_at"
  | "manager_user_id"
  | "created_at"
  | "updated_at"
  | "deleted_at"
>;

type UserProfileInsert = Database["public"]["Tables"]["user_profiles"]["Insert"];

type UserFacilityAccessWithName = Pick<
  Database["public"]["Tables"]["user_facility_access"]["Row"],
  "user_id" | "facility_id" | "is_primary"
> & {
  facilities: { name: string | null } | null;
};

type UserWithFacilities = UserProfileRow & {
  facilities: Array<{ facility_id: string; facility_name: string; is_primary: boolean }>;
};

// ── GET: List Users ───────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await requireAdminApiActor({
    allowedRoles: ["owner", "org_admin", "facility_admin", "manager"],
  });
  if ("response" in auth) {
    return auth.response;
  }
  const { actor } = auth;
  const admin = actor.admin;

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

  const parsed = listUsersQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { page, page_size, search, role, facility_id, status, sort_by, sort_order } = parsed.data;
  const offset = (page - 1) * page_size;
  const actorFacilityIds = await listActorAccessibleFacilityIds(actor);
  const orgWideScope = actorHasOrgWideFacilityScope(actor);

  if (!orgWideScope && actorFacilityIds.length === 0) {
    return NextResponse.json({
      data: [],
      pagination: {
        total: 0,
        page,
        page_size,
        total_pages: 0,
        has_next: false,
      },
    });
  }

  if (!orgWideScope && facility_id.some((id) => !actorFacilityIds.includes(id))) {
    return NextResponse.json({ error: "One or more facilities are outside your scope" }, { status: 403 });
  }

  const scopedFacilityIds = facility_id.length > 0 ? facility_id : orgWideScope ? [] : actorFacilityIds;

  let query = admin
    .from("user_profiles")
    .select(
      "id, email, full_name, phone, app_role, job_title, avatar_url, is_active, last_login_at, manager_user_id, created_at, updated_at, deleted_at",
      { count: "exact" },
    )
    .eq("organization_id", actor.organization_id!);

  // Status filter
  if (status === "active") {
    query = query.eq("is_active", true).is("deleted_at", null);
  } else if (status === "inactive") {
    query = query.eq("is_active", false).is("deleted_at", null);
  } else {
    // "deleted" — show soft-deleted (owner/org_admin only)
    if (!["owner", "org_admin"].includes(actor.app_role)) {
      return NextResponse.json({ error: "Cannot view deleted users" }, { status: 403 });
    }
    query = query.not("deleted_at", "is", null);
  }

  if (search) {
    query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%,phone.ilike.%${search}%`);
  }
  if (role) {
    query = query.eq("app_role", role);
  }

  if (scopedFacilityIds.length > 0) {
    const { data: scopedAccessRows, error: scopedAccessError } = await admin
      .from("user_facility_access")
      .select("user_id")
      .in("facility_id", scopedFacilityIds)
      .is("revoked_at", null);

    if (scopedAccessError) {
      return NextResponse.json({ error: "Failed to resolve user scope" }, { status: 500 });
    }

    const scopedUserIds = Array.from(new Set((scopedAccessRows ?? []).map((row) => row.user_id)));
    if (scopedUserIds.length === 0) {
      return NextResponse.json({
        data: [],
        pagination: {
          total: 0,
          page,
          page_size,
          total_pages: 0,
          has_next: false,
        },
      });
    }

    query = query.in("id", scopedUserIds);
  }

  // Sort
  query = query.order(sort_by, { ascending: sort_order === "asc" });
  query = query.range(offset, offset + page_size - 1);

  const queryResult = await query;
  const users = (queryResult.data ?? []) as UserProfileRow[];
  const count = queryResult.count ?? 0;
  const queryErr = queryResult.error;
  if (queryErr) {
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }

  // Fetch facility access for each user
  const userIds = users.map((user) => user.id);
  const facilityMap: Record<string, Array<{ facility_id: string; facility_name: string; is_primary: boolean }>> = {};
  if (userIds.length > 0) {
    let accessQuery = admin
      .from("user_facility_access")
      .select("user_id, facility_id, is_primary, facilities(name)")
      .in("user_id", userIds)
      .is("revoked_at", null);

    if (scopedFacilityIds.length > 0) {
      accessQuery = accessQuery.in("facility_id", scopedFacilityIds);
    }

    const accessQueryResult = await accessQuery;
    const accessRows = (accessQueryResult.data ?? []) as UserFacilityAccessWithName[];

    for (const row of accessRows) {
      if (!facilityMap[row.user_id]) facilityMap[row.user_id] = [];
      facilityMap[row.user_id].push({
        facility_id: row.facility_id,
        facility_name: row.facilities?.name ?? "",
        is_primary: row.is_primary,
      });
    }
  }

  const data: UserWithFacilities[] = users.map((user) => ({
    ...user,
    facilities: facilityMap[user.id] ?? [],
  }));

  return NextResponse.json({
    data,
    pagination: {
      total: count,
      page,
      page_size,
      total_pages: Math.ceil(count / page_size),
      has_next: offset + page_size < count,
    },
  });
}

// ── POST: Create User ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await requireAdminApiActor({
    allowedRoles: ["owner", "org_admin", "facility_admin"],
  });
  if ("response" in auth) {
    return auth.response;
  }
  const { actor } = auth;

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const data = parsed.data;

  const admin = actor.admin;

  if (!canManageUser(actor.app_role, data.app_role)) {
    return NextResponse.json(
      { error: "Cannot assign a role at or above your own level" },
      { status: 403 },
    );
  }

  // Check email uniqueness
  const { data: existing } = await admin
    .from("user_profiles")
    .select("id")
    .eq("email", data.email)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }

  // Verify facilities belong to actor's org and are accessible
  const facilityIds = data.facilities.map((f) => f.facility_id);
  const actorFacilityIds = await listActorAccessibleFacilityIds(actor);
  if (
    !actorHasOrgWideFacilityScope(actor) &&
    facilityIds.some((facilityId) => !actorFacilityIds.includes(facilityId))
  ) {
    return NextResponse.json({ error: "Cannot assign facilities outside your scope" }, { status: 403 });
  }

  const { data: facilities } = await admin
    .from("facilities")
    .select("id")
    .eq("organization_id", actor.organization_id!)
    .in("id", facilityIds)
    .is("deleted_at", null);
  if ((facilities ?? []).length !== facilityIds.length) {
    return NextResponse.json({ error: "One or more facilities not found or inaccessible" }, { status: 400 });
  }

  // Create auth user
  let authUserId: string;
  let temporaryPassword: string | undefined;
  try {
    if (data.send_invite) {
      const result = await adminInviteUser(data.email, {
        app_role: data.app_role,
        organization_id: actor.organization_id!,
      });
      authUserId = result.id;
    } else {
      const result = await adminCreateUser(data.email, {
        app_role: data.app_role,
        organization_id: actor.organization_id!,
        email_confirm: true,
      });
      authUserId = result.user.id;
      temporaryPassword = result.temporary_password;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auth API failure";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const profileInsert: UserProfileInsert = {
    id: authUserId,
    organization_id: actor.organization_id!,
    email: data.email,
    full_name: data.full_name,
    phone: data.phone ?? null,
    app_role: data.app_role,
    job_title: data.job_title ?? null,
    avatar_url: data.avatar_url ?? null,
    manager_user_id: data.manager_user_id ?? null,
    is_active: true,
  };

  const { data: profile, error: insertErr } = await admin
    .from("user_profiles")
    .insert(profileInsert)
    .select()
    .single();
  if (insertErr) {
    return NextResponse.json({ error: "Failed to create profile" }, { status: 500 });
  }

  // Create facility access entries
  const accessRows = data.facilities.map((f) => ({
    user_id: authUserId,
    facility_id: f.facility_id,
    organization_id: actor.organization_id!,
    is_primary: f.is_primary,
    granted_by: actor.id,
  }));
  const { error: accessErr } = await admin.from("user_facility_access").insert(accessRows);
  if (accessErr) {
    return NextResponse.json({ error: "Failed to assign facility access" }, { status: 500 });
  }

  // Audit
  await writeUserAuditEntry({
    organizationId: actor.organization_id!,
    actingUserId: actor.id,
    targetUserId: authUserId,
    action: "create",
    changes: {
      before: {},
      after: { email: data.email, full_name: data.full_name, app_role: data.app_role, facilities: facilityIds },
    },
  });

  return NextResponse.json(
    {
      data: profile,
      invitation_sent: data.send_invite,
      ...(temporaryPassword && { temporary_password: temporaryPassword }),
    },
    { status: 201 },
  );
}
