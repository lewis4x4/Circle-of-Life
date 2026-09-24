/**
 * The tab lists of the staff and family apps — one place, as data (COL-714).
 *
 * Owner ruling 2026-09-23: one standard layout for all staff and family apps
 * (same header, bottom tab bar on phones). Med-Tech gets one app — meds,
 * residents, rounds, clock, me — merging the med-tech cockpit and the floor
 * app, whose URLs stay as they are. Cook, Housekeeper and Family each get their
 * own short list. "My employee file" lives under Me.
 *
 * `RoleAppFrame` renders these; nothing else should hand-build a role-app nav.
 */
import { isDietaryRole, isMedTechRole } from "@/lib/auth/app-role";
import { FAMILY_SECTIONS } from "@/lib/family/family-sections";
import { routeIsWithin } from "@/lib/navigation/route-match";

export type RoleAppKey = "med-tech" | "housekeeper" | "cook" | "family";

export type RoleAppIcon =
  | "meds"
  | "residents"
  | "rounds"
  | "clock"
  | "schedule"
  | "me"
  | "home"
  | "kitchen"
  | "reading"
  | "today"
  | "calendar"
  | "care"
  | "updates"
  | "documents"
  | "billing";

export type RoleAppTab = {
  key: string;
  href: string;
  label: string;
  icon: RoleAppIcon;
  /** `href` owns only itself, not the pages under it (e.g. the floor board at `/caregiver`). */
  exact?: boolean;
  /** Other route trees that belong to this tab. The longest matching route wins. */
  also?: readonly string[];
};

const EMPLOYEE_FILE = "/employee-file";

const FAMILY_ICONS: Record<(typeof FAMILY_SECTIONS)[number]["key"], RoleAppIcon> = {
  today: "today",
  calendar: "calendar",
  care: "care",
  updates: "updates",
  documents: "documents",
  billing: "billing",
};

export const ROLE_APP_TABS: Readonly<Record<RoleAppKey, readonly RoleAppTab[]>> = {
  "med-tech": [
    {
      key: "meds",
      href: "/med-tech",
      label: "Meds",
      icon: "meds",
      also: ["/caregiver/meds", "/caregiver/prn-followup", "/caregiver/controlled-count"],
    },
    {
      key: "residents",
      href: "/caregiver",
      label: "Residents",
      icon: "residents",
      exact: true,
      also: [
        "/caregiver/resident",
        "/caregiver/tasks",
        "/caregiver/followups",
        "/caregiver/handoff",
        "/caregiver/report",
        "/caregiver/incident-draft",
      ],
    },
    { key: "rounds", href: "/caregiver/rounds", label: "Rounds", icon: "rounds" },
    {
      key: "clock",
      href: "/caregiver/clock",
      label: "Clock",
      icon: "clock",
      also: ["/caregiver/schedules", "/caregiver/shift-swaps"],
    },
    {
      key: "me",
      href: "/caregiver/me",
      label: "Me",
      icon: "me",
      also: [EMPLOYEE_FILE, "/caregiver/acknowledgments", "/caregiver/policies", "/med-tech/acknowledgments"],
    },
  ],
  housekeeper: [
    { key: "home", href: "/caregiver/housekeeper", label: "Home", icon: "home" },
    { key: "clock", href: "/caregiver/clock", label: "Clock", icon: "clock" },
    {
      key: "schedule",
      href: "/caregiver/schedules",
      label: "Schedule",
      icon: "schedule",
      also: ["/caregiver/shift-swaps"],
    },
    {
      key: "me",
      href: "/caregiver/me",
      label: "Me",
      icon: "me",
      also: [EMPLOYEE_FILE, "/caregiver/acknowledgments", "/caregiver/policies"],
    },
  ],
  cook: [
    { key: "kitchen", href: "/dietary", label: "Kitchen", icon: "kitchen", exact: true },
    { key: "reading", href: "/dietary/acknowledgments", label: "Reading", icon: "reading" },
    { key: "me", href: EMPLOYEE_FILE, label: "Me", icon: "me" },
  ],
  // The family sections stay the single list the in-page pills also render (COL-655).
  family: FAMILY_SECTIONS.map((section) => ({
    key: section.key,
    href: section.href,
    label: section.label,
    icon: FAMILY_ICONS[section.key],
    exact: section.key === "today",
    also: section.also,
  })),
};

/** The app a login role uses, or null for roles that live in the admin shell. */
export function roleAppForRole(role: string | null | undefined): RoleAppKey | null {
  if (!role) return null;
  if (isMedTechRole(role)) return "med-tech";
  if (isDietaryRole(role)) return "cook";
  if (role === "housekeeper") return "housekeeper";
  if (role === "family") return "family";
  return null;
}

/** The key of the tab that owns `pathname`: the longest matching route wins. */
export function activeRoleAppTab(app: RoleAppKey, pathname: string | null | undefined): string | null {
  const path = (pathname ?? "").replace(/\/+$/, "") || "/";
  let best: { key: string; length: number } | null = null;
  for (const tab of ROLE_APP_TABS[app]) {
    const candidates: [string, boolean][] = [
      [tab.href, tab.exact === true],
      ...(tab.also ?? []).map((route): [string, boolean] => [route, false]),
    ];
    for (const [route, exact] of candidates) {
      const matches = exact ? path === route : routeIsWithin(path, route);
      if (matches && (best === null || route.length > best.length)) {
        best = { key: tab.key, length: route.length };
      }
    }
  }
  return best?.key ?? null;
}
