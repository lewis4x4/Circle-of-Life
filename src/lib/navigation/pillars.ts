/**
 * Mercury-pattern admin navigation: 6 pillars, max 9 items each.
 *
 * The top bar exposes pillars; the contextual left rail shows only the
 * active pillar's items. Items that do not belong to a pillar (Finance,
 * Settings, Payroll, Vendors, Insurance, Billing, etc.) live in the
 * ⌘K command palette (`AUXILIARY_ROUTES` below) and are reachable from
 * parent-page links — they are not surfaced in primary nav per Quiet
 * Operator DNA (no "More" overflow, no nested collapsibles).
 *
 * Edit pillar items only with the 9-item cap in mind. If a pillar grows
 * past 9 items the pillar needs splitting (e.g. spin off a 7th pillar)
 * rather than nesting.
 */

import {
  Activity,
  ActivitySquare,
  ArrowLeftRight,
  Award,
  Banknote,
  Biohazard,
  BookOpen,
  BrainCircuit,
  Bus,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Clock,
  CreditCard,
  Cookie,
  DoorOpen,
  Eye,
  FileText,
  GraduationCap,
  Home,
  Hotel,
  Landmark,
  LineChart,
  Megaphone,
  MessageSquare,
  Pill,
  Radar,
  Scale,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  Truck,
  Umbrella,
  UserCog,
  UserPlus,
  Users,
  Utensils,
  Zap,
  type LucideIcon,
  Timer,
} from "lucide-react";
import { isFacilityOperatorRole } from "@/lib/auth/app-role";
import type { DashboardConfig } from "@/lib/auth/dashboard-routing";
import { routeIsWithin } from "@/lib/navigation/route-match";
import { filterStaffLaunchHiddenItems } from "@/lib/navigation/staff-launch-hidden";

export type PillarId =
  | "command"
  | "pipeline"
  | "clinical"
  | "quality"
  | "workforce"
  | "finance"
  | "knowledge";

export type PillarItem = {
  /** Stable key for keyboard search + telemetry */
  key: string;
  /** Absolute route */
  href: string;
  /** Human label */
  label: string;
  /** Icon glyph */
  icon: LucideIcon;
  /**
   * Extra route trees this item owns beyond its own `href` (COL-655). Used
   * when the item's landing page is a child of the tree it stands for, e.g.
   * "Care plan reviews" (`/admin/care-plans/reviews-due`) owns
   * `/admin/care-plans`.
   */
  owns?: readonly string[];
};

/**
 * A route outside the pillar rails (⌘K palette, profile menu, parent-page
 * links). Every one names the pillar it belongs to, so the shell can light
 * that pillar and show the route in its rail while the operator is on it
 * (COL-655). `null` = an account-level route (profile, settings, search)
 * that belongs to no pillar and shows no rail.
 */
export type AuxiliaryRoute = PillarItem & { pillar: PillarId | null };

export type Pillar = {
  id: PillarId;
  /** Top-bar tab label */
  label: string;
  /** Tab icon (used on mobile scroll strip + cmd-k grouping) */
  icon: LucideIcon;
  /** Contextual left-rail items (≤ 9) */
  items: PillarItem[];
};

