/**
 * DELETE /api/admin/users/[id]/hard-delete — Permanently delete history-free users.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiActor } from "@/lib/admin/api-auth";
import { asUntypedAdmin, type UntypedAdminClient } from "@/lib/admin/facilities/untyped-admin";
import { writeUserAuditEntry } from "@/lib/audit/user-management-audit";
import { logError } from "@/lib/observability/logger";
import { canActorHardDeleteTarget } from "@/lib/rbac";
import { adminHardDeleteUser } from "@/lib/supabase/admin-client";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { hardDeleteUserSchema } from "@/lib/validation/user-management";

interface RouteContext {
  params: Promise<{ id: string }>;
}

type TargetProfile = {
  id: string;
  organization_id: string | null;
  email: string;
  full_name: string;
  app_role: string;
  deleted_at: string | null;
};

type ProtectedReference = {
  table: string;
  column: string;
};

type ProtectedReferenceCheck = ProtectedReference & {
  organizationScoped?: boolean;
};

/**
 * Static protected-history sweep for permanent user deletion.
 *
 * This curated list intentionally covers clinical, financial, audit-actor, admin,
 * and later operational user/profile FK columns that should keep the person record
 * auditable. Account-only membership rows (user_facility_access.user_id,
 * family_resident_links.user_id, push subscriptions) are cleaned up separately when
 * no protected history exists; actor columns on those rows remain protected.
 */
