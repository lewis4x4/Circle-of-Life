/**
 * Staff offboard / restore — employment end without hard-delete.
 * Haven login revoke is a separate lifecycle command when a user is linked.
 */

import { canActorManageTarget, canManageUser } from "@/lib/rbac";

export const INACTIVE_EMPLOYMENT_STATUSES = ["terminated", "suspended"] as const;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type InactiveEmploymentStatus = (typeof INACTIVE_EMPLOYMENT_STATUSES)[number];

export function isInactiveEmploymentStatus(status: string): status is InactiveEmploymentStatus {
  return status === "terminated" || status === "suspended";
}

export function canOffboardStaff(appRole: string): boolean {
  return appRole === "owner" || appRole === "org_admin" || appRole === "facility_admin";
}

export function canRestoreHavenLogin(appRole: string): boolean {
  return appRole === "owner" || appRole === "org_admin";
}

export type StaffOffboardParseResult =
  | { ok: true; reason: string | null; terminationDate: string | null }
  | { ok: false; error: string };

export type StaffReactivateParseResult =
  | { ok: true; reason: string | null }
  | { ok: false; error: string };

function parseOptionalReason(value: unknown): { ok: true; reason: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, reason: null };
  if (typeof value !== "string") return { ok: false, error: "Reason must be text." };
  const trimmed = value.trim();
  if (trimmed.length > 500) return { ok: false, error: "Reason must be 500 characters or fewer." };
  return { ok: true, reason: trimmed || null };
}

export function parseStaffOffboardRequest(body: unknown): StaffOffboardParseResult {
  if (body == null) {
    return { ok: true, reason: null, terminationDate: null };
  }
  if (typeof body !== "object") {
    return { ok: false, error: "Invalid request." };
  }

  const record = body as Record<string, unknown>;
  const reasonParsed = parseOptionalReason(record.reason);
  if (!reasonParsed.ok) return reasonParsed;

  let terminationDate: string | null = null;
  if (record.termination_date !== undefined && record.termination_date !== null && record.termination_date !== "") {
    if (typeof record.termination_date !== "string" || !DATE_ONLY_RE.test(record.termination_date)) {
      return { ok: false, error: "Termination date must be YYYY-MM-DD." };
    }
    terminationDate = record.termination_date;
  }

  return { ok: true, reason: reasonParsed.reason, terminationDate };
}

export function parseStaffReactivateRequest(body: unknown): StaffReactivateParseResult {
  if (body == null) return { ok: true, reason: null };
  if (typeof body !== "object") return { ok: false, error: "Invalid request." };
  return parseOptionalReason((body as Record<string, unknown>).reason);
}

export function buildStaffOffboardPatch(input: {
  updatedBy: string;
  terminationDate: string;
  reason: string | null;
}): Record<string, unknown> {
  return {
    employment_status: "terminated",
    termination_date: input.terminationDate,
    termination_reason: input.reason,
    updated_by: input.updatedBy,
  };
}

export function buildStaffReactivatePatch(updatedBy: string): Record<string, unknown> {
  return {
    employment_status: "active",
    termination_date: null,
    termination_reason: null,
    updated_by: updatedBy,
  };
}

/** Block casual employment-section edits from substituting for Offboard / Restore. */
export function employmentStatusCommandError(current: string, next: string): string | null {
  const fromInactive = isInactiveEmploymentStatus(current);
  const toInactive = isInactiveEmploymentStatus(next);
  if (!fromInactive && toInactive) {
    return "Use Offboard to end employment and revoke Haven access.";
  }
  if (fromInactive && !toInactive) {
    return "Use Restore employment to return this person to the roster.";
  }
  return null;
}

export type LinkedUserSnapshot = {
  id: string;
  app_role: string;
  is_active: boolean;
  deleted_at: string | null;
};

export type OffboardHavenDecision =
  | { kind: "not_linked" }
  | { kind: "self" }
  | { kind: "cannot_manage"; appRole: string }
  | { kind: "already_revoked"; userId: string }
  | { kind: "disable"; userId: string };

export function decideOffboardHavenAccess(input: {
  actorId: string;
  actorRole: string;
  staffUserId: string | null;
  linkedUser: LinkedUserSnapshot | null;
}): OffboardHavenDecision {
  if (!input.staffUserId || !input.linkedUser) return { kind: "not_linked" };
  if (input.staffUserId === input.actorId) return { kind: "self" };
  if (!canManageUser(input.actorRole, input.linkedUser.app_role)) {
    return { kind: "cannot_manage", appRole: input.linkedUser.app_role };
  }
  if (!input.linkedUser.is_active || input.linkedUser.deleted_at) {
    return { kind: "already_revoked", userId: input.linkedUser.id };
  }
  return { kind: "disable", userId: input.linkedUser.id };
}

export type ReactivateHavenDecision =
  | { kind: "not_linked" }
  | { kind: "already_active"; userId: string }
  | { kind: "needs_org_admin"; userId: string }
  | { kind: "reactivate"; userId: string };

export function decideReactivateHavenAccess(input: {
  actorRole: string;
  staffUserId: string | null;
  linkedUser: LinkedUserSnapshot | null;
}): ReactivateHavenDecision {
  if (!input.staffUserId || !input.linkedUser) return { kind: "not_linked" };
  if (input.linkedUser.is_active && !input.linkedUser.deleted_at) {
    return { kind: "already_active", userId: input.linkedUser.id };
  }
  if (
    !canRestoreHavenLogin(input.actorRole) ||
    !canActorManageTarget(input.actorRole, input.linkedUser.app_role)
  ) {
    return { kind: "needs_org_admin", userId: input.linkedUser.id };
  }
  return { kind: "reactivate", userId: input.linkedUser.id };
}

export type AccessControlSyncFlag = "queued" | "cleared";

export function accessControlSyncOnOffboard(): AccessControlSyncFlag {
  return "queued";
}

export function accessControlSyncOnReactivate(): AccessControlSyncFlag {
  return "cleared";
}
