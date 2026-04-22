"use client";

/**
 * AI Safety Insights Dashboard
 * Shows Claude-generated clinical patterns and early warnings per resident.
 */

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Brain, AlertTriangle, TrendingUp, TrendingDown, Eye, CheckCircle, XCircle, Loader2, Sparkles, Mic } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { cn } from "@/lib/utils";

interface InsightRow {
  id: string;
  resident_id: string;
  facility_id: string;
  insight_type: string;
  severity: string;
  title: string;
  body: string | null;
  clinical_domains: string[];
  status: string;
  ai_model: string | null;
  created_at: string;
  residents?: { first_name: string; last_name: string } | null;
  facilities?: { name: string } | null;
}

const TYPE_ICONS: Record<string, typeof Brain> = {
  pattern_detected: Eye,
  risk_escalation: AlertTriangle,
  intervention_needed: AlertTriangle,
  decline_observed: TrendingDown,
  positive_trend: TrendingUp,
};

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/20" },
  high: { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/20" },
  medium: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/20" },
  low: { bg: "bg-sky-500/10", text: "text-sky-400", border: "border-sky-500/20" },
};

export default function InsightsPage() {
  const supabase = createClient() as unknown as SupabaseClient;
  const [rows, setRows] = useState<InsightRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "new" | "acknowledged">("all");
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);

      let query = supabase
        .from("resident_safety_insights")
        .select("*, residents(first_name, last_name), facilities(name)")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(100);

      if (filter !== "all") query = query.eq("status", filter);

      const { data, error: qErr } = await query;
      if (qErr) throw qErr;
      setRows((data ?? []) as InsightRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load insights");
    } finally {
      setLoading(false);
    }
  }, [supabase, filter]);

  useEffect(() => { void load(); }, [load]);

  async function runAnalysis() {
    setRunning(true);
    setRunMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/rounding/insights/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxResidents: 25 }),
      });
      const json = (await res.json()) as { error?: string; residentsAnalyzed?: number; insightsGenerated?: number; alertsCreated?: number };
      if (!res.ok) throw new Error(json.error ?? "Could not run analysis");
      setRunMessage(
        `Analyzed ${json.residentsAnalyzed ?? 0} residents · ${json.insightsGenerated ?? 0} insight(s) generated · ${json.alertsCreated ?? 0} alert(s) created.`,
      );
      await load();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to run resident assurance AI.");
    } finally {
      setRunning(false);
    }
  }

  const updateStatus = async (id: string, status: string) => {
    const { error: uErr } = await supabase
      .from("resident_safety_insights")
      .update({
        status,
        ...(status === "acknowledged" ? { acknowledged_at: new Date().toISOString() } : {}),
        ...(status === "acted_on" ? { acted_on_at: new Date().toISOString() } : {}),
      })
      .eq("id", id);
    if (!uErr) void load();
  };

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full">
      <AmbientMatrix primaryClass="bg-violet-900/5" secondaryClass="bg-indigo-900/5" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <Link href="/admin/rounding" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Rounding Hub
        </Link>

        <header className="flex items-center gap-3 border-b border-white/10 pb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-indigo-600/20 border border-violet-500/20 flex items-center justify-center">
            <Brain className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">AI Safety Insights</h1>
            <p className="text-sm text-slate-400">Claude-powered clinical pattern detection and early warnings</p>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
            <p className="text-[10px] uppercase font-mono tracking-widest text-violet-300">Insight backlog</p>
            <p className="mt-2 text-3xl font-semibold text-white">{rows.length}</p>
            <p className="mt-1 text-xs text-slate-400">Current resident safety insights in scope</p>
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
            <p className="text-[10px] uppercase font-mono tracking-widest text-amber-300">New patterns</p>
            <p className="mt-2 text-3xl font-semibold text-white">{rows.filter((row) => row.status === "new").length}</p>
            <p className="mt-1 text-xs text-slate-400">Unacknowledged findings from the latest runs</p>
          </div>
          <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4">
            <p className="text-[10px] uppercase font-mono tracking-widest text-sky-300">Voice & AI lane</p>
            <p className="mt-2 flex items-center gap-2 text-sm text-white">
              <Mic className="h-4 w-4 text-sky-300" />
              Voice check-off now feeds this safety model.
            </p>
            <p className="mt-1 text-xs text-slate-400">Run a manual analysis after a shift surge or incident cluster.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void runAnalysis()}
            disabled={running}
            className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-violet-200 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {running ? "Running analysis" : "Run analysis"}
          </button>
          {runMessage ? <p className="text-sm text-emerald-300">{runMessage}</p> : null}
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          {(["all", "new", "acknowledged"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={cn(
              "px-4 py-1.5 rounded-full text-xs font-semibold transition-all",
              filter === f ? "bg-white/10 text-white" : "text-slate-400 hover:text-white"
            )}>{f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}</button>
          ))}
        </div>

        {error && <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl p-4">{error}</p>}

        {loading && <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 text-violet-400 animate-spin" /></div>}

        {/* Insight Cards */}
        {!loading && (
          <div className="space-y-4">
            {rows.length === 0 && (
              <div className="text-center py-16 text-slate-500">
                <Brain className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p className="text-sm">No AI insights generated yet. The assurance AI runs daily to analyze clinical patterns.</p>
              </div>
            )}

            {rows.map(r => {
              const sev = SEVERITY_STYLES[r.severity] ?? SEVERITY_STYLES.medium;
              const Icon = TYPE_ICONS[r.insight_type] ?? Eye;
              const name = r.residents ? `${r.residents.first_name} ${r.residents.last_name}` : r.resident_id.slice(0, 8);

              return (
                <div key={r.id} className={cn("rounded-2xl border p-5 space-y-3", sev.bg, sev.border)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", sev.bg)}>
                        <Icon className={cn("w-4 h-4", sev.text)} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{r.title}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {name} · {r.facilities?.name ?? ""} · {new Date(r.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={cn("text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full", sev.bg, sev.text)}>
                        {r.severity}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">{r.insight_type.replace(/_/g, " ")}</span>
                    </div>
                  </div>

                  {r.body && <p className="text-xs text-slate-300 leading-relaxed">{r.body}</p>}

                  {r.clinical_domains.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {r.clinical_domains.map(d => (
                        <span key={d} className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-white/5 text-slate-400 border border-white/5">
                          {d.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  )}

                  {r.status === "new" && (
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => void updateStatus(r.id, "acknowledged")} className="text-[10px] font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Acknowledge
                      </button>
                      <button onClick={() => void updateStatus(r.id, "acted_on")} className="text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Mark Acted On
                      </button>
                      <button onClick={() => void updateStatus(r.id, "dismissed")} className="text-[10px] font-semibold text-slate-500 hover:text-slate-300 flex items-center gap-1">
                        <XCircle className="w-3 h-3" /> Dismiss
                      </button>
                    </div>
                  )}

                  {r.ai_model && <p className="text-[9px] text-slate-600 font-mono">Model: {r.ai_model}</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
