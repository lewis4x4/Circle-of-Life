/**
 * RBAC utility library — centralized role hierarchy, permission checks, and display mappings.
 * Mirrors the `role_permissions` seed data in migration 122 and the `haven.role_tier()` SQL helper.
 * Pure TypeScript — no Supabase imports. Safe for Edge and client bundles.
 */

// ── Role hierarchy ────────────────────────────────────────────────
// Higher number = more privilege. Must match migration 123 haven.role_tier().

export const ROLE_HIERARCHY: Record<string, number> = {
  owner: 100,
  org_admin: 90,
  facility_admin: 80,
  manager: 70,
  coordinator: 60,
  admin_assistant: 50,
  nurse: 50,
  dietary: 40,
  maintenance_role: 40,
  broker: 30,
  housekeeper: 30,
  caregiver: 20,
  family: 10,
};

// ── Ordered role list ─────────────────────────────────────────────

export const ALL_APP_ROLES = [
  "owner",
  "org_admin",
  "facility_admin",
  "manager",
  "admin_assistant",
  "coordinator",
  "nurse",
  "caregiver",
  "dietary",
  "housekeeper",
  "maintenance_role",
  "family",
  "broker",
] as const;

export type AppRole = (typeof ALL_APP_ROLES)[number];

// ── Admin-shell eligible roles ────────────────────────────────────
// All roles that may access the admin shell. Excludes caregiver, family, housekeeper.

export const ADMIN_ELIGIBLE_ROLES = new Set<string>([
  "owner",
  "org_admin",
  "facility_admin",
  "manager",
  "admin_assistant",
  "coordinator",
  "nurse",
  "dietary",
  "maintenance_role",
  "broker",
]);

// ── Role hierarchy checks ─────────────────────────────────────────

/** Returns true when `actor` has a strictly higher tier than `target`. */
export function canManageUser(actor: string, target: string): boolean {
  const actorTier = ROLE_HIERARCHY[actor] ?? 0;
  const targetTier = ROLE_HIERARCHY[target] ?? 0;
  return actorTier > targetTier;
}

/** Returns the numeric tier for a role (0 if unknown). */
export function getRoleTier(role: string): number {
  return ROLE_HIERARCHY[role] ?? 0;
}

/** Returns true when `role` is at or above `minTier`. */
export function isAtLeast(role: string, minTier: number): boolean {
  return (ROLE_HIERARCHY[role] ?? 0) >= minTier;
}

// ── Static permission map (mirrors role_permissions seed) ─────────
// Format: feature → role → permission level

type PermissionLevel = "view" | "edit" | "delete" | "admin";

const FEATURE_PERMISSIONS: Record<string, Record<string, PermissionLevel>> = {
  user_management: {
    owner: "admin",
    org_admin: "admin",
    facility_admin: "edit",
    manager: "edit",
    admin_assistant: "view",
    coordinator: "view",
    nurse: "view",
    caregiver: "view",
    dietary: "view",
    housekeeper: "view",
    maintenance_role: "view",
    family: "view",
    broker: "admin",
  },
  billing: {
    owner: "admin",
    org_admin: "admin",
    facility_admin: "edit",
    manager: "view",
    nurse: "view",
    dietary: "view",
    caregiver: "view",
    housekeeper: "view",
    admin_assistant: "view",
    coordinator: "view",
    maintenance_role: "view",
    family: "view",
    broker: "admin",
  },
  clinical: {
    owner: "admin",
    org_admin: "admin",
    facility_admin: "edit",
    manager: "edit",
    coordinator: "edit",
    nurse: "edit",
    caregiver: "view",
    dietary: "view",
    housekeeper: "view",
    admin_assistant: "view",
    maintenance_role: "view",
    family: "view",
    broker: "admin",
  },
  staff: {
    owner: "admin",
    org_admin: "admin",
    facility_admin: "edit",
    manager: "edit",
    admin_assistant: "view",
    coordinator: "view",
    nurse: "view",
    caregiver: "view",
    dietary: "view",
    housekeeper: "view",
    maintenance_role: "view",
    family: "view",
    broker: "admin",
  },
  reports: {
    owner: "admin",
    org_admin: "admin",
    facility_admin: "admin",
    manager: "edit",
    coordinator: "view",
    nurse: "view",
    admin_assistant: "view",
    dietary: "view",
    housekeeper: "view",
    caregiver: "view",
    maintenance_role: "view",
    family: "view",
    broker: "admin",
  },
  incidents: {
    owner: "admin",
    org_admin: "admin",
    facility_admin: "edit",
    manager: "edit",
    coordinator: "view",
    nurse: "edit",
    caregiver: "view",
    dietary: "view",
    housekeeper: "view",
    admin_assistant: "view",
    maintenance_role: "view",
    family: "view",
    broker: "admin",
  },
  care_plans: {
    owner: "admin",
    org_admin: "admin",
    facility_admin: "edit",
    manager: "view",
    coordinator: "edit",
    nurse: "view",
    caregiver: "view",
    dietary: "view",
    housekeeper: "view",
    admin_assistant: "view",
    maintenance_role: "view",
    family: "view",
    broker: "admin",
  },
};

