"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Pill, Utensils } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { liquidFormVsThickenedFluidsHint, solidOralFormVsTextureModifiedFoodHint } from "@/lib/dietary/med-fluid-diet-hints";

type DietRow = Database["public"]["Tables"]["diet_orders"]["Row"] & {
  residents: { first_name: string; last_name: string; id: string } | null;
};

type MedRow = Database["public"]["Tables"]["resident_medications"]["Row"];

function formatEnumLabel(s: string): string {
  return String(s ?? "not assessed").replace(/_/g, " ");
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
      <></>

      <div className="relative z-10 space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end justify-between bg-card p-8 rounded-[var(--radius)] border border-border shadow-sm mt-4">
          <div className="space-y-2">
            
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
              Diet order and medications
            </h1>
            <p className="mt-1 font-medium tracking-wide text-muted-foreground max-w-2xl text-sm">
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
          <p className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-warning">
            Select a facility to load data.
          </p>
        )}

        {error && (
          <p className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 px-6 py-4 text-sm text-destructive">
            {error}
          </p>
        )}

        {facilityReady && !loadingDiet && residentsOptions.length === 0 && (
          <p className="rounded-[var(--radius)] border border-border bg-muted px-6 py-4 text-sm text-muted-foreground">
            No diet orders in this facility batch. Add a diet order first, then return here.
          </p>
        )}

        {facilityReady && (loadingDiet || residentsOptions.length > 0) && (
          <div className="space-y-4">
            <label className="block max-w-md">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 block">
                Resident
              </span>
              <select
                className={cn(
                  "w-full rounded-[var(--radius)] border border-border bg-background",
                  "px-4 py-3 text-sm font-medium text-foreground shadow-sm",
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
                className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-5 py-4 text-sm text-warning"
                role="status"
              >
                <p className="font-semibold">Review: liquid-form medications vs thickened fluids</p>
                {primaryOrder ? (
                  <p className="text-[11px] font-medium mt-1">
                    Primary order fluid (IDDSI): {formatEnumLabel(primaryOrder.iddsi_fluid_level)}
                  </p>
                ) : null}
                <p className="mt-1">
                  Diet lists modified/thickened fluids, but these active medications have a liquid-like dosage form
                  string. Confirm appropriateness (e.g. thickening, alternate formulation) with pharmacy — advisory
                  only, not a clinical determination.
                </p>
                <ul className="mt-2 list-disc pl-5 space-y-0.5">
                  {thickenedFluidLiquidHint.matches.map((m) => (
                    <li key={m.id}>
                      <span className="font-medium">{m.medication_name}</span>
                      {m.form?.trim() ? <span> — {m.form}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selectedResidentId && solidOralTextureHint.show && (
              <div
                className="rounded-[var(--radius)] border border-info/30 bg-info/10 px-5 py-4 text-sm text-info"
                role="status"
              >
                <p className="font-semibold">Review: solid oral forms vs texture-modified diet</p>
                {primaryOrder ? (
                  <p className="text-[11px] font-medium mt-1">
                    Primary order food (IDDSI): {formatEnumLabel(primaryOrder.iddsi_food_level)}
                  </p>
                ) : null}
                <p className="mt-1">
                  Diet lists IDDSI texture-modified foods (liquidized through soft bite–sized), but these active
                  medications have a solid oral dosage form string (e.g. tablet, capsule). Confirm crushing,
                  compounding, or alternatives with pharmacy — some products must not be altered; advisory only.
                </p>
                <ul className="mt-2 list-disc pl-5 space-y-0.5">
                  {solidOralTextureHint.matches.map((m) => (
                    <li key={m.id}>
                      <span className="font-medium">{m.medication_name}</span>
                      {m.form?.trim() ? <span> — {m.form}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {selectedResidentId && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                <section
                  className="rounded-[var(--radius)] border border-border bg-card p-6 shadow-sm"
                  aria-labelledby="diet-panel-title"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <Utensils className="h-5 w-5 text-info" />
                    <h2 id="diet-panel-title" className="text-sm font-bold uppercase tracking-wider text-foreground">
                      Diet order
                    </h2>
                  </div>
                  {!primaryOrder ? (
                    <p className="text-sm text-muted-foreground">No order found for this resident.</p>
                  ) : (
                    <dl className="space-y-3 text-sm">
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</dt>
                        <dd className="font-medium capitalize text-foreground">{primaryOrder.status}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Food (IDDSI)</dt>
                        <dd className="text-foreground">{formatEnumLabel(primaryOrder.iddsi_food_level)}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Fluids (IDDSI)</dt>
                        <dd className="text-foreground">{formatEnumLabel(primaryOrder.iddsi_fluid_level)}</dd>
                      </div>
                      {primaryOrder.allergy_constraints.length > 0 && (
                        <div>
                          <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Allergies</dt>
                          <dd className="text-foreground">{primaryOrder.allergy_constraints.join(", ")}</dd>
                        </div>
                      )}
                      {primaryOrder.texture_constraints.length > 0 && (
                        <div>
                          <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Texture constraints</dt>
                          <dd className="text-foreground">{primaryOrder.texture_constraints.join(", ")}</dd>
                        </div>
                      )}
                      {primaryOrder.requires_swallow_eval && (
                        <p className="rounded-[var(--radius)] bg-destructive/10 border border-destructive/30 px-3 py-2 text-destructive text-xs font-medium">
                          Swallow evaluation flagged.
                        </p>
                      )}
                      {primaryOrder.medication_texture_review_notes?.trim() && (
                        <div>
                          <dt className="text-[10px] font-bold uppercase tracking-wider text-info">
                            Med / texture review
                          </dt>
                          <dd className="text-foreground whitespace-pre-wrap">
                            {primaryOrder.medication_texture_review_notes}
                          </dd>
                        </div>
                      )}
                      {primaryOrder.aspiration_notes?.trim() && (
                        <div>
                          <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Aspiration notes</dt>
                          <dd className="text-foreground whitespace-pre-wrap">{primaryOrder.aspiration_notes}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                </section>

                <section
                  className="rounded-[var(--radius)] border border-border bg-card p-6 shadow-sm"
                  aria-labelledby="meds-panel-title"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <Pill className="h-5 w-5 text-info" />
                    <h2 id="meds-panel-title" className="text-sm font-bold uppercase tracking-wider text-foreground">
                      Resident medications
                    </h2>
                  </div>
                  {loadingMeds ? (
                    <p className="text-sm text-muted-foreground font-medium">Loading medications…</p>
                  ) : meds.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No medication orders on file for this resident.</p>
                  ) : (
                    <ul className="space-y-3 max-h-[min(70vh,520px)] overflow-y-auto pr-1">
                      {meds.map((m) => (
                        <li
                          key={m.id}
                          className="flex items-center gap-3 min-h-[36px] px-[13px] py-2 rounded-[9px] border border-border bg-card hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]"
                        >
                          <div className="flex flex-1 flex-wrap items-baseline justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground">{m.medication_name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {[m.strength, m.form, formatEnumLabel(m.route)].filter(Boolean).join(" · ")}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {formatEnumLabel(m.frequency)}
                                {m.instructions?.trim() ? ` — ${m.instructions}` : ""}
                              </p>
                            </div>
                            <StatusPill
                              tone={
                                m.status === "active" || m.status === "discontinued"
                                  ? "neutral"
                                  : "warning"
                              }
                              className="shrink-0"
                            >
                              {m.status.replace(/_/g, " ")}
                            </StatusPill>
                          </div>
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