const PROTECTED_USER_REFERENCE_CHECKS: ProtectedReferenceCheck[] = [
  { table: "user_management_audit_log", column: "acting_user_id" },
  { table: "user_management_audit_log", column: "target_user_id" },
  { table: "audit_log", column: "user_id" },
  { table: "staff", column: "id" },
  { table: "staff", column: "user_id" },
  { table: "staff", column: "created_by" },
  { table: "staff", column: "updated_by" },
  { table: "user_facility_access", column: "granted_by" },
  { table: "user_facility_access", column: "revoked_by" },
  { table: "family_resident_links", column: "granted_by" },
  { table: "family_resident_links", column: "revoked_by" },

  // Clinical and resident-care history.
  { table: "residents", column: "created_by" },
  { table: "residents", column: "updated_by" },
  { table: "residents", column: "code_status_verified_by" },
  { table: "residents", column: "allergy_list_reviewed_by" },
  { table: "residents", column: "primary_diagnosis_reviewed_by" },
  { table: "care_plans", column: "reviewed_by" },
  { table: "care_plans", column: "approved_by" },
  { table: "care_plans", column: "created_by" },
  { table: "care_plans", column: "updated_by" },
  { table: "care_plan_items", column: "created_by" },
  { table: "care_plan_items", column: "updated_by" },
  { table: "care_plan_tasks", column: "completed_by" },
  { table: "care_plan_tasks", column: "updated_by" },
  { table: "incidents", column: "reported_by" },
  { table: "incidents", column: "nurse_notified_by" },
  { table: "incidents", column: "family_notified_by" },
  { table: "incidents", column: "resolved_by" },
  { table: "incidents", column: "created_by" },
  { table: "incidents", column: "updated_by" },
  { table: "incident_followups", column: "assigned_to" },
  { table: "incident_followups", column: "completed_by" },
  { table: "incident_photos", column: "taken_by" },
  { table: "assessments", column: "assessed_by" },
  { table: "assessments", column: "created_by" },
  { table: "assessments", column: "updated_by" },
  { table: "resident_photos", column: "taken_by" },
  { table: "resident_documents", column: "uploaded_by" },
  { table: "daily_logs", column: "logged_by" },
  { table: "daily_logs", column: "created_by" },
  { table: "daily_logs", column: "updated_by" },
  { table: "adl_logs", column: "logged_by" },
  { table: "behavioral_logs", column: "logged_by" },
  { table: "condition_changes", column: "reported_by" },
  { table: "condition_changes", column: "nurse_notified_by" },
  { table: "shift_handoffs", column: "outgoing_staff_id" },
  { table: "shift_handoffs", column: "incoming_staff_id" },
  { table: "activity_attendance", column: "logged_by" },

  // Medication/eMAR history.
  { table: "resident_medications", column: "discontinued_by" },
  { table: "resident_medications", column: "created_by" },
  { table: "resident_medications", column: "updated_by" },
  { table: "emar_records", column: "administered_by" },
  { table: "emar_records", column: "created_by" },
  { table: "emar_records", column: "updated_by" },
  { table: "verbal_orders", column: "received_by" },
  { table: "verbal_orders", column: "cosigned_by" },
  { table: "verbal_orders", column: "implemented_by" },
  { table: "verbal_orders", column: "created_by" },
  { table: "verbal_orders", column: "updated_by" },
  { table: "medication_errors", column: "discovered_by" },
  { table: "medication_errors", column: "reviewed_by" },
  { table: "medication_errors", column: "created_by" },
  { table: "medication_errors", column: "updated_by" },
  { table: "controlled_substance_counts", column: "outgoing_staff_id" },
  { table: "controlled_substance_counts", column: "incoming_staff_id" },
  { table: "controlled_substance_counts", column: "resolved_by" },
  { table: "med_tech_shifts", column: "user_id" },
  { table: "med_tech_shifts", column: "created_by" },
  { table: "med_tech_shifts", column: "updated_by" },
  { table: "med_passes", column: "administered_by" },
  { table: "med_passes", column: "witnessed_by" },
  { table: "med_passes", column: "created_by" },
  { table: "med_passes", column: "updated_by" },
  { table: "witness_signatures", column: "witness_user_id" },
  { table: "prn_events", column: "nurse_notified_user_id" },
  { table: "prn_events", column: "created_by" },
  { table: "prn_events", column: "updated_by" },

  // Financial/admin/business history.
  { table: "invoices", column: "voided_by" },
  { table: "invoices", column: "created_by" },
  { table: "invoices", column: "updated_by" },
  { table: "payments", column: "deposited_by" },
  { table: "payments", column: "created_by" },
  { table: "payments", column: "updated_by" },
  { table: "collection_activities", column: "performed_by" },
  { table: "journal_entries", column: "posted_by" },
  { table: "journal_entries", column: "created_by" },
  { table: "journal_entries", column: "updated_by" },
  { table: "audit_log_export_jobs", column: "requested_by" },
  { table: "survey_visit_sessions", column: "activated_by" },
  { table: "survey_visit_sessions", column: "deactivated_by" },
  { table: "survey_visit_log_entries", column: "accessed_by" },
  { table: "facilities", column: "current_administrator_id" },
  { table: "facility_audit_log", column: "changed_by" },
  { table: "operation_audit_log", column: "actor_id" },
  { table: "alert_audit_log", column: "actor_id" },

  // Haven Insight / AI history.
  { table: "exec_nlq_sessions", column: "user_id" },
  { table: "exec_nlq_sessions", column: "created_by" },
  { table: "exec_nlq_sessions", column: "updated_by" },
  { table: "ai_invocations", column: "created_by" },
  { table: "exec_alerts", column: "acknowledged_by" },
  { table: "exec_alerts", column: "resolved_by" },

  // Later user_profiles(id)-backed operational history.
  { table: "resident_status_history", column: "created_by" },
  { table: "resident_status_history", column: "updated_by" },
  { table: "facility_medicaid_providers", column: "created_by" },
  { table: "facility_medicaid_providers", column: "updated_by" },
  { table: "maintenance_tickets", column: "submitted_by" },
  { table: "maintenance_tickets", column: "assigned_to_user_id" },
  { table: "maintenance_tickets", column: "created_by" },
  { table: "maintenance_tickets", column: "updated_by" },
  { table: "maintenance_task_completions", column: "completed_by_user_id" },
  { table: "maintenance_task_completions", column: "created_by" },
  { table: "maintenance_task_completions", column: "updated_by" },
  { table: "meal_logs", column: "recorded_by" },
  { table: "meal_logs", column: "updated_by" },
  { table: "snack_logs", column: "passed_by_user_id" },
  { table: "snack_logs", column: "created_by" },
  { table: "snack_logs", column: "updated_by" },
  { table: "staff_attestations", column: "signed_by_user_id" },
  { table: "staff_attestations", column: "created_by" },
  { table: "staff_attestations", column: "updated_by" },
  { table: "activity_sessions", column: "confirmed_by_user_id" },
];

const ACCOUNT_ONLY_REFERENCE_TABLES: Array<{ table: string; column: string }> = [
  { table: "user_facility_access", column: "user_id" },
  { table: "family_resident_links", column: "user_id" },
  { table: "notification_subscriptions", column: "user_id" },
];

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

async function findProtectedReferences(
  admin: UntypedAdminClient,
  organizationId: string,
  targetUserId: string,
): Promise<ProtectedReference[]> {
  const references: ProtectedReference[] = [];

  for (const check of PROTECTED_USER_REFERENCE_CHECKS) {
    let query = admin.from(check.table).select("id").eq(check.column, targetUserId).limit(1);
    if (check.organizationScoped !== false) {
      query = query.eq("organization_id", organizationId);
    }

    const { data, error } = await query;
    if (error) {
      logError("admin.users.hard_delete", error, {
        action: "history_check",
        table: check.table,
        column: check.column,
        targetUserId,
      });
      throw new Error("Failed to check protected user history");
    }

    if ((data ?? []).length > 0) {
      references.push({ table: check.table, column: check.column });
    }
  }

  return references;
}