const PERMISSION_ORDER: Record<PermissionLevel, number> = {
  view: 1,
  edit: 2,
  delete: 3,
  admin: 4,
};

/** Client-side permission check. Returns true if `role` has at least `required` access for `feature`. */
export function hasPermission(
  role: string,
  feature: string,
  required: PermissionLevel = "view",
): boolean {
  const featurePerms = FEATURE_PERMISSIONS[feature];
  if (!featurePerms) return false;
  const granted = featurePerms[role];
  if (!granted) return false;
  return (PERMISSION_ORDER[granted] ?? 0) >= (PERMISSION_ORDER[required] ?? 0);
}

/** Returns all permission keys granted to a role for a given feature. */
export function getPermissionsForRole(role: string, feature: string): PermissionLevel | null {
  return FEATURE_PERMISSIONS[feature]?.[role] ?? null;
}

// ── Display mappings ──────────────────────────────────────────────

export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  org_admin: "Org Admin",
  facility_admin: "Administrator",
  manager: "Manager",
  admin_assistant: "Admin Assistant",
  coordinator: "Service Coordinator",
  nurse: "Medication Manager",
  caregiver: "Med-Tech / Resident Aide",
  dietary: "Lead Cook",
  housekeeper: "Housekeeper",
  maintenance_role: "Maintenance",
  family: "Family Member",
  broker: "Broker",
};

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner: "Full platform access across all organizations",
  org_admin: "Full access at the organization level",
  facility_admin: "On-site authority — full operational access at assigned facilities",
  manager: "Operational focus — staffing, scheduling, census, incidents (no financials)",
  admin_assistant: "Front desk operations — phones, visitors, docs, basic scheduling",
  coordinator: "Care coordination — care plans, assessments, family communication",
  nurse: "Medication oversight — eMAR, controlled substances, med error review",
  caregiver: "Direct care worker — ADLs, medication administration, rounding",
  dietary: "Kitchen operations — meal planning, dietary restrictions, service tracking",
  housekeeper: "Room cleaning, laundry coordination, supply tracking",
  maintenance_role: "Facility maintenance and repair",
  family: "Family portal — view resident updates and communicate with staff",
  broker: "System administration access",
};

// ── Roles the current user can assign ─────────────────────────────

/** Returns the subset of roles that `actorRole` is allowed to assign to new/existing users. */
export function getAssignableRoles(actorRole: string): string[] {
  const actorTier = ROLE_HIERARCHY[actorRole] ?? 0;
  return ALL_APP_ROLES.filter((r) => (ROLE_HIERARCHY[r] ?? 0) < actorTier);
}
