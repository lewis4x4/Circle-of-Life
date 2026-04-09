"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, CalendarClock, Check, Droplets, HeartPulse, Loader2, Pill, Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  fetchCaregiverResidentProfile,
  type CaregiverResidentProfile,
  type RiskBanner,
} from "@/lib/caregiver/resident-profile";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { zonedYmd } from "@/lib/caregiver/emar-queue";
import { currentShiftForTimezone } from "@/lib/caregiver/shift";
import { createClient } from "@/lib/supabase/client";
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
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {vitalAlerts.length > 0 && (
        <div className="rounded-[2xl] border border-rose-500/40 bg-gradient-to-r from-rose-500/20 to-rose-900/10 px-6 py-4 text-sm text-rose-100 shadow-[0_4px_30px_rgba(225,29,72,0.1)] backdrop-blur-xl">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0 border border-rose-500/40 mt-1">
               <AlertTriangle className="h-5 w-5 text-rose-400" />
            </div>
            <div className="flex-1">
              <h4 className="text-rose-300 font-display font-semibold tracking-wide text-lg mb-1">Vital Sign Alert</h4>
              {vitalAlerts.map((a) => (
                <p key={a.id} className="text-rose-200 mt-1 font-mono leading-relaxed">
                  <span className="font-bold text-white capitalize">{a.vital_type.replace(/_/g, " ")}</span> is <span className="font-bold text-rose-300">{a.recorded_value}</span> — exceeds threshold <span className="font-bold">{a.threshold_value}</span> ({a.direction}). Notify nurse immediately.
                </p>
              ))}
            </div>
          </div>
        </div>
      )}
      
      {/* ─── RESIDENT HEADER & METRICS ──────────────────────────────────────────── */}
      <div className="glass-panel p-8 md:p-10 rounded-[3rem] border border-white/5 bg-gradient-to-br from-indigo-950/40 via-slate-900/60 to-black/80 backdrop-blur-3xl shadow-2xl relative overflow-hidden z-10 w-full transition-all text-zinc-100">
         <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-[80px] -mr-16 -mt-16 pointer-events-none" />

         <div className="flex flex-col md:flex-row gap-8 relative z-10">
           <div className="flex-1">
              <div className="flex flex-wrap items-center gap-4 mb-3">
                 <h2 className="text-4xl md:text-5xl font-display font-semibold tracking-tight text-white mb-1">{p.displayName}</h2>
              </div>
              <p className="text-zinc-400 text-lg flex items-center gap-3 font-mono font-medium tracking-wide">
                <span className="bg-white/10 px-3 py-1 rounded-full text-white">{p.roomLabel}</span>
                <span className="opacity-50">|</span>
                {p.status === "hospital_hold" ? "Hospital Hold" : p.primaryDiagnosis ?? "No Primary Diagnosis"}
              </p>
              
              <div className="flex flex-wrap gap-2 mt-6">
                 {p.fallRiskLevel === "high" && (
                   <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-rose-500/40 bg-rose-500/20 text-[10px] uppercase tracking-widest font-mono font-bold text-rose-300 shadow-inner">
                     <AlertTriangle className="w-3.5 h-3.5" /> High Fall Risk
                   </span>
                 )}
                 {p.fallRiskLevel === "moderate" && (
                   <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber-500/40 bg-amber-500/20 text-[10px] uppercase tracking-widest font-mono font-bold text-amber-300 shadow-inner">
                     <AlertTriangle className="w-3.5 h-3.5" /> Fall Risk
                   </span>
                 )}
                 {p.elopementRisk && (
                   <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-rose-500/40 bg-rose-500/20 text-[10px] uppercase tracking-widest font-mono font-bold text-rose-300 shadow-inner">
                     <AlertTriangle className="w-3.5 h-3.5" /> Elopement Risk
                   </span>
                 )}
              </div>
           </div>
           
           <div className="grid grid-cols-2 gap-3 shrink-0 md:w-80">
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
           </div>
         </div>
      </div>

      {/* ─── RISK BANNERS ──────────────────────────────────────────────────────── */}
      {p.riskBanners.length > 0 && (
         <div className="glass-panel p-8 rounded-[2rem] border border-amber-500/30 bg-gradient-to-br from-amber-950/20 to-black/40 backdrop-blur-3xl shadow-[0_8px_32px_rgba(217,119,6,0.1)] relative w-full text-zinc-100">
           <h3 className="flex items-center gap-3 text-xl font-display font-semibold text-amber-300 tracking-wide mb-6">
              <AlertTriangle className="h-5 w-5" />
              Risk Considerations
           </h3>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {p.riskBanners.map((banner: RiskBanner, i: number) => (
                <BannerRow key={`${banner.title}-${i}`} {...banner} />
              ))}
           </div>
         </div>
      )}

      {/* ─── ACTION GRID ───────────────────────────────────────────────────────── */}
      <div className="glass-panel p-8 rounded-[2rem] border border-white/5 bg-white/[0.02] backdrop-blur-xl relative overflow-visible z-10 w-full transition-all text-zinc-100">
         <h4 className="text-xl font-display font-semibold text-white tracking-wide mb-6">Shift Actions</h4>
         <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            <ActionLink
              href="/caregiver/meds"
              icon={<Pill className="h-5 w-5 text-violet-400" />}
              label="Open eMAR"
            />
            <ActionLink
              href={`/caregiver/resident/${residentId}/adl`}
              icon={<CalendarClock className="h-5 w-5 text-emerald-400" />}
              label="ADL Queue"
            />
            <ActionLink
              href={`/caregiver/resident/${residentId}/log`}
              icon={<HeartPulse className="h-5 w-5 text-pink-400" />}
              label="Shift Log"
            />
            <ActionLink
              href={`/caregiver/resident/${residentId}/behavior`}
              icon={<AlertTriangle className="h-5 w-5 text-amber-400" />}
              label="Behavior"
            />
            <ActionLink
              href={`/caregiver/resident/${residentId}/condition-change`}
              icon={<Droplets className="h-5 w-5 text-teal-400" />}
              label="Condition"
            />
         </div>
      </div>

      {/* ─── QUICK NOTE ────────────────────────────────────────────────────────── */}
      <div className="mt-8">
         {!noteOpen ? (
           <Button
             type="button"
             className="w-full h-16 rounded-[1.5rem] flex items-center justify-center font-bold tracking-widest uppercase transition-all shadow-[0_4px_30px_rgba(16,185,129,0.15)] bg-gradient-to-r from-emerald-600 to-emerald-500 text-black hover:from-emerald-500 hover:to-emerald-400 tap-responsive text-sm font-mono border-0"
             onClick={() => { setNoteOpen(true); setNoteSaved(false); }}
           >
             <Plus className="mr-3 h-5 w-5" />
             Quick Note
           </Button>
         ) : (
           <div className="glass-panel p-6 rounded-[2rem] border border-emerald-500/30 bg-emerald-950/20 backdrop-blur-xl relative overflow-visible z-10 w-full transition-all text-zinc-100 shadow-[inset_0_0_20px_rgba(16,185,129,0.05)]">
               {noteSaved ? (
                 <div className="flex flex-col items-center justify-center py-6">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/40 mb-4">
                       <Check className="h-8 w-8 text-emerald-400" />
                    </div>
                    <p className="text-xl font-display text-emerald-300 font-semibold tracking-wide">Note Saved.</p>
                 </div>
               ) : (
                 <div className="space-y-4">
                     <p className="text-xs font-bold uppercase tracking-widest text-emerald-300/80 font-mono">Quick Shift Note for {p.displayName}</p>
                     <textarea
                       rows={4}
                       autoFocus
                       placeholder="Objective, brief observation..."
                       className="w-full resize-none appearance-none rounded-[1.2rem] border border-white/10 bg-black/60 p-5 text-[15px] leading-relaxed text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 shadow-inner placeholder:text-zinc-600 tap-responsive font-medium"
                       value={noteDraft}
                       onChange={(e) => setNoteDraft(e.target.value)}
                     />
                     <div className="flex gap-3 pt-2">
                       <Button
                         type="button"
                         disabled={noteSaving || !noteDraft.trim()}
                         className="flex-1 h-14 rounded-full font-mono uppercase tracking-widest text-xs px-8 shadow-lg transition-all hover:scale-[1.02] border-0 text-black font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 tap-responsive"
                         onClick={() => { void saveQuickNote(); }}
                       >
                         {noteSaving ? <Loader2 className="mr-3 h-5 w-5 animate-spin" /> : "Save"}
                       </Button>
                       <Button
                         type="button"
                         className="flex-[0.5] h-14 rounded-full font-mono uppercase tracking-widest text-xs px-8 transition-all border border-white/10 bg-black/40 text-zinc-300 hover:bg-white/10 hover:text-white tap-responsive shadow-inner font-bold"
                         onClick={() => { setNoteOpen(false); setNoteDraft(""); setNoteSaved(false); }}
                       >
                         Cancel
                       </Button>
                     </div>
                 </div>
               )}
           </div>
         )}
      </div>
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
      ? "bg-rose-500/10 border-rose-500/30 text-rose-300 shadow-[inset_0_0_15px_rgba(225,29,72,0.1)]"
      : tone === "warning"
        ? "bg-amber-500/10 border-amber-500/30 text-amber-300 shadow-[inset_0_0_15px_rgba(245,158,11,0.1)]"
        : tone === "success"
          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300 shadow-[inset_0_0_15px_rgba(16,185,129,0.1)]"
          : "bg-white/5 border-white/10 text-white shadow-inner";

  return (
    <div className={`rounded-2xl border px-4 py-3 flex flex-col justify-center min-h-[5rem] ${toneClass}`}>
      <p className="text-[9px] uppercase tracking-widest font-mono font-bold opacity-70 mb-1">{label}</p>
      <p className="text-2xl font-display font-semibold tracking-tight">{value}</p>
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
      ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
      : tone === "warning"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
        : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";

  return (
    <div className={`rounded-xl border p-4 ${toneClass} shadow-inner`}>
      <p className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-widest font-mono text-white mb-1">
        <ShieldCheck className="h-4 w-4" />
        {title}
      </p>
      <p className="text-xs leading-relaxed text-white/80 font-medium">{detail}</p>
    </div>
  );
}

function ActionLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/5 bg-black/40 p-4 text-zinc-100 transition-all hover:bg-white/10 hover:text-white tap-responsive shadow-inner aspect-square text-center"
    >
      <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center border border-white/10">
        {icon}
      </div>
      <span className="text-[10px] font-mono font-bold uppercase tracking-widest">{label}</span>
    </Link>
  );
}
