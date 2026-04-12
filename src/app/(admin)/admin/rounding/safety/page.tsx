"use client";

/**
 * Resident Safety Scores Dashboard
 * Shows composite safety scores per resident with risk tier distribution.
 */

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Shield, TrendingDown, TrendingUp, Minus, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { SafetyScoreBadge, scoreTier } from "@/components/rounding/SafetyScoreBadge";
import { cn } from "@/lib/utils";

interface ScoreRow {
  id: string;
  resident_id: string;
  facility_id: string;
  score: number;
  risk_tier: "low" | "moderate" | "high" | "critical";
  component_scores: Record<string, number>;
  previous_score: number | null;
  score_delta: number | null;
  computed_at: string;
  residents?: { first_name: string; last_name: string; room_number: string | null } | null;
  facilities?: { name: string } | null;
}

const TH = "text-left text-[10px] font-mono uppercase tracking-wider text-slate-400 px-3 py-2";
const TD = "px-3 py-2.5 text-sm text-slate-200";
const TR = "border-b border-white/5 hover:bg-white/[0.02] transition-colors";

export default function SafetyScoresPage() {
  const supabase = createClient() as unknown as SupabaseClient;
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);

      // Get latest score per resident using distinct on
      const { data, error: qErr } = await supabase
        .from("resident_safety_scores")
        .select("*, residents(first_name, last_name, room_number), facilities(name)")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .order("score", { ascending: true })
        .limit(200);

      if (qErr) throw qErr;
      setRows((data ?? []) as ScoreRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load safety scores");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  // Tier distribution
  const dist = { low: 0, moderate: 0, high: 0, critical: 0 };
  rows.forEach(r => { dist[r.risk_tier]++; });

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full">
      <AmbientMatrix primaryClass="bg-rose-900/5" secondaryClass="bg-teal-900/5" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <Link href="/admin/rounding" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Rounding Hub
        </Link>

        <header className="flex items-center gap-3 border-b border-white/10 pb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500/20 to-amber-500/20 border border-rose-500/20 flex items-center justify-center">
            <Shield className="w-5 h-5 text-rose-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Resident Safety Scores</h1>
            <p className="text-sm text-slate-400">Composite safety scores updated daily across all facilities</p>
          </div>
        </header>

        {/* Tier Distribution */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {(["critical", "high", "moderate", "low"] as const).map(tier => {
            const colors = {
              critical: "border-rose-500/20 bg-rose-500/5",
              high: "border-orange-500/20 bg-orange-500/5",
              moderate: "border-amber-500/20 bg-amber-500/5",
              low: "border-emerald-500/20 bg-emerald-500/5",
            };
            const textColors = { critical: "text-rose-400", high: "text-orange-400", moderate: "text-amber-400", low: "text-emerald-400" };
            return (
              <div key={tier} className={cn("rounded-2xl border p-5", colors[tier])}>
                <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400">{tier.toUpperCase()} RISK</p>
                <p className={cn("text-3xl font-bold mt-1 font-mono", textColors[tier])}>{dist[tier]}</p>
                <p className="text-xs text-slate-500 mt-1">residents</p>
              </div>
            );
          })}
        </div>

        {/* Error */}
        {error && <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl p-4">{error}</p>}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-teal-400 animate-spin" />
          </div>
        )}

        {/* Table */}
        {!loading && rows.length > 0 && (
          <div className="rounded-2xl border border-white/5 bg-slate-900/50 backdrop-blur p-6 shadow-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className={TH}>Resident</th>
                    <th className={TH}>Facility</th>
                    <th className={TH}>Room</th>
                    <th className={TH}>Score</th>
                    <th className={TH}>Trend</th>
                    <th className={TH}>Obs Compliance</th>
                    <th className={TH}>Incidents</th>
                    <th className={TH}>Med Adherence</th>
                    <th className={TH}>Last Computed</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const name = r.residents ? `${r.residents.last_name}, ${r.residents.first_name}` : r.resident_id.slice(0, 8);
                    const cs = r.component_scores as Record<string, number>;
                    return (
                      <tr key={r.id} className={TR}>
                        <td className={cn(TD, "font-medium")}>{name}</td>
                        <td className={cn(TD, "text-xs text-slate-400")}>{r.facilities?.name ?? "—"}</td>
                        <td className={cn(TD, "font-mono text-xs")}>{r.residents?.room_number ?? "—"}</td>
                        <td className={TD}><SafetyScoreBadge score={r.score} tier={r.risk_tier} size="sm" /></td>
                        <td className={TD}>
                          {r.score_delta != null ? (
                            <span className={cn("inline-flex items-center gap-1 text-xs font-mono",
                              r.score_delta > 0 ? "text-emerald-400" : r.score_delta < 0 ? "text-rose-400" : "text-slate-400"
                            )}>
                              {r.score_delta > 0 ? <TrendingUp className="w-3 h-3" /> : r.score_delta < 0 ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                              {r.score_delta > 0 ? "+" : ""}{r.score_delta}
                            </span>
                          ) : <span className="text-xs text-slate-500">—</span>}
                        </td>
                        <td className={cn(TD, "font-mono text-xs")}>{cs.observation_compliance?.toFixed(0) ?? "—"}%</td>
                        <td className={cn(TD, "font-mono text-xs")}>{cs.incident_recency?.toFixed(0) ?? "—"}</td>
                        <td className={cn(TD, "font-mono text-xs")}>{cs.medication_adherence?.toFixed(0) ?? "—"}%</td>
                        <td className={cn(TD, "text-xs text-slate-500")}>{new Date(r.computed_at).toLocaleDateString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && rows.length === 0 && !error && (
          <div className="text-center py-16 text-slate-500">
            <Shield className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-sm">No safety scores computed yet. Scores are generated daily by the resident-safety-scorer cron job.</p>
          </div>
        )}
      </div>
    </div>
  );
}
