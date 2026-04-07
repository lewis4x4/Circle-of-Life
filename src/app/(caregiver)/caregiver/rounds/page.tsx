"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock3, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RoundingTaskCard, type RoundingTaskCardData } from "@/components/rounding/RoundingTaskCard";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

type TaskApiRow = {
  id: string;
  due_at: string;
  note: string | null;
  derived_status: RoundingTaskCardData["derivedStatus"];
  residents?: { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null; bed_id: string | null } | null;
  staff?: { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
};

function displayName(person?: { first_name: string | null; last_name: string | null; preferred_name: string | null } | null) {
  return [person?.preferred_name ?? person?.first_name ?? null, person?.last_name ?? null].filter(Boolean).join(" ");
}

export default function CaregiverRoundsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [facilityName, setFacilityName] = useState<string | null>(null);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<RoundingTaskCardData[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setConfigError(null);

    if (!isBrowserSupabaseConfigured()) {
      setConfigError("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.");
      setLoading(false);
      return;
    }

    try {
      const resolved = await loadCaregiverFacilityContext(supabase);
      if (!resolved.ok) {
        setLoadError(resolved.error);
        setLoading(false);
        return;
      }

      setFacilityId(resolved.ctx.facilityId);
      setFacilityName(resolved.ctx.facilityName);

      const response = await fetch(`/api/rounding/tasks?facilityId=${encodeURIComponent(resolved.ctx.facilityId)}&limit=100`, {
        cache: "no-store",
      });
      const json = (await response.json()) as { error?: string; tasks?: TaskApiRow[] };
      if (!response.ok) {
        throw new Error(json.error ?? "Could not load rounds");
      }

      setTasks(
        (json.tasks ?? []).map((task) => ({
          id: task.id,
          residentId: task.residents?.id ?? "unknown",
          residentName: displayName(task.residents) || "Resident",
          roomLabel: task.residents?.bed_id ? `Bed ${task.residents.bed_id.slice(-3)}` : null,
          assignedStaffName: displayName(task.staff) || null,
          dueAt: task.due_at,
          derivedStatus: task.derived_status,
          note: task.note,
        })),
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load rounding queue.");
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    return {
      urgent: tasks.filter((task) => task.derivedStatus === "critically_overdue" || task.derivedStatus === "missed"),
      due: tasks.filter((task) => task.derivedStatus === "overdue" || task.derivedStatus === "due_now"),
      next: tasks.filter((task) => task.derivedStatus === "due_soon" || task.derivedStatus === "upcoming"),
      done: tasks.filter((task) => task.derivedStatus === "completed_on_time" || task.derivedStatus === "completed_late"),
    };
  }, [tasks]);

  if (configError) {
    return <div className="rounded-lg border border-amber-800/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">{configError}</div>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading rounds…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl font-display">Smart Rounds</CardTitle>
          <CardDescription className="text-zinc-400">
            {facilityName ? `${facilityName} live rounding queue.` : "Live rounding queue."} Complete the due-now path in a few taps and capture exceptions when needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-xs">
          <MetricPill icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Critical" value={String(grouped.urgent.length)} tone="danger" />
          <MetricPill icon={<Clock3 className="h-3.5 w-3.5" />} label="Due now" value={String(grouped.due.length)} tone="warning" />
          <MetricPill icon={<Clock3 className="h-3.5 w-3.5" />} label="Next up" value={String(grouped.next.length)} tone="neutral" />
          <MetricPill icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Completed" value={String(grouped.done.length)} tone="success" />
        </CardContent>
      </Card>

      {loadError ? (
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
          {loadError}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button variant="outline" className="min-h-11 border-zinc-800 bg-zinc-950 text-zinc-100 hover:bg-zinc-900" onClick={() => void load()}>
          Refresh queue
        </Button>
        {facilityId ? (
          <Link
            href={`/api/rounding/generate-tasks?facilityId=${encodeURIComponent(facilityId)}`}
            className="text-xs text-zinc-500"
          >
            API ready
          </Link>
        ) : null}
      </div>

      <Section title="Critical now" tone="danger" emptyMessage="No critical or missed rounds right now.">
        {grouped.urgent.map((task) => (
          <RoundingTaskCard key={task.id} task={task} href={`/caregiver/rounds/${task.residentId}?taskId=${task.id}`} />
        ))}
      </Section>

      <Section title="Due now" tone="warning" emptyMessage="No due-now or overdue rounds right now.">
        {grouped.due.map((task) => (
          <RoundingTaskCard key={task.id} task={task} href={`/caregiver/rounds/${task.residentId}?taskId=${task.id}`} />
        ))}
      </Section>

      <Section title="Coming up" tone="neutral" emptyMessage="No upcoming rounds in the current window.">
        {grouped.next.map((task) => (
          <RoundingTaskCard key={task.id} task={task} href={`/caregiver/rounds/${task.residentId}?taskId=${task.id}`} />
        ))}
      </Section>
    </div>
  );
}

function MetricPill({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: "neutral" | "warning" | "danger" | "success";
}) {
  const toneClass =
    tone === "danger"
      ? "border-rose-800/60 bg-rose-950/30 text-rose-100"
      : tone === "warning"
        ? "border-amber-800/60 bg-amber-950/30 text-amber-100"
        : tone === "success"
          ? "border-emerald-800/60 bg-emerald-950/30 text-emerald-100"
          : "border-zinc-800 bg-zinc-900/80 text-zinc-100";

  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
      <div className="mb-1 flex items-center gap-1 text-[11px] uppercase tracking-wide">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function Section({
  title,
  tone,
  emptyMessage,
  children,
}: {
  title: string;
  tone: "neutral" | "warning" | "danger";
  emptyMessage: string;
  children: ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : [children].filter(Boolean);
  const badgeVariant = tone === "danger" ? "destructive" : tone === "warning" ? "outline" : "secondary";

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">{title}</h2>
        <Badge variant={badgeVariant}>{items.length}</Badge>
      </div>
      {items.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
          <CardContent className="py-6 text-sm text-zinc-400">{emptyMessage}</CardContent>
        </Card>
      ) : (
        <div className="space-y-2">{items}</div>
      )}
    </section>
  );
}
