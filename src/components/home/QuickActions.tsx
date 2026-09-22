import Link from "next/link";
import { Building2, CalendarDays, CreditCard, Inbox, PenLine, Phone, ShieldAlert, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

const BASE = "inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-[13px] font-medium shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const BADGE = "inline-flex h-[18px] items-center rounded border px-1.5 text-[10px] font-semibold uppercase tracking-wide";

type LiveAction = { label: string; href: string; icon: typeof CreditCard };
type PendingAction = { label: string; week: string; note: string; icon: typeof CreditCard; tone: string };

/** The locked quick-link order (COL-593 §9.5): live links first, then the week-badged ones. */
export function liveQuickActions(facilityId: string): LiveAction[] {
  return [
    { label: "Open Stand Up", href: "/admin/stand-up", icon: CalendarDays },
    { label: "Referrals", href: "/admin/referrals", icon: Inbox },
    { label: "My facility", href: `/admin/facilities/${facilityId}`, icon: Building2 },
    { label: "EMP", href: "/admin/compliance/emergency-preparedness", icon: ShieldAlert },
    { label: "Report incident", href: "/admin/incidents/new", icon: TriangleAlert },
  ];
}

/**
 * The buttons for later weeks render disabled with their week badge on
 * purpose — a teaching cue for the operator, not a placeholder.
 */
export const PENDING_QUICK_ACTIONS: PendingAction[] = [
  { label: "Record payment", week: "Week 2", note: "Ships in week 2: past-due rent and Record payment on Home.", icon: CreditCard, tone: "border-warning/40 text-warning" },
  { label: "Call-out", week: "Week 4", note: "Ships in week 4: phone-first call-out.", icon: Phone, tone: "border-success/45 text-success" },
  { label: "Quick note", week: "Week 3", note: "Ships in week 3: a note that becomes a task.", icon: PenLine, tone: "border-info/40 text-info" },
];

export function QuickActions({ facilityId }: { facilityId: string }) {
  return (
    <div className="mb-4 flex flex-wrap gap-2" aria-label="Quick actions">
      {liveQuickActions(facilityId).map((action) => (
        <Link key={action.label} href={action.href} className={cn(BASE, "hover:bg-secondary")}>
          <action.icon className="size-[15px]" aria-hidden /> {action.label}
        </Link>
      ))}
      {PENDING_QUICK_ACTIONS.map((action) => (
        <button key={action.label} type="button" className={cn(BASE, "cursor-not-allowed opacity-55")} disabled title={action.note}>
          <action.icon className="size-[15px]" aria-hidden /> {action.label}
          <span className={cn(BADGE, action.tone)}>{action.week}</span>
        </button>
      ))}
    </div>
  );
}