export const PILLARS: Pillar[] = [
  {
    id: "command",
    label: "Command",
    icon: Zap,
    items: [
      { key: "owner-home", href: "/admin", label: "Home", icon: Home },
      { key: "executive", href: "/admin/executive", label: "Executive", icon: LineChart },
      { key: "stand-up", href: "/admin/stand-up", label: "Weekly Stand Up", icon: CalendarDays, owns: ["/admin/executive/standup"] },
      { key: "reports", href: "/admin/reports", label: "Reports hub", icon: FileText },
      { key: "facilities", href: "/admin/facilities", label: "Facilities", icon: Hotel },
      { key: "billing", href: "/admin/billing", label: "Billing & AR", icon: CreditCard },
      // Resident trips are a facility-operations desk, not a clinical one (COL-655).
      { key: "transportation", href: "/admin/transportation", label: "Transportation", icon: Bus },
    ],
  },
  {
    id: "pipeline",
    label: "Pipeline",
    icon: ActivitySquare,
    items: [
      { key: "referrals", href: "/admin/referrals", label: "Referrals CRM", icon: UserPlus },
      { key: "admissions", href: "/admin/admissions", label: "Admissions overview", icon: Home },
      { key: "benefits", href: "/admin/benefits", label: "Medicaid & benefits", icon: ClipboardCheck },
      { key: "discharge", href: "/admin/discharge", label: "Medication reconciliation", icon: DoorOpen },
      { key: "family-messages", href: "/admin/family-messages", label: "Family notes", icon: Megaphone },
    ],
  },
  {
    id: "clinical",
    label: "Clinical",
    icon: Stethoscope,
    items: [
      { key: "residents", href: "/admin/residents", label: "Resident roster", icon: Users },
      { key: "care-plans", href: "/admin/care-plans/reviews-due", label: "Care plan reviews", icon: ClipboardList, owns: ["/admin/care-plans"] },
      { key: "form-1823-alignment", href: "/admin/care-plans/form-1823-alignment", label: "Form 1823 alignment", icon: ClipboardCheck },
      { key: "clinical-desk", href: "/admin/assessments/overdue", label: "Clinical Desk", icon: ClipboardCheck, owns: ["/admin/assessments"] },
      { key: "rounding", href: "/admin/rounding", label: "Smart Rounding", icon: Clock },
      { key: "med-tech", href: "/med-tech", label: "Med-Tech cockpit", icon: Pill },
      { key: "medications", href: "/admin/medications", label: "Medications", icon: Pill },
      { key: "medication-errors", href: "/admin/medications/errors", label: "Medication errors", icon: ShieldAlert },
      { key: "dietary", href: "/admin/dietary", label: "Dietary & Nutrition", icon: Utensils, owns: ["/admin/dietary-dashboard"] },
    ],
  },
  {
    id: "quality",
    label: "Quality",
    icon: ShieldCheck,
    items: [
      { key: "risk", href: "/admin/risk", label: "Risk command", icon: Radar },
      { key: "incidents", href: "/admin/incidents", label: "Incident queue", icon: ShieldAlert, owns: ["/admin/care-events"] },
      { key: "infection", href: "/admin/infection-control", label: "Infection Control", icon: Biohazard },
      { key: "compliance", href: "/admin/compliance", label: "Compliance & Safety", icon: Scale },
      { key: "quality", href: "/admin/quality", label: "Quality metrics", icon: LineChart },
    ],
  },
  {
    id: "workforce",
    label: "Workforce",
    icon: UserCog,
    items: [
      { key: "staff", href: "/admin/staff", label: "Staff roster", icon: UserCog },
      { key: "schedules", href: "/admin/schedules", label: "Schedules", icon: CalendarDays },
      { key: "shift-swaps", href: "/admin/shift-swaps", label: "Shift swaps", icon: ArrowLeftRight },
      { key: "staffing", href: "/admin/staffing", label: "Staffing alerts", icon: Activity },
      { key: "certifications", href: "/admin/certifications", label: "Certifications", icon: Award },
      { key: "training", href: "/admin/training", label: "Training", icon: GraduationCap },
      { key: "time-records", href: "/admin/time-records", label: "Time records", icon: Clock },
      { key: "payroll", href: "/admin/payroll", label: "Payroll", icon: Banknote },
      { key: "timeclock", href: "/admin/timeclock", label: "Timeclock", icon: Timer },
    ],
  },
  {
    id: "finance",
    label: "Business",
    icon: Landmark,
    items: [
      { key: "finance", href: "/admin/finance", label: "Finance", icon: Landmark },
      { key: "vendors", href: "/admin/vendors", label: "Vendors & AP", icon: Truck },
      { key: "insurance", href: "/admin/insurance", label: "Insurance", icon: Umbrella },
      { key: "cash", href: "/admin/finance/trust", label: "Cash & trust accounts", icon: Banknote },
      { key: "letters", href: "/admin/letters", label: "Letters", icon: FileText },
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    icon: BrainCircuit,
    items: [
      { key: "kb-chat", href: "/admin/knowledge", label: "Ask knowledge base", icon: MessageSquare },
      {
        key: "kb-admin",
        href: "/admin/knowledge/admin",
        label: "KB admin",
        icon: BookOpen,
        owns: ["/admin/knowledge/documents", "/admin/knowledge/coverage", "/admin/knowledge/seed-targets"],
      },
    ],
  },
];

/**
 * Routes not surfaced in pillar nav. Reachable only through the ⌘K palette
 * (power-user navigation), profile menu, or parent-page links. Curated —
 * keep this list short and only add routes that genuinely don't fit a
 * pillar.
 *
 * Every entry names its pillar (COL-655): while the operator is on the
 * route, the shell lights that pillar and shows the entry in its rail, so
 * no page falls through to an unrelated pillar with nothing highlighted.
 * `navigation-anchoring.test.ts` fails when an `/admin` page is neither
 * inside a pillar item's tree nor listed here.
 */
export const AUXILIARY_ROUTES: AuxiliaryRoute[] = [
  { key: "rounding-live", href: "/admin/rounding/live", label: "Live rounding", icon: Eye, pillar: "clinical" },
  { key: "snack-pass", href: "/admin/dietary#snack-pass", label: "Snack pass", icon: Cookie, pillar: "clinical" },
  { key: "policies", href: "/admin/compliance/policies", label: "Policies", icon: BookOpen, pillar: "quality" },
  { key: "acknowledgments", href: "/admin/acknowledgments", label: "Policy acknowledgments", icon: BookOpen, pillar: "workforce" },
  { key: "meetings", href: "/admin/meetings", label: "Meetings", icon: Users, pillar: "workforce" },
  { key: "teams", href: "/admin/teams", label: "Teams", icon: Users, pillar: "workforce" },
  { key: "forms", href: "/admin/forms", label: "Forms", icon: FileText, pillar: "workforce" },
  { key: "briefing", href: "/admin/briefing", label: "Daily briefing", icon: FileText, pillar: "command" },
  { key: "calendar", href: "/admin/calendar", label: "Calendar", icon: CalendarDays, pillar: "command" },
  { key: "kanban", href: "/admin/kanban", label: "Team tasks", icon: ClipboardList, pillar: "command" },
  { key: "front-desk", href: "/admin/front-desk", label: "Front desk", icon: Home, pillar: "command" },
  { key: "contacts", href: "/admin/contacts", label: "Contacts", icon: Users, pillar: "command" },
  { key: "pilot-feedback", href: "/admin/feedback", label: "Feedback", icon: MessageSquare, pillar: "command" },
  { key: "files", href: "/admin/files", label: "Files", icon: FileText, pillar: "knowledge" },
  { key: "workspace", href: "/admin/workspace", label: "Workspace", icon: BookOpen, pillar: "knowledge" },
  { key: "drive-import", href: "/admin/drive-import", label: "Drive inventory & bookmarks", icon: FileText, pillar: "knowledge" },
  { key: "drive-cutover", href: "/admin/drive-cutover", label: "Drive transition readiness", icon: ClipboardCheck, pillar: "knowledge" },
  { key: "users", href: "/admin/settings/users", label: "User management", icon: Users, pillar: null },
  { key: "settings-system-alerts", href: "/admin/settings/system-alerts", label: "System alerts", icon: Settings, pillar: null },
  { key: "settings-notifications", href: "/admin/settings/notifications", label: "Notification settings", icon: Settings, pillar: null },
];

/**
 * Routes that belong to a pillar but are deliberately NOT in the ⌘K palette
 * or any menu: role homes, record-only pages, account pages, and routes an
 * owner ruling keeps off the menus (Reputation: "reached from its own URL").
 * They only anchor the shell — pillar lit, entry shown in the rail while the
 * operator is on it (COL-655).
 */
export const ANCHOR_ONLY_ROUTES: AuxiliaryRoute[] = [
  { key: "nurse-dashboard", href: "/admin/nurse-dashboard", label: "Nurse dashboard", icon: Stethoscope, pillar: "clinical" },
  { key: "handoff", href: "/admin/handoff", label: "Shift handoff", icon: ArrowLeftRight, pillar: "clinical" },
  { key: "activities", href: "/admin/activities", label: "Activities", icon: CalendarDays, pillar: "clinical" },
  { key: "family-portal", href: "/admin/family-portal", label: "Family connections", icon: Users, pillar: "pipeline" },
  { key: "survey-pack", href: "/admin/compliance/survey-pack", label: "Survey pack", icon: ClipboardCheck, pillar: "quality" },
  { key: "operations", href: "/admin/operations", label: "Facility operations", icon: ClipboardList, pillar: "command" },
  { key: "reputation", href: "/admin/reputation", label: "Reputation", icon: Megaphone, pillar: "pipeline" },
  { key: "approvals", href: "/admin/approvals", label: "Approvals", icon: ClipboardCheck, pillar: "command" },
  { key: "mentions", href: "/admin/mentions", label: "Mentions", icon: MessageSquare, pillar: "command" },
  { key: "assistant-dashboard", href: "/admin/assistant-dashboard", label: "Assistant home", icon: Home, pillar: "command" },
  { key: "coordinator-dashboard", href: "/admin/coordinator-dashboard", label: "Coordinator home", icon: Home, pillar: "command" },
  { key: "data-cleanup", href: "/admin/data-cleanup", label: "Data cleanup", icon: ClipboardCheck, pillar: "command" },
  { key: "settings", href: "/admin/settings", label: "Settings", icon: Settings, pillar: null },
  { key: "profile", href: "/admin/profile", label: "Profile", icon: UserCog, pillar: null },
  { key: "search", href: "/admin/search", label: "Search", icon: Search, pillar: null },
  // Served at /admin/v2/design-preview; the resolver strips the v2 prefix.
  { key: "design-preview", href: "/admin/design-preview", label: "Design preview", icon: Eye, pillar: null },
];

/** Spec 07A: every "Report incident" door opens the three-tap caregiver flow. */
export const REPORT_INCIDENT_HREF = "/caregiver/report";

export type NavAnchor = {
  /** Owning pillar; `null` for account-level routes (profile, settings, search). */
  pillarId: PillarId | null;
  /** The single catalog entry that owns the route — the one rail item to light. */
  item: PillarItem;
};

/**
 * The one catalog entry that owns `pathname` (COL-655). Pillar items (their
 * `href` plus any `owns` trees) win; the longest match wins inside that
 * tier, so `/admin/medications/errors` belongs to "Medication errors", not
 * "Medications". Auxiliary / anchor-only routes are consulted only when no
 * pillar item owns the path. `/admin` itself matches only exactly — it is
 * the Home item, not a catch-all for every admin page.
 */
export function resolveNavAnchor(pathname: string): NavAnchor | null {
  if (!pathname) return null;
  const path = pathname.replace(/^\/admin\/v2(?=\/|$)/, "/admin");
  if (path === "/admin") return { pillarId: PILLARS[0].id, item: PILLARS[0].items[0] };

  let best: { anchor: NavAnchor; length: number } | null = null;
  for (const pillar of PILLARS) {
    for (const item of pillar.items) {
      if (item.href === "/admin") continue;
      for (const route of [item.href, ...(item.owns ?? [])]) {
        const length = route.split("#")[0].length;
        if (routeIsWithin(path, route) && (best === null || length > best.length)) {
          best = { anchor: { pillarId: pillar.id, item }, length };
        }
      }
    }
  }
  if (best) return best.anchor;

  for (const route of [...AUXILIARY_ROUTES, ...ANCHOR_ONLY_ROUTES]) {
    const length = route.href.split("#")[0].length;
    if (routeIsWithin(path, route.href) && (best === null || length > best.length)) {
      best = { anchor: { pillarId: route.pillar, item: route }, length };
    }
  }
  return best?.anchor ?? null;
}

/**
 * Returns the pillar that owns the current path, or `null` for account-level
 * routes and paths outside the catalog.
 */
export function findActivePillar(pathname: string): Pillar | null {
  const anchor = resolveNavAnchor(pathname);
  if (!anchor?.pillarId) return null;
  return PILLARS.find((pillar) => pillar.id === anchor.pillarId) ?? null;
}

/** Flat list of every pillar item — used to seed the ⌘K palette. */
export function allPillarItems(): Array<PillarItem & { pillar: Pillar }> {
  return PILLARS.flatMap((pillar) => pillar.items.map((item) => ({ ...item, pillar })));
}

/**
 * Stable keys for the all-sections jump list when the search field is empty.
 * Curated office-week teachable flows (2026-08-24) — not a full pillar dump.
 */
export const SECTION_JUMP_QUICK_KEYS = [
  "executive",
  "residents",
  "billing",
  "family-messages",
  "rounding-live",
  "snack-pass",
] as const;

export type SectionJumpQuickKey = (typeof SECTION_JUMP_QUICK_KEYS)[number];

/** Pin labels for office-week Common shortcuts (may differ from left-rail labels). */
export const SECTION_JUMP_QUICK_LABELS: Partial<Record<SectionJumpQuickKey, string>> = {
  residents: "Resident roster / census",
  billing: "Billing",
};

export type SectionJumpEntry = PillarItem & {
  pillarLabel?: string;
  group: "pillar" | "auxiliary";
};

/** All jump-list destinations (pillar items + auxiliary routes). */
export function allSectionJumpEntries(pillars: Pillar[] = PILLARS, auxiliary: PillarItem[] = AUXILIARY_ROUTES): SectionJumpEntry[] {
  const pillarEntries = pillars.flatMap((pillar) =>
    pillar.items.map((item) => ({
      ...item,
      pillarLabel: pillar.label,
      group: "pillar" as const,
    })),
  );
  const auxiliaryEntries = auxiliary.map((item) => ({
    ...item,
    group: "auxiliary" as const,
  }));
  return [...pillarEntries, ...auxiliaryEntries];
}

/** Quick links shown before the operator types in the all-sections jump list. */
export function sectionJumpQuickEntries(pillars: Pillar[] = PILLARS, auxiliary: PillarItem[] = AUXILIARY_ROUTES): SectionJumpEntry[] {
  const byKey = new Map(allSectionJumpEntries(pillars, auxiliary).map((entry) => [entry.key, entry]));
  return SECTION_JUMP_QUICK_KEYS.map((key) => byKey.get(key))
    .filter((entry): entry is SectionJumpEntry => entry != null)
    .map((entry) => {
      const quickLabel = SECTION_JUMP_QUICK_LABELS[entry.key as SectionJumpQuickKey];
      return quickLabel ? { ...entry, label: quickLabel } : entry;
    });
}

export const PILLAR_ITEM_CAP = 9;

export function pillarsForRole(config: DashboardConfig, role?: string | null): Pillar[] {
  const groups = new Set(config.visibleGroups.map((group) =>
    group === "Clinical Ops" ? "clinical" : group === "Quality & Risk" ? "quality" : group.toLowerCase()));
  const keys = config.visibleItemKeys ? new Set(config.visibleItemKeys) : null;
  return PILLARS.filter((pillar) => groups.has(pillar.id))
    .map((pillar) => ({
      ...pillar,
      items: filterStaffLaunchHiddenItems(
        pillar.items.filter(
          (item) => !keys || keys.has(item.key) || (item.key === "clinical-desk" && keys.has("assessments")),
        ),
        config.visibleItemKeys,
        role,
      ),
    }))
    .filter((pillar) => pillar.items.length > 0);
}

export type FacilityOperatorNavFacility = { id: string; name: string };

/**
 * Facility operator rail (COL-593 / COL-571): Administrator, Assistant
 * Administrator and Manager see one facility-scoped Command rail.
 *
 * - "Facilities" becomes "My facility" and opens the building directly when the
 *   user has exactly one accessible facility. With more than one the catalog
 *   entry stays a list.
 * - The Med-Tech cockpit is never offered to these roles (COL-303: the proxy
 *   bounces them straight back home).
 *
 * The Executive item is handled by `applyExecutiveCommandNavToItems`.
 */
export function applyFacilityOperatorNav(
  pillars: Pillar[],
  role: string | null,
  facilities: ReadonlyArray<FacilityOperatorNavFacility>,
): Pillar[] {
  if (!role || !isFacilityOperatorRole(role)) return pillars;
  const single = facilities.length === 1 ? facilities[0] : null;
  return pillars.map((pillar) => ({
    ...pillar,
    items: pillar.items.flatMap((item) => {
      if (item.key === "med-tech") return [];
      if (item.key === "facilities" && single) {
        return [{ ...item, label: "My facility", href: `/admin/facilities/${single.id}` }];
      }
      return [item];
    }),
  }));
}
