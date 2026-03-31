"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BellRing, ChevronRight, Clock3, Loader2 } from "lucide-react";

import { conditionChangeTypeLabel } from "@/lib/caregiver/floor-queues";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { fetchActiveResidentsWithRooms } from "@/lib/caregiver/facility-residents";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type OpenCondition = {
  id: string;
  residentId: string;
  title: string;
  reportedAtLabel: string;
  priority: "high" | "medium";
  roomLabel: string;
  name: string;
};

export default function CaregiverFollowupsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<OpenCondition[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setConfigError(null);
    if (!isBrowserSupabaseConfigured()) {
      setConfigError(
        "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
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
      const { facilityId } = resolved.ctx;
      const residents = await fetchActiveResidentsWithRooms(supabase, facilityId);
      const resById = new Map(residents.map((r) => [r.id, r] as const));

      const cq = await supabase
        .from("condition_changes")
        .select("id, resident_id, change_type, description, severity, reported_at")
        .eq("facility_id", facilityId)
        .is("deleted_at", null)
        .is("resolved_at", null)
        .order("reported_at", { ascending: false })
        .limit(30);
      if (cq.error) throw cq.error;

      const list: OpenCondition[] = (cq.data ?? []).map((raw) => {
        const r = raw as {
          id: string;
          resident_id: string;
          change_type: string;
          description: string;
          severity: string;
          reported_at: string;
        };
        const res = resById.get(r.resident_id);
        const name = res?.displayName ?? "Resident";
        const roomLabel = res?.roomLabel ?? "—";
        const sev = (r.severity ?? "moderate").toLowerCase();
        const priority: "high" | "medium" = sev === "critical" || sev === "high" ? "high" : "medium";
        const cat = conditionChangeTypeLabel(r.change_type);
        const title = `${cat} — ${truncate(r.description, 72)}`;
        const reportedAtLabel = formatShortDateTime(r.reported_at);
        return {
          id: r.id,
          residentId: r.resident_id,
          title,
          reportedAtLabel,
          priority,
          roomLabel,
          name,
        };
      });
      setRows(list);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load follow-ups.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  if (configError) {
    return (
      <div className="rounded-lg border border-amber-800/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">{configError}</div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading follow-ups…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">{loadError}</div>
        <Link
          href="/caregiver"
          className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
        >
          Back to shift home
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-zinc-950/80 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg font-display">
            <BellRing className="h-5 w-5 text-teal-400" />
            Follow-ups
          </CardTitle>
          <CardDescription className="text-zinc-400">
            Open condition change reports for your facility (resolve in the clinical / nurse workflow).
          </CardDescription>
        </CardHeader>
      </Card>

      {rows.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
          <CardContent className="py-8 text-center text-sm text-zinc-400">No open follow-ups right now.</CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.id} className="border-zinc-800 bg-zinc-950/60 text-zinc-100">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.title}</span>
                    <Badge
                      className={
                        r.priority === "high"
                          ? "border-rose-800/60 bg-rose-950/40 text-rose-200"
                          : "border-zinc-700 bg-zinc-900 text-zinc-300"
                      }
                    >
                      {r.priority === "high" ? "Priority" : "Routine"}
                    </Badge>
                  </div>
                  <p className="text-xs text-zinc-400">
                    {r.name} · Room {r.roomLabel}
                  </p>
                  <p className="flex items-center gap-1 text-xs text-amber-200/90">
                    <Clock3 className="h-3.5 w-3.5" />
                    Reported {r.reportedAtLabel}
                  </p>
                </div>
                <Link
                  href={`/caregiver/resident/${r.residentId}/condition-change`}
                  className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "shrink-0 text-zinc-400 hover:text-white")}
                  aria-label={`Open ${r.name}`}
                >
                  <ChevronRight className="h-5 w-5" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function formatShortDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
