import type { SupabaseClient } from "@supabase/supabase-js";

import { requireFacilityAccess, type AdminApiActor } from "@/lib/admin/api-auth";
import {
  commitExpansiveUserAccess,
  commitRestrictiveUserAccess,
} from "@/lib/admin/user-access-lifecycle";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { logError } from "@/lib/observability/logger";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import {
  accessControlSyncOnOffboard,
  accessControlSyncOnReactivate,
  buildStaffOffboardPatch,
  buildStaffReactivatePatch,
  decideOffboardHavenAccess,
  decideReactivateHavenAccess,
  isInactiveEmploymentStatus,
  parseStaffOffboardRequest,
  parseStaffReactivateRequest,
  type AccessControlSyncFlag,
  type LinkedUserSnapshot,
} from "./staff-offboard";
import { staffProfileSelectSql, type StaffProfileRow } from "./staff-profile-edit";

type AdminClient = SupabaseClient<Database>;

type StaffCommandRow = {
  id: string;
  organization_id: string;
  facility_id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  employment_status: string;
  termination_date: string | null;
  termination_reason: string | null;
};

export type StaffOffboardCommandResult =
  | {
      ok: true;
      status: 200 | 202;
      staff: StaffProfileRow;
      haven_access: "revoked" | "already_revoked" | "not_linked" | "pending_sync";
      access_control_sync: AccessControlSyncFlag;
      already_offboarded: boolean;
    }
  | { ok: false; status: number; error: string };

export type StaffReactivateCommandResult =
  | {
      ok: true;
      status: 200 | 202;
      staff: StaffProfileRow;
      haven_access: "restored" | "already_active" | "not_linked" | "needs_org_admin" | "pending_sync";
      access_control_sync: AccessControlSyncFlag;
    }
  | { ok: false; status: number; error: string };

const STAFF_COMMAND_SELECT =
  "id, organization_id, facility_id, user_id, first_name, last_name, employment_status, termination_date, termination_reason";

