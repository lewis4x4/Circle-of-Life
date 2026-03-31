"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Bath, CheckCircle2, Loader2 } from "lucide-react";

import { ADL_OPTIONS, ASSIST_OPTIONS, adlTypeLabel, assistanceLabel } from "@/lib/caregiver/adl-form-options";
import { fetchDailyLogIdForAdlLink } from "@/lib/caregiver/daily-log-link";
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

type AdlRow = Pick<
  Database["public"]["Tables"]["adl_logs"]["Row"],
  "id" | "log_time" | "log_date" | "shift" | "adl_type" | "assistance_level" | "refused" | "notes"
>;

export default function CaregiverResidentAdlPage() {
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
  const [rows, setRows] = useState<AdlRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [adlType, setAdlType] = useState("rounding");
  const [assistance, setAssistance] = useState<Database["public"]["Enums"]["assistance_level"]>("supervision");
  const [refused, setRefused] = useState(false);
  const [notes, setNotes] = useState("");

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
        setRows([]);
        setLoading(false);
        return;
      }
      const display =
        resRow.preferred_name?.trim() ||
        [resRow.first_name, resRow.last_name].filter(Boolean).join(" ").trim() ||
        "Resident";
      setResidentLabel(display);

      const adlQ = await supabase
        .from("adl_logs")
        .select("id, log_time, log_date, shift, adl_type, assistance_level, refused, notes")
        .eq("resident_id", residentId)
        .eq("facility_id", c.facilityId)
        .is("deleted_at", null)
        .order("log_time", { ascending: false })
        .limit(25);
      if (adlQ.error) throw adlQ.error;
      setRows((adlQ.data ?? []) as AdlRow[]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load ADL history.");
      setResidentLabel(null);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, residentId, idOk]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitAdl() {
    if (!ctx || !idOk) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoadError("Session expired. Sign in again.");
      return;
    }
    setSubmitting(true);
    setLoadError(null);
    try {
      const ymd = zonedYmd(new Date(), ctx.timeZone);
      const shift = currentShiftForTimezone(ctx.timeZone);
      const dailyLogId = await fetchDailyLogIdForAdlLink(supabase, {
        residentId,
        facilityId: ctx.facilityId,
        logDate: ymd,
        shift,
        loggedBy: user.id,
      });
      const row: Database["public"]["Tables"]["adl_logs"]["Insert"] = {
        resident_id: residentId,
        facility_id: ctx.facilityId,
        organization_id: ctx.organizationId,
        daily_log_id: dailyLogId,
        log_date: ymd,
        log_time: new Date().toISOString(),
        shift,
        logged_by: user.id,
        adl_type: adlType,
        assistance_level: assistance,
        refused,
        refusal_reason: refused ? "Documented on floor device" : null,
        notes: notes.trim() || null,
        detail_data: {},
      };
      const ins = await supabase.from("adl_logs").insert(row);
      if (ins.error) throw ins.error;
      setNotes("");
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not log ADL.");
    } finally {
      setSubmitting(false);
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
        Loading ADL…
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
            <Bath className="h-5 w-5 text-sky-400" />
            ADL
          </CardTitle>
          <CardDescription className="text-zinc-400">
            {residentLabel ? (
              <>
                Log ADL passes for <span className="text-zinc-200">{residentLabel}</span>
                {ctx ? (
                  <>
                    {" "}
                    · today ({zonedYmd(new Date(), ctx.timeZone)}) · shift{" "}
                    <span className="text-zinc-200">{currentShiftForTimezone(ctx.timeZone)}</span>
                  </>
                ) : null}
              </>
            ) : (
              "Document ADL passes against facility-local date and shift."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ctx && residentLabel ? (
            <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">ADL</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-100"
                    value={adlType}
                    onChange={(e) => setAdlType(e.target.value)}
                  >
                    {ADL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">Assistance</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-100"
                    value={assistance}
                    onChange={(e) => setAssistance(e.target.value as Database["public"]["Enums"]["assistance_level"])}
                  >
                    {ASSIST_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-zinc-600 bg-zinc-900"
                  checked={refused}
                  onChange={(e) => setRefused(e.target.checked)}
                />
                Refused / deferred
              </label>
              <textarea
                rows={2}
                placeholder="Optional note"
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <Button
                type="button"
                disabled={submitting}
                className="h-10 w-full bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-50"
                onClick={() => void submitAdl()}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                Log ADL pass
              </Button>
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Recent entries</p>
            {rows.length === 0 ? (
              <p className="text-sm text-zinc-400">No ADL rows yet for this resident.</p>
            ) : (
              <ul className="space-y-2">
                {rows.map((row) => (
                  <li key={row.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm">
                    <p className="font-medium text-zinc-100">
                      {adlTypeLabel(row.adl_type)}
                      <span className="font-normal text-zinc-500"> · </span>
                      <span className="text-zinc-300">{assistanceLabel(row.assistance_level)}</span>
                      {row.refused ? <span className="text-amber-400"> · refused</span> : null}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {new Date(row.log_time).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {row.shift} · {row.log_date}
                    </p>
                    {row.notes?.trim() ? <p className="mt-2 text-xs text-zinc-400">{row.notes}</p> : null}
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
