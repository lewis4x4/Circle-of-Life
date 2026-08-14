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
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Clock,
  CreditCard,
  DoorOpen,
  FileText,
  GraduationCap,
  Heart,
  Home,
  Hotel,
  Landmark,
  LineChart,
  MessageCircle,
  MessageSquare,
  Pill,
  Radar,
  Scale,
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
} from "lucide-react";

export type PillarId =
  | "command"
  | "pipeline"
  | "clinical"
  | "quality"
  | "workforce"
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
};

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
      { key: "owner-home", href: "/admin", label: "Owner home", icon: Home },
      { key: "executive", href: "/admin/executive", label: "Executive", icon: LineChart },
      { key: "reports", href: "/admin/reports", label: "Reports hub", icon: FileText },
      { key: "facilities", href: "/admin/facilities", label: "Facilities", icon: Hotel },
      { key: "billing", href: "/admin/billing", label: "Billing & AR", icon: CreditCard },
    ],
  },
  {
    id: "pipeline",
    label: "Pipeline",
    icon: ActivitySquare,
    items: [
      { key: "referrals", href: "/admin/referrals", label: "Referrals CRM", icon: UserPlus },
      { key: "admissions", href: "/admin/admissions", label: "Admissions overview", icon: Home },
      { key: "discharge", href: "/admin/discharge", label: "Medication reconciliation", icon: DoorOpen },
      { key: "family-portal", href: "/admin/family-portal", label: "Family Portal", icon: Heart },
      { key: "family-messages", href: "/admin/family-messages", label: "Family Messages", icon: MessageCircle },
    ],
  },
  {
    id: "clinical",
    label: "Clinical",
    icon: Stethoscope,
    items: [
      { key: "residents", href: "/admin/residents", label: "Resident roster", icon: Users },
      { key: "care-plans", href: "/admin/care-plans/reviews-due", label: "Care plan reviews", icon: ClipboardList },
      { key: "clinical-desk", href: "/admin/assessments/overdue", label: "Clinical Desk", icon: ClipboardCheck },
      { key: "rounding", href: "/admin/rounding", label: "Smart Rounding", icon: Clock },
      { key: "med-tech", href: "/med-tech", label: "Med-Tech cockpit", icon: Pill },
      { key: "medications", href: "/admin/medications", label: "Medications", icon: Pill },
      { key: "medication-errors", href: "/admin/medications/errors", label: "Medication errors", icon: ShieldAlert },
      { key: "dietary", href: "/admin/dietary", label: "Dietary & Nutrition", icon: Utensils },
      { key: "transportation", href: "/admin/transportation", label: "Transportation", icon: Truck },
    ],
  },
  {
    id: "quality",
    label: "Quality",
    icon: ShieldCheck,
    items: [
      { key: "risk", href: "/admin/risk", label: "Risk command", icon: Radar },
      { key: "incidents", href: "/admin/incidents", label: "Incident queue", icon: ShieldAlert },
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
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    icon: BrainCircuit,
    items: [
      { key: "kb-chat", href: "/admin/knowledge", label: "Ask knowledge base", icon: MessageSquare },
      { key: "kb-admin", href: "/admin/knowledge/admin", label: "KB admin", icon: BookOpen },
    ],
  },
];

/**
 * Routes not surfaced in pillar nav. Reachable only through the ⌘K palette
 * (power-user navigation), profile menu, or parent-page links. Curated —
 * keep this list short and only add routes that genuinely don't fit a
 * pillar.
 */
export const AUXILIARY_ROUTES: PillarItem[] = [
  { key: "finance", href: "/admin/finance", label: "Finance hub", icon: Landmark },
  { key: "vendors", href: "/admin/vendors", label: "Vendors & AP", icon: Truck },
  { key: "insurance", href: "/admin/insurance", label: "Insurance", icon: Umbrella },
  { key: "users", href: "/admin/settings/users", label: "User management", icon: Users },
  { key: "settings-notifications", href: "/admin/settings/notifications", label: "Notification settings", icon: Settings },
  { key: "pilot-feedback", href: "/admin/feedback", label: "Pilot feedback", icon: MessageSquare },
];

export const REPORT_INCIDENT_HREF = "/admin/incidents/new";

/**
 * Returns the pillar that owns the current path, or `null` for routes
 * outside the pillar tree (auxiliary routes, profile pages). The first
 * pillar (Command) is treated as fallback for the bare `/admin` root.
 */
export function findActivePillar(pathname: string): Pillar | null {
  if (!pathname) return null;
  if (pathname === "/admin") return PILLARS[0];

  let best: { pillar: Pillar; length: number } | null = null;
  for (const pillar of PILLARS) {
    for (const item of pillar.items) {
      const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (matches && (best === null || item.href.length > best.length)) {
        best = { pillar, length: item.href.length };
      }
    }
  }
  return best?.pillar ?? null;
}

/** Flat list of every pillar item — used to seed the ⌘K palette. */
export function allPillarItems(): Array<PillarItem & { pillar: Pillar }> {
  return PILLARS.flatMap((pillar) => pillar.items.map((item) => ({ ...item, pillar })));
}

/**
 * Stable keys for the all-sections jump list when the search field is empty.
 * Curated operator screens — not a full pillar dump.
 */
export const SECTION_JUMP_QUICK_KEYS = [
  "executive",
  "residents",
  "incidents",
  "billing",
  "facilities",
  "family-portal",
  "kb-chat",
  "staff",
] as const;

export type SectionJumpEntry = PillarItem & {
  pillarLabel?: string;
  group: "pillar" | "auxiliary";
};

/** All jump-list destinations (pillar items + auxiliary routes). */
export function allSectionJumpEntries(pillars: Pillar[] = PILLARS): SectionJumpEntry[] {
  const pillarEntries = pillars.flatMap((pillar) =>
    pillar.items.map((item) => ({
      ...item,
      pillarLabel: pillar.label,
      group: "pillar" as const,
    })),
  );
  const auxiliaryEntries = AUXILIARY_ROUTES.map((item) => ({
    ...item,
    group: "auxiliary" as const,
  }));
  return [...pillarEntries, ...auxiliaryEntries];
}

/** Quick links shown before the operator types in the all-sections jump list. */
export function sectionJumpQuickEntries(pillars: Pillar[] = PILLARS): SectionJumpEntry[] {
  const byKey = new Map(allSectionJumpEntries(pillars).map((entry) => [entry.key, entry]));
  return SECTION_JUMP_QUICK_KEYS.map((key) => byKey.get(key)).filter(
    (entry): entry is SectionJumpEntry => entry != null,
  );
}

export const PILLAR_ITEM_CAP = 9;
