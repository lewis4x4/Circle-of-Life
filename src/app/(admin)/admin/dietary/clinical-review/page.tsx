"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Pill, Utensils } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { liquidFormVsThickenedFluidsHint, solidOralFormVsTextureModifiedFoodHint } from "@/lib/dietary/med-fluid-diet-hints";

type DietRow = Database["public"]["Tables"]["diet_orders"]["Row"] & {
  residents: { first_name: string; last_name: string; id: string } | null;
};

type MedRow = Database["public"]["Tables"]["resident_medications"]["Row"];

function formatEnumLabel(s: string): string {
  return s.replace(/_/g, " ");
}

function pickPrimaryDietOrder(orders: DietRow[]): DietRow | null {
  if (orders.length === 0) return null;
  const rank = (st: DietRow["status"]) => (st === "active" ? 0 : st === "draft" ? 1 : 2);
  return [...orders].sort((a, b) => {
    const d = rank(a.status) - rank(b.status);
    if (d !== 0) return d;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  })[0];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function DietaryClinicalReviewPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const { selectedFacilityId } = useFacilityStore();
  const [dietRows, setDietRows] = useState<DietRow[]>([]);
  const [meds, setMeds] = useState<MedRow[]>([]);
  const [loadingDiet, setLoadingDiet] = useState(true);
  const [loadingMeds, setLoadingMeds] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedResidentId, setSelectedResidentId] = useState<string | null>(null);

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  const loadDiet = useCallback(async () => {
    setLoadingDiet(true);
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setDietRows([]);
      setLoadingDiet(false);
      return;
    }
    try {
      const { data, error: qErr } = await supabase
        .from("diet_orders")
        .select("*, residents(id, first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(200);
      if (qErr) throw qErr;
      setDietRows((data ?? []) as DietRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load diet orders.");
      setDietRows([]);
    } finally {
      setLoadingDiet(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void loadDiet();
  }, [loadDiet]);

  const residentsOptions = useMemo(() => {
    const byRes = new Map<string, { id: string; name: string }>();
    for (const row of dietRows) {
      const id = row.resident_id;
      if (byRes.has(id)) continue;
      const name = row.residents
        ? `${row.residents.first_name} ${row.residents.last_name}`.trim()
        : "Resident";
      byRes.set(id, { id, name });
    }
    return [...byRes.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [dietRows]);

  const ordersForSelected = useMemo(() => {
    if (!selectedResidentId) return [];
    return dietRows.filter((r) => r.resident_id === selectedResidentId);
  }, [dietRows, selectedResidentId]);

  const primaryOrder = useMemo(() => pickPrimaryDietOrder(ordersForSelected), [ordersForSelected]);

  const thickenedFluidLiquidHint = useMemo(() => {
    if (!primaryOrder) {
      return { show: false as const, matches: [] as { id: string; medication_name: string; form: string | null }[] };
    }
    return liquidFormVsThickenedFluidsHint(primaryOrder.iddsi_fluid_level, meds);
  }, [primaryOrder, meds]);

  const solidOralTextureHint = useMemo(() => {
    if (!primaryOrder) {
      return { show: false as const, matches: [] as { id: string; medication_name: string; form: string | null }[] };
    }
    return solidOralFormVsTextureModifiedFoodHint(primaryOrder.iddsi_food_level, meds);
  }, [primaryOrder, meds]);

  useEffect(() => {
    if (residentsOptions.length === 0) return;
    const q = searchParams.get("resident")?.trim();
    if (q && UUID_RE.test(q) && residentsOptions.some((o) => o.id === q)) {
      setSelectedResidentId(q);
      return;
    }
    if (residentsOptions.length === 1) {
      setSelectedResidentId((prev) => prev ?? residentsOptions[0].id);
    }
  }, [searchParams, residentsOptions]);

  useEffect(() => {
    if (!selectedResidentId || !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setMeds([]);
      return;
    }
    let cancelled = false;
    setLoadingMeds(true);
    void (async () => {
      try {
        const { data, error: mErr } = await supabase
          .from("resident_medications")
          .select("*")
          .eq("resident_id", selectedResidentId)
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("medication_name", { ascending: true });
        if (mErr) throw mErr;
        if (!cancelled) setMeds((data ?? []) as MedRow[]);
      } catch {
        if (!cancelled) setMeds([]);
      } finally {
        if (!cancelled) setLoadingMeds(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, selectedResidentId, selectedFacilityId]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <AmbientMatrix hasCriticals={false} primaryClass="bg-indigo-700/10" secondaryClass="bg-blue-900/10" />

      <div className="relative z-10 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
              SYS: Module 14 — Clinical review
            </div>
            <h1 className="font-display text-3xl md:text-4xl font-light tracking-tight text-slate-900 dark:text-white">
              Diet order and medications
            </h1>
            <p className="mt-1 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl text-sm">
              Read-only side-by-side view for nursing and kitchen alignment. Automated hints flag only obvious
              data-pattern cases (liquid vs thickened fluids; solid unit doses vs texture-modified diets IDDSI 3–6);
              pharmacy and prescriber confirmation still required.
            </p>
          </div>
          <Link
            href="/admin/dietary"
            className={cn(
              buttonVariants({ variant: "outline", size: "default" }),
              "h-11 rounded-full gap-2 border-slate-200 dark:border-white/10",
            )}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to hub
          </Link>
        </div>

        {!facilityReady && (
          <p className="rounded-[1.5rem] border border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
            Select a facility to load data.
          </p>
        )}

        {error && (
          <p className="rounded-[1.5rem] border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
            {error}
          </p>
        )}

        {facilityReady && !loadingDiet && residentsOptions.length === 0 && (
          <p className="rounded-[1.5rem] border border-slate-200 bg-slate-50 px-6 py-4 text-sm text-slate-700 dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-200">
            No diet orders in this facility batch. Add a diet order first, then return here.
          </p>
        )}

        {facilityReady && (loadingDiet || residentsOptions.length > 0) && (
          <div className="space-y-4">
            <label className="block max-w-md">
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 mb-2 block">
                Resident
              </span>
              <select
                className={cn(
                  "w-full rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950/50",
                  "px-4 py-3 text-sm font-medium text-slate-900 dark:text-slate-100 shadow-sm",
                )}
                value={selectedResidentId ?? ""}
                disabled={loadingDiet}
                onChange={(e) => setSelectedResidentId(e.target.value || null)}
              >
                <option value="">{loadingDiet ? "Loading…" : "Select a resident"}</option>
                {residentsOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>

            {selectedResidentId && thickenedFluidLiquidHint.show && (
              <div
                className="rounded-[1.5rem] border border-amber-300/80 bg-amber-50/90 dark:border-amber-800/60 dark:bg-amber-950/35 px-5 py-4 text-sm text-amber-950 dark:text-amber-100"
                role="status"
              >
                <p className="font-semibold text-amber-950 dark:text-amber-50">Review: liquid-form medications vs thickened fluids</p>
                {primaryOrder ? (
                  <p className="text-[11px] font-mono mt-1 text-amber-800/85 dark:text-amber-300/90">
                    Primary order fluid (IDDSI): {formatEnumLabel(primaryOrder.iddsi_fluid_level)}
                  </p>
                ) : null}
                <p className="mt-1 text-amber-900/90 dark:text-amber-200/95">
                  Diet lists modified/thickened fluids, but these active medications have a liquid-like dosage form
                  string. Confirm appropriateness (e.g. thickening, alternate formulation) with pharmacy — advisory
                  only, not a clinical determination.
                </p>
                <ul className="mt-2 list-disc pl-5 space-y-0.5 text-amber-950/90 dark:text-amber-100/95">
                  {thickenedFluidLiquidHint.matches.map((m) => (
                    <li key={m.id}>
                      <span className="font-medium">{m.medication_name}</span>
                      {m.form?.trim() ? <span className="text-amber-800/95 dark:text-amber-200/90"> — {m.form}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selectedResidentId && solidOralTextureHint.show && (
              <div
                className="rounded-[1.5rem] border border-violet-300/80 bg-violet-50/90 dark:border-violet-800/60 dark:bg-violet-950/35 px-5 py-4 text-sm text-violet-950 dark:text-violet-100"
                role="status"
              >
                <p className="font-semibold text-violet-950 dark:text-violet-50">Review: solid oral forms vs texture-modified diet</p>
                {primaryOrder ? (
                  <p className="text-[11px] font-mono mt-1 text-violet-800/85 dark:text-violet-300/90">
                    Primary order food (IDDSI): {formatEnumLabel(primaryOrder.iddsi_food_level)}
                  </p>
                ) : null}
                <p className="mt-1 text-violet-900/90 dark:text-violet-200/95">
                  Diet lists IDDSI texture-modified foods (liquidized through soft bite–sized), but these active
                  medications have a solid oral dosage form string (e.g. tablet, capsule). Confirm crushing,
                  compounding, or alternatives with pharmacy — some products must not be altered; advisory only.
                </p>
                <ul className="mt-2 list-disc pl-5 space-y-0.5 text-violet-950/90 dark:text-violet-100/95">
                  {solidOralTextureHint.matches.map((m) => (
                    <li key={m.id}>
                      <span className="font-medium">{m.medication_name}</span>
                      {m.form?.trim() ? <span className="text-violet-800/95 dark:text-violet-200/90"> — {m.form}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selectedResidentId && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                <section
                  className="rounded-[2rem] border border-slate-200/80 dark:border-white/10 bg-white/80 dark:bg-white/[0.04] p-6 shadow-sm"
                  aria-labelledby="diet-panel-title"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <Utensils className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                    <h2 id="diet-panel-title" className="text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
                      Diet order
                    </h2>
                  </div>
                  {!primaryOrder ? (
                    <p className="text-sm text-slate-600 dark:text-slate-400">No order found for this resident.</p>
                  ) : (
                    <dl className="space-y-3 text-sm">
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Status</dt>
                        <dd className="font-medium capitalize text-slate-900 dark:text-slate-100">{primaryOrder.status}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Food (IDDSI)</dt>
                        <dd className="text-slate-800 dark:text-slate-200">{formatEnumLabel(primaryOrder.iddsi_food_level)}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Fluids (IDDSI)</dt>
                        <dd className="text-slate-800 dark:text-slate-200">{formatEnumLabel(primaryOrder.iddsi_fluid_level)}</dd>
                      </div>
                      {primaryOrder.allergy_constraints.length > 0 && (
                        <div>
                          <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Allergies</dt>
                          <dd className="text-slate-800 dark:text-slate-200">{primaryOrder.allergy_constraints.join(", ")}</dd>
                        </div>
                      )}
                      {primaryOrder.texture_constraints.length > 0 && (
                        <div>
                          <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Texture constraints</dt>
                          <dd className="text-slate-800 dark:text-slate-200">{primaryOrder.texture_constraints.join(", ")}</dd>
                        </div>
                      )}
                      {primaryOrder.requires_swallow_eval && (
                        <p className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 px-3 py-2 text-rose-900 dark:text-rose-100 text-xs font-medium">
                          Swallow evaluation flagged.
                        </p>
                      )}
                      {primaryOrder.medication_texture_review_notes?.trim() && (
                        <div>
                          <dt className="text-[10px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400">
                            Med / texture review
                          </dt>
                          <dd className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                            {primaryOrder.medication_texture_review_notes}
                          </dd>
                        </div>
                      )}
                      {primaryOrder.aspiration_notes?.trim() && (
                        <div>
                          <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Aspiration notes</dt>
                          <dd className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{primaryOrder.aspiration_notes}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                </section>

                <section
                  className="rounded-[2rem] border border-slate-200/80 dark:border-white/10 bg-white/80 dark:bg-white/[0.04] p-6 shadow-sm"
                  aria-labelledby="meds-panel-title"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <Pill className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                    <h2 id="meds-panel-title" className="text-sm font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
                      Resident medications
                    </h2>
                  </div>
                  {loadingMeds ? (
                    <p className="text-sm text-slate-500 font-mono">Loading medications…</p>
                  ) : meds.length === 0 ? (
                    <p className="text-sm text-slate-600 dark:text-slate-400">No medication orders on file for this resident.</p>
                  ) : (
                    <ul className="space-y-3 max-h-[min(70vh,520px)] overflow-y-auto pr-1">
                      {meds.map((m) => (
                        <li
                          key={m.id}
                          className="rounded-xl border border-slate-200/60 dark:border-white/5 bg-slate-50/80 dark:bg-slate-900/30 px-4 py-3"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p className="font-semibold text-slate-900 dark:text-slate-100">{m.medication_name}</p>
                            <span
                              className={cn(
                                "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md shrink-0",
                                m.status === "active"
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                                  : m.status === "discontinued"
                                    ? "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                                    : "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
                              )}
                            >
                              {m.status.replace(/_/g, " ")}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                            {[m.strength, m.form, formatEnumLabel(m.route)].filter(Boolean).join(" · ")}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">
                            {formatEnumLabel(m.frequency)}
                            {m.instructions?.trim() ? ` — ${m.instructions}` : ""}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
