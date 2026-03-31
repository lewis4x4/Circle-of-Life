"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, FileText, Loader2 } from "lucide-react";

import { adlTypeLabel, assistanceLabel } from "@/lib/caregiver/adl-form-options";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { zonedYmd } from "@/lib/caregiver/emar-queue";
import { currentShiftForTimezone } from "@/lib/caregiver/shift";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type DailyRow = Pick<
  Database["public"]["Tables"]["daily_logs"]["Row"],
  "id" | "log_date" | "shift" | "general_notes" | "logged_by"
>;
type AdlRow = Pick<
  Database["public"]["Tables"]["adl_logs"]["Row"],
  "id" | "log_time" | "log_date" | "shift" | "adl_type" | "assistance_level" | "refused" | "notes"
>;

function zonedTimeShort(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

export default function CaregiverResidentLogPage() {
  const params = useParams<{ id: string }>();
  const residentId = params?.id ?? "";
  const supabase = useMemo(() => createClient(), []);

  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<{
    facilityId: string;
    organizationId: string;
    facilityName: string | null;
    timeZone: string;
  } | null>(null);
  const [residentLabel, setResidentLabel] = useState<string | null>(null);
  const [dailyHistory, setDailyHistory] = useState<DailyRow[]>([]);
  const [adlRecent, setAdlRecent] = useState<AdlRow[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const idOk = isValidFacilityIdForQuery(residentId);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setConfigError(null);
    if (!idOk) {
      setLoading(false);
      return;
    }
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
      const c = resolved.ctx;
      setCtx(c);

      const resQ = await supabase
        .from("residents")
        .select("id, facility_id, first_name, last_name, preferred_name")
        .eq("id", residentId)
        .is("deleted_at", null)
        .maybeSingle();
      if (resQ.error) throw resQ.error;
      const resRow = resQ.data as
        | {
            id: string;
            facility_id: string;
            first_name: string;
            last_name: string;
            preferred_name: string | null;
          }
        | null;
      if (!resRow || resRow.facility_id !== c.facilityId) {
        setLoadError("This resident is not in your current facility scope.");
        setResidentLabel(null);
        setDailyHistory([]);
        setAdlRecent([]);
        setLoading(false);
        return;
      }
      const display =
        resRow.preferred_name?.trim() ||
        [resRow.first_name, resRow.last_name].filter(Boolean).join(" ").trim() ||
        "Resident";
      setResidentLabel(display);

      const [dailyQ, adlQ] = await Promise.all([
        supabase
          .from("daily_logs")
          .select("id, log_date, shift, general_notes, logged_by")
          .eq("resident_id", residentId)
          .eq("facility_id", c.facilityId)
          .is("deleted_at", null)
          .order("log_date", { ascending: false })
          .limit(14),
        supabase
          .from("adl_logs")
          .select("id, log_time, log_date, shift, adl_type, assistance_level, refused, notes")
          .eq("resident_id", residentId)
          .eq("facility_id", c.facilityId)
          .is("deleted_at", null)
          .order("log_time", { ascending: false })
          .limit(12),
      ]);
      if (dailyQ.error) throw dailyQ.error;
      if (adlQ.error) throw adlQ.error;
      setDailyHistory((dailyQ.data ?? []) as DailyRow[]);
      setAdlRecent((adlQ.data ?? []) as AdlRow[]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load shift log.");
      setResidentLabel(null);
      setDailyHistory([]);
      setAdlRecent([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, residentId, idOk]);

  useEffect(() => {
    void load();
  }, [load]);

  async function appendShiftNote() {
    if (!ctx || !idOk || !noteDraft.trim()) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoadError("Session expired. Sign in again.");
      return;
    }
    setSavingNote(true);
    setLoadError(null);
    try {
      const ymd = zonedYmd(new Date(), ctx.timeZone);
      const shift = currentShiftForTimezone(ctx.timeZone);
      const stamp = zonedTimeShort(new Date(), ctx.timeZone);
      const line = `[${stamp}] ${noteDraft.trim()}`;

      const existing = await supabase
        .from("daily_logs")
        .select("id, general_notes")
        .eq("resident_id", residentId)
        .eq("facility_id", ctx.facilityId)
        .eq("log_date", ymd)
        .eq("shift", shift)
        .eq("logged_by", user.id)
        .is("deleted_at", null)
        .maybeSingle();

      if (existing.error) throw existing.error;

      if (existing.data) {
        const prev = (existing.data as { id: string; general_notes: string | null }).general_notes?.trim() ?? "";
        const next = prev ? `${prev}\n${line}` : line;
        const upd = await supabase
          .from("daily_logs")
          .update({ general_notes: next, updated_by: user.id })
          .eq("id", (existing.data as { id: string }).id);
        if (upd.error) throw upd.error;
      } else {
        const ins: Database["public"]["Tables"]["daily_logs"]["Insert"] = {
          resident_id: residentId,
          facility_id: ctx.facilityId,
          organization_id: ctx.organizationId,
          log_date: ymd,
          shift,
          logged_by: user.id,
          general_notes: line,
        };
        const insQ = await supabase.from("daily_logs").insert(ins);
        if (insQ.error) throw insQ.error;
      }
      setNoteDraft("");
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not save shift note.");
    } finally {
      setSavingNote(false);
    }
  }

  if (!idOk) {
    return (
      <div className="space-y-4">
        <Link
          href="/caregiver"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1 text-zinc-400 hover:text-white")}
        >
          <ArrowLeft className="h-4 w-4" />
          Shift home
        </Link>
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">
          Invalid resident identifier.
        </div>
      </div>
    );
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
        Loading shift log…
      </div>
    );
  }

  if (loadError && !ctx) {
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
      <Link
        href={`/caregiver/resident/${residentId}`}
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1 text-zinc-400 hover:text-white")}
      >
        <ArrowLeft className="h-4 w-4" />
        Resident
      </Link>

      {loadError ? (
        <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-2 text-xs text-amber-100">{loadError}</div>
      ) : null}

      <Card className="border-zinc-800 bg-zinc-950/80 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg font-display">
            <FileText className="h-5 w-5 text-teal-400" />
            Shift log
          </CardTitle>
          <CardDescription className="text-zinc-400">
            {residentLabel ? (
              <>
                Narrative for <span className="text-zinc-200">{residentLabel}</span>
                {ctx ? (
                  <>
                    {" "}
                    · today ({zonedYmd(new Date(), ctx.timeZone)}) · shift{" "}
                    <span className="text-zinc-200">{currentShiftForTimezone(ctx.timeZone)}</span>
                  </>
                ) : null}
              </>
            ) : (
              "Narrative entries append to your daily log row for this shift."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-zinc-300">
          {ctx && residentLabel ? (
            <div className="space-y-2">
              <Label className="text-xs text-zinc-400">Add shift note</Label>
              <textarea
                rows={3}
                placeholder="Objective, brief narrative for this pass…"
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
              />
              <Button
                type="button"
                disabled={savingNote || !noteDraft.trim()}
                className="h-10 bg-teal-600 text-white hover:bg-teal-500 disabled:opacity-50"
                onClick={() => void appendShiftNote()}
              >
                {savingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save to daily log
              </Button>
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Recent daily notes</p>
            {dailyHistory.length === 0 ? (
              <p className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-zinc-400">No daily log rows yet.</p>
            ) : (
              <ul className="space-y-2">
                {dailyHistory.map((row) => (
                  <li key={row.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                    <p className="text-xs text-zinc-500">
                      {row.log_date} · {row.shift}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-zinc-200">{row.general_notes?.trim() || "—"}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2 border-t border-zinc-800 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Recent ADL passes</p>
            {adlRecent.length === 0 ? (
              <p className="text-xs text-zinc-500">No ADL documentation for this resident yet.</p>
            ) : (
              <ul className="space-y-2">
                {adlRecent.map((row) => (
                  <li key={row.id} className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-2 text-xs">
                    <span className="text-zinc-200">{adlTypeLabel(row.adl_type)}</span>
                    <span className="text-zinc-500"> · </span>
                    <span className="text-zinc-400">{assistanceLabel(row.assistance_level)}</span>
                    {row.refused ? <span className="text-amber-400"> · refused</span> : null}
                    <p className="mt-0.5 text-[10px] text-zinc-500">
                      {new Date(row.log_time).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {row.shift}
                    </p>
                    {row.notes?.trim() ? <p className="mt-1 text-zinc-400">{row.notes}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