async function deleteAccountOnlyReferences(
  admin: UntypedAdminClient,
  organizationId: string,
  targetUserId: string,
): Promise<void> {
  for (const ref of ACCOUNT_ONLY_REFERENCE_TABLES) {
    const { error } = await admin
      .from(ref.table)
      .delete()
      .eq(ref.column, targetUserId)
      .eq("organization_id", organizationId);
    if (error) {
      throw new Error(`Failed to delete ${ref.table}.${ref.column}`);
    }
  }
}

export async function DELETE(request: NextRequest, ctx: RouteContext) {
  const auth = await requireAdminApiActor({ allowedRoles: ["owner"] });
  if ("response" in auth) {
    if (auth.response.status === 403) {
      return json(403, { ok: false, reason: "actor_not_owner" });
    }
    return auth.response;
  }
  const { actor } = auth;
  const admin = actor.admin;
  const untypedAdmin = asUntypedAdmin(admin);

  const { id: targetUserId } = await ctx.params;
  if (!UUID_STRING_RE.test(targetUserId)) {
    return json(400, { ok: false, reason: "invalid_user_id" });
  }
  if (actor.id === targetUserId) {
    return json(403, { ok: false, reason: "self_delete_not_allowed" });
  }

  const { data: target, error: targetErr } = await admin
    .from("user_profiles")
    .select("id, organization_id, email, full_name, app_role, deleted_at")
    .eq("id", targetUserId)
    .eq("organization_id", actor.organization_id)
    .maybeSingle();

  const targetProfile = target as TargetProfile | null;
  if (targetErr || !targetProfile) {
    return json(404, { ok: false, reason: "not_found" });
  }
  if (targetProfile.organization_id !== actor.organization_id) {
    return json(404, { ok: false, reason: "not_found" });
  }

  if (!canActorHardDeleteTarget(actor.app_role, targetProfile.app_role)) {
    return json(403, { ok: false, reason: "target_role_protected" });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { ok: false, reason: "confirm_email_mismatch" });
  }

  const parsed = hardDeleteUserSchema.safeParse(body);
  if (!parsed.success) {
    return json(400, { ok: false, reason: "confirm_email_mismatch" });
  }

  if (normalizeEmail(parsed.data.confirm_email) !== normalizeEmail(targetProfile.email)) {
    return json(400, { ok: false, reason: "confirm_email_mismatch" });
  }

  let references: ProtectedReference[];
  try {
    references = await findProtectedReferences(untypedAdmin, actor.organization_id, targetUserId);
  } catch (err) {
    logError("admin.users.hard_delete", err, { action: "history_sweep", targetUserId });
    return json(500, { ok: false, reason: "history_check_failed" });
  }

  if (references.length > 0) {
    return json(409, { ok: false, reason: "has_history", references });
  }

  try {
    await writeUserAuditEntry({
      organizationId: actor.organization_id,
      actingUserId: actor.id,
      targetUserId,
      action: "hard_delete",
      changes: {
        before: {
          id: targetUserId,
          email: targetProfile.email,
          full_name: targetProfile.full_name,
          app_role: targetProfile.app_role,
          deleted_at: targetProfile.deleted_at,
        },
        after: { hard_delete_requested: true },
        meta: {
          target_email: targetProfile.email,
          target_role: targetProfile.app_role,
          references_checked: PROTECTED_USER_REFERENCE_CHECKS.length,
          audit_stage: "pre_delete",
        },
      },
      strict: true,
    });
  } catch (err) {
    logError("admin.users.hard_delete", err, { action: "write_audit", targetUserId });
    return json(500, { ok: false, reason: "audit_failed" });
  }

  try {
    await deleteAccountOnlyReferences(untypedAdmin, actor.organization_id, targetUserId);
    await adminHardDeleteUser(targetUserId);

    const { error: profileDeleteErr } = await admin
      .from("user_profiles")
      .delete()
      .eq("id", targetUserId)
      .eq("organization_id", actor.organization_id);
    if (profileDeleteErr) {
      throw new Error(profileDeleteErr.message);
    }
  } catch (err) {
    logError("admin.users.hard_delete", err, { action: "delete_user", targetUserId });
    return json(500, { ok: false, reason: "delete_failed" });
  }

  return NextResponse.json({ ok: true, deleted_user_id: targetUserId });
}
