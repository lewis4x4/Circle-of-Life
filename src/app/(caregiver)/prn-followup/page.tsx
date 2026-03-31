"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, ChevronRight, Loader2, Pill } from "lucide-react";

import {
  canUpdateAnyEmarRecord,
  DEFAULT_PRN_REASSESS_MINUTES,
  prnReassessmentDueAt,
} from "@/lib/caregiver/floor-queues";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { fetchActiveResidentsWithRooms } from "@/lib/caregiver/facility-residents";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type MedJoin = {
  medication_name: string;
  prn_effectiveness_check_minutes: number | null;
};

type EmarRow = {
  id: string;
  resident_id: string;
  actual_time: string;
  administered_by: string | null;
  resident_medications: MedJoin | MedJoin[] | null;
};

type DisplayRow = {
  id: string;
  residentId: string;
  name: string;
  room: string;
  med: string;
  givenLabel: string;
  reassessLabel: string;
  status: "overdue" | "due";
  canDocument: boolean;
  minutes: number;
};

function medFromRow(row: EmarRow): MedJoin | null {
  const m = row.resident_medications;
  if (m == null) return null;
  return Array.isArray(m) ? m[0] ?? null : m;
}

export default function CaregiverPrnFollowupPage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DisplayRow[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [result, setResult] = useState("effective");
  const [effNotes, setEffNotes] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

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
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoadError("Session expired. Sign in again.");
        setLoading(false);
        return;
      }
      setUserId(user.id);
      const prof = await supabase.from("user_profiles").select("app_role").eq("id", user.id).maybeSingle();
      const role = (prof.data as { app_role: string } | null)?.app_role ?? null;

      const resolved = await loadCaregiverFacilityContext(supabase);
      if (!resolved.ok) {
        setLoadError(resolved.error);
        setLoading(false);
        return;
      }
      const { facilityId } = resolved.ctx;
      const residents = await fetchActiveResidentsWithRooms(supabase, facilityId);
      const resById = new Map(residents.map((r) => [r.id, r] as const));

      const emarQ = await supabase
        .from("emar_records")
        .select(
          "id, resident_id, actual_time, administered_by, prn_effectiveness_checked, resident_medications(medication_name, prn_effectiveness_check_minutes)",
        )
        .eq("facility_id", facilityId)
        .eq("is_prn", true)
        .in("status", ["given", "self_administered"])
        .not("actual_time", "is", null)
        .is("deleted_at", null)
        .or("prn_effectiveness_checked.is.null,prn_effectiveness_checked.eq.false")
        .order("actual_time", { ascending: false })
        .limit(50);
      if (emarQ.error) throw emarQ.error;

      const now = Date.now();
      const display: DisplayRow[] = [];
      for (const raw of emarQ.data ?? []) {
        const row = raw as EmarRow;
        if ((raw as { prn_effectiveness_checked?: boolean | null }).prn_effectiveness_checked === true) continue;
        const med = medFromRow(row);
        const medName = med?.medication_name?.trim() || "PRN medication";
        const minutes =
          med?.prn_effectiveness_check_minutes != null && med.prn_effectiveness_check_minutes > 0
            ? med.prn_effectiveness_check_minutes
            : DEFAULT_PRN_REASSESS_MINUTES;
        const dueAt = prnReassessmentDueAt(row.actual_time, med?.prn_effectiveness_check_minutes ?? null);
        const overdue = now > dueAt.getTime();
        const res = resById.get(row.resident_id);
        const administeredBy = row.administered_by;
        const canDocument = canUpdateAnyEmarRecord(role) || administeredBy === user.id;
        display.push({
          id: row.id,
          residentId: row.resident_id,
          name: res?.displayName ?? "Resident",
          room: res?.roomLabel ?? "—",
          med: medName,
          givenLabel: formatShortDateTime(row.actual_time),
          reassessLabel: formatShortDateTime(dueAt.toISOString()),
          status: overdue ? "overdue" : "due",
          canDocument,
          minutes,
        });
      }
      setRows(display);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load PRN follow-ups.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveEffectiveness(emarId: string) {
    if (!userId) return;
    setSavingId(emarId);
    setLoadError(null);
    try {
      const upd = await supabase
        .from("emar_records")
        .update({
          prn_effectiveness_checked: true,
          prn_effectiveness_time: new Date().toISOString(),
          prn_effectiveness_result: result,
          prn_effectiveness_notes: effNotes.trim() || null,
          updated_by: userId,
        })
        .eq("id", emarId);
      if (upd.error) throw upd.error;
      setOpenId(null);
      setEffNotes("");
      setResult("effective");
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not save reassessment.");
    } finally {
      setSavingId(null);
    }
  }

  if (configError) {
    return (
      <div className="rounded-lg border border-amber-800/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">{configError}</div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading PRN follow-ups…
      </div>
    );
  }

  if (loadError && rows.length === 0) {
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
            <Pill className="h-5 w-5 text-violet-400" />
            PRN follow-up
          </CardTitle>
          <CardDescription className="text-zinc-400">
            PRN administrations that still need an effectiveness check (per order window, default {DEFAULT_PRN_REASSESS_MINUTES}{" "}
            min).
          </CardDescription>
        </CardHeader>
      </Card>

      {loadError ? (
        <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-2 text-xs text-amber-100">{loadError}</div>
      ) : null}

      {rows.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
          <CardContent className="py-8 text-center text-sm text-zinc-400">No pending PRN reassessments.</CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card key={r.id} className="border-zinc-800 bg-zinc-950/60 text-zinc-100">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
                <div className="flex flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.med}</span>
                    <Badge
                      className={
                        r.status === "overdue"
                          ? "border-rose-800/60 bg-rose-950/40 text-rose-200"
                          : "border-amber-800/60 bg-amber-950/40 text-amber-200"
                      }
                    >
                      {r.status === "overdue" ? "Overdue reassess" : "Reassess pending"}
                    </Badge>
                  </div>
                  <p className="text-xs text-zinc-400">
                    {r.name} · Room {r.room}
                  </p>
                  <p className="flex items-center gap-1 text-xs text-zinc-300">
                    <Activity className="h-3.5 w-3.5 text-zinc-500" />
                    Given {r.givenLabel} · Target by {r.reassessLabel} ({r.minutes} min window)
                  </p>
                  {!r.canDocument ? (
                    <p className="text-xs text-zinc-500">
                      Only the administering staff or a nurse can document effectiveness for this dose.
                    </p>
                  ) : null}
                  {r.canDocument && openId === r.id ? (
                    <div className="mt-2 space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-zinc-400">Effectiveness</Label>
                        <select
                          className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 text-sm text-zinc-100"
                          value={result}
                          onChange={(e) => setResult(e.target.value)}
                        >
                          <option value="effective">Effective</option>
                          <option value="partial">Partial</option>
                          <option value="ineffective">Ineffective</option>
                          <option value="not_assessed">Not assessed</option>
                        </select>
                      </div>
                      <textarea
                        rows={2}
                        placeholder="Optional notes"
                        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100"
                        value={effNotes}
                        onChange={(e) => setEffNotes(e.target.value)}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={savingId === r.id}
                          className="bg-violet-600 text-white hover:bg-violet-500"
                          onClick={() => void saveEffectiveness(r.id)}
                        >
                          {savingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          Save
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setOpenId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {r.canDocument && openId !== r.id ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-1 w-fit border-zinc-700 text-zinc-200"
                      onClick={() => {
                        setOpenId(r.id);
                        setResult("effective");
                        setEffNotes("");
                      }}
                    >
                      Document reassessment
                    </Button>
                  ) : null}
                </div>
                <Link
                  href={`/caregiver/meds`}
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "icon" }),
                    "shrink-0 self-end text-zinc-400 hover:text-white sm:self-start",
                  )}
                  aria-label="Open eMAR"
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
