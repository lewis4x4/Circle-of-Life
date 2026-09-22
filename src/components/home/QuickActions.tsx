import Link from "next/link";
import { CalendarDays, CreditCard, PenLine, Phone, Wrench } from "lucide-react";

import { cn } from "@/lib/utils";

const BASE = "inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-[13px] font-medium shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const BADGE = "inline-flex h-[18px] items-center rounded border px-1.5 text-[10px] font-semibold uppercase tracking-wide";

type PendingAction = { label: string; week: string; note: string; icon: typeof CreditCard; tone: string };

/**
 * Quick actions. The buttons for later weeks render disabled with their week
 * badge on purpose — a teaching cue for the operator, not a placeholder.
 */
const PENDING: PendingAction[] = [
  { label: "Record payment", week: "Week 2", note: "Ships in week 2: past-due rent and Record payment on Home.", icon: CreditCard, tone: "border-warning/40 text-warning" },
  { label: "Quick note", week: "Week 3", note: "Ships in week 3: a note that becomes a task.", icon: PenLine, tone: "border-info/40 text-info" },
  { label: "Call-out", week: "Week 4", note: "Ships in week 4: phone-first call-out.", icon: Phone, tone: "border-success/45 text-success" },
];

export function QuickActions() {
  return (
    <div className="mb-4 flex flex-wrap gap-2" aria-label="Quick actions">
      <Link href="/admin/stand-up" className={cn(BASE, "hover:bg-secondary")}>
        <CalendarDays className="size-[15px]" aria-hidden /> Open Stand Up
      </Link>
      {PENDING.map((action) => (
        <button key={action.label} type="button" className={cn(BASE, "cursor-not-allowed opacity-55")} disabled title={action.note} aria-describedby={undefined}>
          <action.icon className="size-[15px]" aria-hidden /> {action.label}
          <span className={cn(BADGE, action.tone)}>{action.week}</span>
        </button>
      ))}
      <button type="button" className={cn(BASE, "cursor-not-allowed opacity-55")} disabled title="Available once the maintenance seat exists.">
        <Wrench className="size-[15px]" aria-hidden /> Maintenance ticket
        <span className={cn(BADGE, "border-border text-muted-foreground")}>Later</span>
      </button>
    </div>
  );
}