async function loadStaffForCommand(
  admin: AdminClient,
  staffId: string,
  organizationId: string,
): Promise<StaffCommandRow | null> {
  const { data, error } = await admin
    .from("staff")
    .select(STAFF_COMMAND_SELECT)
    .eq("id", staffId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as StaffCommandRow;
}

async function loadLinkedUser(
  admin: AdminClient,
  userId: string | null,
  organizationId: string,
): Promise<LinkedUserSnapshot | null> {
  if (!userId) return null;
  const { data, error } = await admin
    .from("user_profiles")
    .select("id, app_role, is_active, deleted_at")
    .eq("id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as LinkedUserSnapshot;
}

async function reloadStaffProfile(
  admin: AdminClient,
  staffId: string,
  organizationId: string,
): Promise<StaffProfileRow | null> {
  const { data, error } = await admin
    .from("staff")
    .select(staffProfileSelectSql())
    .eq("id", staffId)
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as StaffProfileRow;
}

async function writeStaffLifecycleAudit(
  admin: AdminClient,
  input: {
    actorId: string;
    staff: StaffCommandRow;
    action: "staff_offboard" | "staff_reactivate";
    havenAccess: string;
    accessControlSync: AccessControlSyncFlag;
    reason: string | null;
  },
): Promise<void> {
  const { error } = await admin.from("audit_log").insert({
    table_name: "staff",
    record_id: input.staff.id,
    action: "UPDATE",
    old_data: {
      employment_status: input.staff.employment_status,
      user_id: input.staff.user_id,
    },
    new_data: {
      event: input.action,
      haven_access: input.havenAccess,
      access_control_sync: input.accessControlSync,
      access_control_vendor: "cdvi_atrium",
      reason: input.reason,
    },
    user_id: input.actorId,
    organization_id: input.staff.organization_id,
    facility_id: input.staff.facility_id,
  });
  if (error) {
    logError("admin.staff.offboard", error, { action: "audit_log_insert", staffId: input.staff.id });
  }
}

export async function executeStaffOffboard(
  actor: AdminApiActor,
  staffId: string,
  body: unknown,
  requestKey: string | null,
): Promise<StaffOffboardCommandResult> {
  if (!UUID_STRING_RE.test(staffId)) {
    return { ok: false, status: 400, error: "Invalid staff id." };
  }

  const parsed = parseStaffOffboardRequest(body);
  if (!parsed.ok) return { ok: false, status: 422, error: parsed.error };

  const staff = await loadStaffForCommand(actor.admin, staffId, actor.organization_id);
  if (!staff) return { ok: false, status: 404, error: "Staff member not found." };

  const facility = await requireFacilityAccess(actor, staff.facility_id);
  if ("response" in facility) {
    return { ok: false, status: 404, error: "Staff member not found." };
  }

  const linkedUser = await loadLinkedUser(actor.admin, staff.user_id, actor.organization_id);
  const haven = decideOffboardHavenAccess({
    actorId: actor.id,
    actorRole: actor.app_role,
    staffUserId: staff.user_id,
    linkedUser,
  });

  if (haven.kind === "self") {
    return { ok: false, status: 422, error: "Cannot offboard your own staff record." };
  }
  if (haven.kind === "cannot_manage") {
    return {
      ok: false,
      status: 403,
      error: "Cannot revoke Haven access for this account. Employment was not changed.",
    };
  }

  let havenLabel: "revoked" | "already_revoked" | "not_linked" | "pending_sync" =
    haven.kind === "not_linked"
      ? "not_linked"
      : haven.kind === "already_revoked"
        ? "already_revoked"
        : "revoked";
  let syncPending = false;

  if (haven.kind === "disable") {
    try {
      const accessResult = await commitRestrictiveUserAccess(actor.admin, {
        targetUserId: haven.userId,
        actingUserId: actor.id,
        organizationId: actor.organization_id,
        operation: "disable",
        reason: parsed.reason ?? "Staff offboard",
        requestKey,
      });
      if (accessResult.sync_status !== "synchronized") {
        syncPending = true;
        havenLabel = "pending_sync";
      }
    } catch (error) {
      logError("admin.staff.offboard", error, { action: "haven_disable", staffId });
      return {
        ok: false,
        status: 409,
        error: "Haven access could not be revoked. Employment was not changed. Refresh and retry.",
      };
    }
  }

  const alreadyOffboarded = isInactiveEmploymentStatus(staff.employment_status);
  if (!alreadyOffboarded) {
    const patch = buildStaffOffboardPatch({
      updatedBy: actor.id,
      terminationDate: parsed.terminationDate ?? staff.termination_date ?? todayFacilityDateIso(),
      reason: parsed.reason ?? staff.termination_reason,
    });
    const { error: updateError } = await actor.admin
      .from("staff")
      .update(patch as never)
      .eq("id", staff.id)
      .eq("organization_id", actor.organization_id)
      .is("deleted_at", null);
    if (updateError) {
      logError("admin.staff.offboard", updateError, { action: "staff_update", staffId });
      return {
        ok: false,
        status: 409,
        error:
          havenLabel === "not_linked"
            ? "Employment could not be updated. Refresh and retry."
            : "Haven access was revoked; employment update failed. Retry Offboard to finish the staff record.",
      };
    }
  }

  const accessControlSync = accessControlSyncOnOffboard();
  await writeStaffLifecycleAudit(actor.admin, {
    actorId: actor.id,
    staff,
    action: "staff_offboard",
    havenAccess: havenLabel,
    accessControlSync,
    reason: parsed.reason,
  });

  const updated = await reloadStaffProfile(actor.admin, staff.id, actor.organization_id);
  if (!updated) {
    return { ok: false, status: 409, error: "Staff record could not be reloaded after offboard." };
  }

  return {
    ok: true,
    status: syncPending ? 202 : 200,
    staff: updated,
    haven_access: havenLabel,
    access_control_sync: accessControlSync,
    already_offboarded: alreadyOffboarded,
  };
}

export async function executeStaffReactivate(
  actor: AdminApiActor,
  staffId: string,
  body: unknown,
  requestKey: string | null,
): Promise<StaffReactivateCommandResult> {
  if (!UUID_STRING_RE.test(staffId)) {
    return { ok: false, status: 400, error: "Invalid staff id." };
  }

  const parsed = parseStaffReactivateRequest(body);
  if (!parsed.ok) return { ok: false, status: 422, error: parsed.error };

  const staff = await loadStaffForCommand(actor.admin, staffId, actor.organization_id);
  if (!staff) return { ok: false, status: 404, error: "Staff member not found." };

  const facility = await requireFacilityAccess(actor, staff.facility_id);
  if ("response" in facility) {
    return { ok: false, status: 404, error: "Staff member not found." };
  }

  if (!isInactiveEmploymentStatus(staff.employment_status)) {
    return { ok: false, status: 422, error: "This staff member is already on the active roster." };
  }

  const { error: updateError } = await actor.admin
    .from("staff")
    .update(buildStaffReactivatePatch(actor.id) as never)
    .eq("id", staff.id)
    .eq("organization_id", actor.organization_id)
    .is("deleted_at", null);
  if (updateError) {
    logError("admin.staff.reactivate", updateError, { action: "staff_update", staffId });
    return { ok: false, status: 409, error: "Employment could not be restored. Refresh and retry." };
  }

  const linkedUser = await loadLinkedUser(actor.admin, staff.user_id, actor.organization_id);
  const haven = decideReactivateHavenAccess({
    actorRole: actor.app_role,
    staffUserId: staff.user_id,
    linkedUser,
  });

  let havenLabel: "restored" | "already_active" | "not_linked" | "needs_org_admin" | "pending_sync" =
    haven.kind === "not_linked"
      ? "not_linked"
      : haven.kind === "already_active"
        ? "already_active"
        : haven.kind === "needs_org_admin"
          ? "needs_org_admin"
          : "restored";
  let syncPending = false;

  if (haven.kind === "reactivate") {
    try {
      const accessResult = await commitExpansiveUserAccess(actor.admin, {
        targetUserId: haven.userId,
        actingUserId: actor.id,
        organizationId: actor.organization_id,
        operation: "reactivate",
        requestKey,
        facilityIds: [staff.facility_id],
        primaryFacilityId: staff.facility_id,
        reason: parsed.reason ?? "Staff employment restored",
      });
      if (accessResult.sync_status !== "synchronized") {
        syncPending = true;
        havenLabel = "pending_sync";
      }
    } catch (error) {
      logError("admin.staff.reactivate", error, { action: "haven_reactivate", staffId });
      return {
        ok: false,
        status: 409,
        error:
          "Employment was restored, but Haven sign-in could not be restored. Retry Restore employment or use User management.",
      };
    }
  }

  const accessControlSync = accessControlSyncOnReactivate();
  await writeStaffLifecycleAudit(actor.admin, {
    actorId: actor.id,
    staff,
    action: "staff_reactivate",
    havenAccess: havenLabel,
    accessControlSync,
    reason: parsed.reason,
  });

  const updated = await reloadStaffProfile(actor.admin, staff.id, actor.organization_id);
  if (!updated) {
    return { ok: false, status: 409, error: "Staff record could not be reloaded after restore." };
  }

  return {
    ok: true,
    status: syncPending ? 202 : 200,
    staff: updated,
    haven_access: havenLabel,
    access_control_sync: accessControlSync,
  };
}
