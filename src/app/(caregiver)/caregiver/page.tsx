"use client";

import Link from "next/link";
import {
  AlertTriangle,
  BellRing,
  CalendarDays,
  CheckCircle2,
  LogIn,
  MessageSquare,
  Pill,
  UserRound,
  Waves,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function CaregiverHomePage() {
  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900 text-zinc-100">
        <CardHeader className="pb-3">
          <CardTitle className="text-xl font-display">Current Shift Brief</CardTitle>
          <CardDescription className="text-zinc-400">
            11 PM to 7 AM handoff priorities and safety-critical watch items.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-xs">
          <StatPill label="Assigned Residents" value="12" tone="neutral" />
          <StatPill label="High Risk Alerts" value="3" tone="warning" />
          <StatPill label="Meds Due (2 hrs)" value="8" tone="neutral" />
          <StatPill label="Unfinished Tasks" value="5" tone="danger" />
        </CardContent>
      </Card>

      <Card className="border-amber-900/60 bg-amber-950/20 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            Critical Alerts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <AlertRow
            title="Fall risk escalation: Margaret Johnson"
            detail="Bed exit sensor triggered 2 times in last 45 minutes."
            badge="Immediate rounding"
          />
          <AlertRow
            title="Medication overdue: Room 114"
            detail="8:00 PM blood pressure medication not yet documented."
            badge="Due now"
          />
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-950/60 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2">
          <QuickLink href="/caregiver/meds" icon={<Pill className="h-4 w-4" />} label="Open eMAR" />
          <QuickLink href="/caregiver/tasks" icon={<CheckCircle2 className="h-4 w-4" />} label="Task Queue" />
          <QuickLink href="/caregiver/incident-draft" icon={<AlertTriangle className="h-4 w-4" />} label="Report incident" />
          <QuickLink href="/caregiver/clock" icon={<LogIn className="h-4 w-4" />} label="Clock in / out" />
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-950/60 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Shift workflows</CardTitle>
          <CardDescription className="text-zinc-400">Follow-ups, handoff, and PRN reassessment.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2">
          <QuickLink href="/caregiver/schedules" icon={<CalendarDays className="h-4 w-4" />} label="My schedule" />
          <QuickLink href="/caregiver/followups" icon={<BellRing className="h-4 w-4" />} label="Follow-ups" />
          <QuickLink href="/caregiver/handoff" icon={<MessageSquare className="h-4 w-4" />} label="Handoff" />
          <QuickLink href="/caregiver/prn-followup" icon={<Pill className="h-4 w-4" />} label="PRN follow-up" />
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-950/60 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Resident Watchlist</CardTitle>
          <CardDescription className="text-zinc-400">
            Residents needing elevated monitoring this shift.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <ResidentRow name="Margaret Johnson" room="114" flags={["Fall risk", "Toileting assist"]} />
          <ResidentRow name="Samuel Ortiz" room="212" flags={["Behavioral trigger", "Sleep disruption"]} />
          <ResidentRow name="Elena Ramos" room="207" flags={["Hydration watch", "Blood sugar check"]} />
        </CardContent>
      </Card>
    </div>
  );
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "warning" | "danger";
}) {
  const toneClass =
    tone === "danger"
      ? "border-rose-800/60 bg-rose-950/30"
      : tone === "warning"
        ? "border-amber-800/60 bg-amber-950/30"
        : "border-zinc-800 bg-zinc-900/80";

  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function AlertRow({
  title,
  detail,
  badge,
}: {
  title: string;
  detail: string;
  badge: string;
}) {
  return (
    <div className="rounded-lg border border-amber-800/60 bg-zinc-950/80 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-zinc-100">{title}</p>
        <Badge className="border-amber-700 bg-amber-900/40 text-amber-200">{badge}</Badge>
      </div>
      <p className="text-xs text-zinc-400">{detail}</p>
    </div>
  );
}

function QuickLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-12 items-center justify-start gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 text-zinc-100 transition-colors hover:bg-zinc-800 hover:text-white tap-responsive"
    >
      {icon}
      <span className="text-xs">{label}</span>
    </Link>
  );
}

function ResidentRow({
  name,
  room,
  flags,
}: {
  name: string;
  room: string;
  flags: string[];
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserRound className="h-4 w-4 text-zinc-400" />
          <p className="text-sm font-medium text-zinc-100">{name}</p>
        </div>
        <span className="text-xs text-zinc-400">Room {room}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {flags.map((flag) => (
          <Badge key={flag} variant="outline" className="border-zinc-700 text-zinc-300">
            <Waves className="mr-1 h-3 w-3 text-zinc-500" />
            {flag}
          </Badge>
        ))}
      </div>
    </div>
  );
}
