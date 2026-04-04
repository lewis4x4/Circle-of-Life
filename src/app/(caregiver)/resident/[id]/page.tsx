"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, Check, Droplets, HeartPulse, Loader2, Pill, Plus, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { zonedYmd } from "@/lib/caregiver/emar-queue";
import { currentShiftForTimezone } from "@/lib/caregiver/shift";
import type { CaregiverResidentProfile, RiskBanner } from "@/lib/caregiver/resident-profile";
import { fetchCaregiverResidentProfile } from "@/lib/caregiver/resident-profile";
import type { Database } from "@/types/database";

function zonedTimeShort(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

export default function CaregiverResidentQuickProfilePage() {
  const params = useParams<{ id: string }>();
  const residentId = params?.id ?? "unknown";
  const supabase = useMemo(() => createClient(), []);

  const [profile, setProfile] = useState<CaregiverResidentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [vitalAlerts, setVitalAlerts] = useState<
    { id: string; vital_type: string; recorded_value: number; threshold_value: number; direction: string }[]
  >([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchCaregiverResidentProfile(supabase, residentId);
      if (!result.ok) {
        setError(result.error);
      } else {
        setProfile(result.profile);
        const va = await supabase
          .from("vital_sign_alerts")
          .select("id, vital_type, recorded_value, threshold_value, direction")
          .eq("resident_id", residentId)
          .is("deleted_at", null)
          .eq("status", "open");
        if (va.error) {
          console.warn("[caregiver resident] vital_sign_alerts", va.error.message);
          setVitalAlerts([]);
        } else {
          setVitalAlerts((va.data ?? []) as never);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load resident profile");
    } finally {
      setLoading(false);
    }
  }, [supabase, residentId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="space-y-3 py-12 text-center">
        <p className="text-sm text-red-400">{error ?? "Resident not found"}</p>
        <Button variant="outline" size="sm" onClick={() => { void load(); }}>Retry</Button>
      </div>
    );
  }

  const p = profile;
  const acuityTone = p.acuityLevel?.includes("3")
    ? "danger"
    : p.acuityLevel?.includes("2")
      ? "warning"
      : "neutral";

  const medsTone = p.scheduledMedsDueNow > 0 ? "warning" : "success";
  const moodTone = p.recentDailyLogMood?.toLowerCase().includes("anxious") ||
    p.recentDailyLogMood?.toLowerCase().includes("restless")
    ? "warning"
    : "success";

  return (
    <div className="space-y-4">
      {vitalAlerts.length > 0 && (
        <div className="rounded-lg border border-rose-800/80 bg-rose-950/50 px-3 py-2 text-sm text-rose-100">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
            <div>
              {vitalAlerts.map((a) => (
                <p key={a.id}>
                  {a.vital_type.replace(/_/g, " ")} is {a.recorded_value} — exceeds threshold {a.threshold_value} (
                  {a.direction}). Notify nurse.
                </p>
              ))}
            </div>
          </div>
        </div>
      )}
      <Card className="border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900 text-zinc-100">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-xl font-display">{p.displayName}</CardTitle>
              <CardDescription className="text-zinc-400">
                {p.roomLabel} · {p.status === "hospital_hold" ? "Hospital Hold" : p.primaryDiagnosis ?? ""}
              </CardDescription>
            </div>
            {p.fallRiskLevel === "high" && (
              <Badge className="border-rose-700 bg-rose-900/40 text-rose-200">High fall risk</Badge>
            )}
            {p.fallRiskLevel === "moderate" && (
              <Badge className="border-amber-700 bg-amber-900/40 text-amber-200">Fall risk</Badge>
            )}
            {p.elopementRisk && (
              <Badge className="border-rose-700 bg-rose-900/40 text-rose-200">Elopement risk</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-xs">
          <MetricPill label="Acuity" value={p.acuityLevel ?? "—"} tone={acuityTone} />
          <MetricPill
            label="Meds Due"
            value={p.scheduledMedsDueNow > 0 ? `${p.scheduledMedsDueNow} now` : "None"}
            tone={medsTone}
          />
          <MetricPill label="Active Meds" value={String(p.activeMedCount)} tone="neutral" />
          <MetricPill
            label="Mood"
            value={p.recentDailyLogMood ?? "—"}
            tone={moodTone}
          />
        </CardContent>
      </Card>

      {p.riskBanners.length > 0 && (
        <Card className="border-amber-900/60 bg-amber-950/20 text-zinc-100">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Risk Banners
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {p.riskBanners.map((banner: RiskBanner, i: number) => (
              <BannerRow key={`${banner.title}-${i}`} {...banner} />
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Shift Actions</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2">
          <ActionLink
            href="/caregiver/meds"
            icon={<Pill className="h-4 w-4" />}
            label="Open eMAR"
          />
          <ActionLink
            href={`/caregiver/resident/${residentId}/adl`}
            icon={<CalendarClock className="h-4 w-4" />}
            label="ADL"
          />
          <ActionLink
            href={`/caregiver/resident/${residentId}/log`}
            icon={<HeartPulse className="h-4 w-4" />}
            label="Shift log"
          />
          <ActionLink
            href={`/caregiver/resident/${residentId}/behavior`}
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Behavior"
          />
          <ActionLink
            href={`/caregiver/resident/${residentId}/condition-change`}
            icon={<Droplets className="h-4 w-4" />}
            label="Condition change"
          />
        </CardContent>
      </Card>

      {!noteOpen ? (
        <Button
          type="button"
          className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-500"
          onClick={() => { setNoteOpen(true); setNoteSaved(false); }}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Quick Add Note
        </Button>
      ) : (
        <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
          <CardContent className="space-y-3 pt-4">
            {noteSaved ? (
              <div className="flex items-center gap-2 text-sm text-emerald-400">
                <Check className="h-4 w-4" />
                Note saved to daily log.
              </div>
            ) : null}
            <textarea
              rows={3}
              autoFocus
              placeholder="Objective, brief note…"
              className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={noteSaving || !noteDraft.trim()}
                className="h-9 bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50"
                onClick={() => { void saveQuickNote(); }}
              >
                {noteSaving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-9 text-zinc-400 hover:text-white"
                onClick={() => { setNoteOpen(false); setNoteDraft(""); setNoteSaved(false); }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  async function saveQuickNote() {
    if (!noteDraft.trim()) return;
    setNoteSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("Session expired."); return; }

      const fcResult = await loadCaregiverFacilityContext(supabase);
      if (!fcResult.ok) { setError(fcResult.error); return; }
      const fc = fcResult.ctx;

      const tz = fc.timeZone;
      const ymd = zonedYmd(new Date(), tz);
      const shift = currentShiftForTimezone(tz);
      const stamp = zonedTimeShort(new Date(), tz);
      const line = `[${stamp}] ${noteDraft.trim()}`;

      const existing = await supabase
        .from("daily_logs")
        .select("id, general_notes")
        .eq("resident_id", residentId)
        .eq("facility_id", fc.facilityId)
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
          .update({ general_notes: next, updated_by: user.id } as never)
          .eq("id", (existing.data as { id: string }).id);
        if (upd.error) throw upd.error;
      } else {
        const ins: Database["public"]["Tables"]["daily_logs"]["Insert"] = {
          resident_id: residentId,
          facility_id: fc.facilityId,
          organization_id: fc.organizationId,
          log_date: ymd,
          shift,
          logged_by: user.id,
          general_notes: line,
          created_by: user.id,
        };
        const { error: insErr } = await supabase.from("daily_logs").insert(ins);
        if (insErr) throw insErr;
      }

      setNoteDraft("");
      setNoteSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save note.");
    } finally {
      setNoteSaving(false);
    }
  }
}

function MetricPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "warning" | "danger" | "success";
}) {
  const toneClass =
    tone === "danger"
      ? "border-rose-800/60 bg-rose-950/30"
      : tone === "warning"
        ? "border-amber-800/60 bg-amber-950/30"
        : tone === "success"
          ? "border-emerald-800/60 bg-emerald-950/30"
          : "border-zinc-800 bg-zinc-900/80";

  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function BannerRow({
  title,
  detail,
  tone,
}: {
  title: string;
  detail: string;
  tone: "warning" | "danger" | "ok";
}) {
  const toneClass =
    tone === "danger"
      ? "border-rose-800/70 bg-rose-950/20"
      : tone === "warning"
        ? "border-amber-800/70 bg-amber-950/20"
        : "border-emerald-800/60 bg-emerald-950/20";

  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <p className="inline-flex items-center gap-1 text-sm font-medium text-zinc-100">
        <ShieldCheck className="h-4 w-4 text-zinc-400" />
        {title}
      </p>
      <p className="mt-1 text-xs text-zinc-400">{detail}</p>
    </div>
  );
}

function ActionLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
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
