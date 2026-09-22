/**
 * RBAC utility library — centralized role hierarchy, permission checks, and display mappings.
 * Mirrors the `role_permissions` bootstrap data in migration 122 and the `haven.role_tier()` SQL helper.
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
  med_tech: 50,
  marketing: 50,
  cook: 40,
  maintenance_role: 40,
  broker: 30,
  housekeeper: 30,
  family: 10,
  // Retired (owner rulings 2026-09-22, migration 468): nobody holds these; tiers kept to
  // mirror haven.role_tier() so an old value still sorts. nurse + caregiver -> med_tech,
  // dietary + dietary_aide -> cook.
  nurse: 50,
  dietary: 40,
  caregiver: 20,
  dietary_aide: 20,
};

// ── Ordered role list ─────────────────────────────────────────────

export const ALL_APP_ROLES = [
  "owner",
  "org_admin",
  "facility_admin",
  "manager",
  "admin_assistant",
  "coordinator",
  "med_tech",
  "cook",
  "housekeeper",
  "maintenance_role",
  "marketing",
  "family",
  "broker",
] as const;

export type AppRole = (typeof ALL_APP_ROLES)[number];

// ── Admin-shell eligible roles ────────────────────────────────────
// All roles that may access the admin shell. Excludes family, housekeeper.
// Retired roles are not listed: migration 468 folded nurse/caregiver into med_tech and
// dietary/dietary_aide into cook. Marketing is admin-eligible but its admin nav is limited
// to referrals / pipeline / reputation (see dashboard-routing.ts).

export const ADMIN_ELIGIBLE_ROLES = new Set<string>([
  "owner",
  "org_admin",
  "facility_admin",
  "manager",
  "admin_assistant",
  "coordinator",
  "med_tech",
  "cook",
  "maintenance_role",
  "marketing",
  "broker",
]);

// ── Role hierarchy checks ─────────────────────────────────────────

/** Returns true when `actor` has a strictly higher tier than `target`. */
export function canManageUser(actor: string, target: string): boolean {
  const actorTier = ROLE_HIERARCHY[actor] ?? 0;
  const targetTier = ROLE_HIERARCHY[target] ?? 0;
  return actorTier > targetTier;
}

/** Returns true when `actor` is at least the same tier as `target`. */
export function canActorManageTarget(actor: string, target: string): boolean {
  const actorTier = ROLE_HIERARCHY[actor] ?? 0;
  const targetTier = ROLE_HIERARCHY[target] ?? 0;
  return actorTier > 0 && targetTier > 0 && actorTier >= targetTier;
}

const HARD_DELETE_PROTECTED_TARGET_ROLES = new Set<string>(["owner", "org_admin"]);

/**
 * Returns true when an actor may attempt permanent account deletion by role.
 * Data-history checks still decide whether deletion is safe for a specific user.
 */
export function canActorHardDeleteTarget(actor: string, target: string): boolean {
  return (
    actor === "owner" &&
    (ALL_APP_ROLES as readonly string[]).includes(target) &&
    !HARD_DELETE_PROTECTED_TARGET_ROLES.has(target)
  );
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
// med_tech holds the widest level any of nurse / caregiver / med_tech held, and cook the
// widest of dietary / dietary_aide (migration 468 folded role_permissions the same way).
// marketing has no entry: none of these features cover referrals / pipeline / reputation,
// which are gated per route.

type PermissionLevel = "view" | "edit" | "delete" | "admin";

const FEATURE_PERMISSIONS: Record<string, Record<string, PermissionLevel>> = {
  user_management: {
    owner: "admin",
    org_admin: "admin",
    facility_admin: "edit",
    manager: "edit",
    admin_assistant: "view",
    coordinator: "view",
    med_tech: "view",
    cook: "view",
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
    med_tech: "view",
    cook: "view",
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
    med_tech: "edit",
    cook: "view",
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
    med_tech: "view",
    cook: "view",
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
    med_tech: "view",
    admin_assistant: "view",
    cook: "view",
    housekeeper: "view",
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
    med_tech: "edit",
    cook: "view",
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
    med_tech: "view",
    cook: "view",
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
  med_tech: "Med-Tech",
  cook: "Cook",
  housekeeper: "Housekeeper",
  maintenance_role: "Maintenance",
  marketing: "Marketing",
  family: "Family Member",
  broker: "Broker",
  // Legacy display only (history rows) — retired 2026-09-22, migration 468.
  nurse: "Medication Manager",
  caregiver: "Caregiver / Resident Aide",
  dietary: "Lead Cook / Dietary",
  dietary_aide: "Dietary Aide",
};

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner: "Full platform access across all organizations",
  org_admin: "Full access at the organization level",
  facility_admin: "On-site authority — full operational access at assigned facilities",
  manager: "Operational focus — staffing, scheduling, census, incidents (no financials)",
  admin_assistant: "Front desk operations — phones, visitors, docs, basic scheduling",
  coordinator: "Care coordination — care plans, assessments, family communication",
  med_tech: "Medication technician and floor care — Med-Tech cockpit, eMAR, med passes, controlled substances, plus the caregiver floor app (tasks, ADLs, rounding)",
  cook: "Cook — meal planning and preparation, diet orders, HACCP, tray and service tracking",
  marketing: "Marketing — referrals, pipeline and reputation only",
  nurse: "Legacy role — folded into Med-Tech",
  caregiver: "Legacy role — folded into Med-Tech",
  dietary: "Legacy role — folded into Cook",
  dietary_aide: "Legacy role — folded into Cook",
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
