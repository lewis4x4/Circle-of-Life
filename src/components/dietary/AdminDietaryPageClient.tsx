"use client";

import Link from "next/link";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { Utensils, Cookie } from "lucide-react";

import {
  SNACK_PASS_LIST_LOADING_MESSAGE,
  formatSnackPassPasserDisplay,
  snackPassRecentPreviewFootnote,
  snackPassRecentPreviewRows,
} from "@/lib/dietary/snack-pass-display-copy";
import {
  formatSnackPassLoggedAtEt,
  nowSnackPassDatetimeLocal,
  snackPassDatetimeLocalToUtcIso,
} from "@/lib/dietary/snack-pass-time";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

import { Button, buttonVariants } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { TableRow, TableRowHeader } from "@/components/ui/table-row";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { V2Card } from "@/components/ui/v2-card";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import {
  dietaryBatchStatBarWidthPct,
  formatDietaryBatchStatPct,
  formatDietaryHubRelativeUpdatedAt,
} from "@/lib/dietary/dietary-batch-stats-display-copy";
import {
  dietOrdersHubLoadCapNotice,
  formatDietaryHubResidentDisplay,
} from "@/lib/dietary/dietary-hub-display-copy";
import {
  loadDietaryHubBootstrap,
  type DietaryHubBootstrap,
  type DietaryHubDietRow as DietRow,
  type DietaryHubMealLogRow as MealLogRow,
  type DietaryHubResidentOption as ResidentOption,
  type DietaryHubSnackLogRow as SnackLogRow,
} from "@/lib/dietary/load-dietary-hub-bootstrap";

type DietOrderStatus = Database["public"]["Enums"]["diet_order_status"];

type MealLogStatus = MealLogRow["status"];
type MealLogType = MealLogRow["meal_type"];

const MEAL_TYPES: MealLogType[] = ["breakfast", "lunch", "dinner"];
const MEAL_STATUSES: MealLogStatus[] = ["ate", "partial", "refused", "out_of_facility", "not_observed"];
const MEAL_STATUS_LABELS: Record<MealLogStatus, string> = {
  ate: "Ate most/all",
  partial: "Ate some",
  refused: "Refused",
  out_of_facility: "Out of facility",
  not_observed: "Not observed",
};

export const SNACK_PASS_SECTION_ID = "snack-pass";

export const SNACK_PASS_HELPER_COPY =
  "Record when the snack round happened and who passed it. Facility-level only — time and passer, no snack contents or resident counts.";

const DIET_ORDER_STATUS_FILTERS: { value: "all" | DietOrderStatus; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "discontinued", label: "Discontinued" },
];

function fluidIsThickened(level: string): boolean {
  return level.includes("mildly") || level.includes("moderately") || level.includes("extremely");
}

function dietOrderNeedsAttention(row: DietRow): boolean {
  if (row.status === "draft") return true;
  if (row.requires_swallow_eval) return true;
  if (row.medication_texture_review_notes?.trim()) return true;
  return Boolean(row.aspiration_notes?.trim());
}

function attentionBadge(row: DietRow): { label: string; barClass: string; badgeClass: string } {
  if (row.status === "draft") {
    return {
      label: "Draft order",
      barClass: "bg-amber-500",
      badgeClass: "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20",
    };
  }
  if (row.requires_swallow_eval) {
    return {
      label: "Swallow eval",
      barClass: "bg-rose-500",
      badgeClass: "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20",
    };
  }
  if (row.medication_texture_review_notes?.trim()) {
    return {
      label: "Med / texture review",
      barClass: "bg-primary-500",
      badgeClass: "text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-500/10 border-primary-200 dark:border-primary-500/20",
    };
  }
  return {
    label: "Aspiration notes",
    barClass: "bg-orange-500",
    badgeClass: "text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/20",
  };
}

function attentionSummary(row: DietRow): string {
  const med = row.medication_texture_review_notes?.trim();
  if (med) return med;
  const note = row.aspiration_notes?.trim();
  if (note) return note;
  if (row.status === "draft") return "Diet order is still in draft and needs activation.";
  if (row.requires_swallow_eval) return "Marked for swallow evaluation follow-up.";
  return "Review diet order details.";
}

function buildDietOrdersCsv(rows: DietRow[]): string {
  const header = [
    "id",
    "organization_id",
    "facility_id",
    "resident_id",
    "resident_first_name",
    "resident_last_name",
    "status",
    "iddsi_food_level",
    "iddsi_fluid_level",
    "requires_swallow_eval",
    "allergy_constraints",
    "texture_constraints",
    "aspiration_notes",
    "medication_texture_review_notes",
    "effective_from",
    "effective_to",
    "created_at",
    "updated_at",
  ].join(",");
  const body = rows.map((row) => {
    const allergy = row.allergy_constraints?.join(" | ") ?? "";
    const texture = row.texture_constraints?.join(" | ") ?? "";
    return [
      csvEscapeCell(row.id),
      csvEscapeCell(row.organization_id),
      csvEscapeCell(row.facility_id),
      csvEscapeCell(row.resident_id),
      csvEscapeCell(row.residents?.first_name ?? ""),
      csvEscapeCell(row.residents?.last_name ?? ""),
      csvEscapeCell(row.status),
      csvEscapeCell(row.iddsi_food_level),
      csvEscapeCell(row.iddsi_fluid_level),
      csvEscapeCell(String(row.requires_swallow_eval)),
      csvEscapeCell(allergy),
      csvEscapeCell(texture),
      csvEscapeCell(row.aspiration_notes ?? ""),
      csvEscapeCell(row.medication_texture_review_notes ?? ""),
      csvEscapeCell(row.effective_from ?? ""),
      csvEscapeCell(row.effective_to ?? ""),
      csvEscapeCell(row.created_at),
      csvEscapeCell(row.updated_at),
    ].join(",");
  });
  return [header, ...body].join("\r\n");
}

export type AdminDietaryPageClientProps = {
  initialBootstrap: DietaryHubBootstrap;
  initialLoadError: string | null;
  initialFacilityId: string | null;
  serverBootstrapped?: boolean;
};

export function AdminDietaryPageClient({
  initialBootstrap,
  initialLoadError,
  initialFacilityId,
  serverBootstrapped = false,
}: AdminDietaryPageClientProps) {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const skipNextLoadRef = useRef(serverBootstrapped && initialLoadError == null);
  const snackPassSectionRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<DietRow[]>(initialBootstrap.rows);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialLoadError);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [dietOrderStatusFilter, setDietOrderStatusFilter] = useState<"all" | DietOrderStatus>("all");
  const [organizationId, setOrganizationId] = useState<string | null>(initialBootstrap.organizationId);
  const [residents, setResidents] = useState<ResidentOption[]>(initialBootstrap.residents);
  const [mealLogs, setMealLogs] = useState<MealLogRow[]>(initialBootstrap.mealLogs);
  const [snackLogs, setSnackLogs] = useState<SnackLogRow[]>(initialBootstrap.snackLogs);
  const [savingMeal, setSavingMeal] = useState(false);
  const [savingSnack, setSavingSnack] = useState(false);
  const [mealForm, setMealForm] = useState({
    resident_id: initialBootstrap.residents[0]?.id ?? "",
    meal_date: todayFacilityDateIso(),
    meal_type: "lunch" as MealLogType,
    status: "ate" as MealLogStatus,
    intake_percent: "100",
    notes: "",
  });
  const [snackForm, setSnackForm] = useState({
    snack_at: nowSnackPassDatetimeLocal(),
  });

  const applyBootstrap = useCallback((bootstrap: DietaryHubBootstrap) => {
    setRows(bootstrap.rows);
    setOrganizationId(bootstrap.organizationId);
    setResidents(bootstrap.residents);
    setMealLogs(bootstrap.mealLogs);
    setSnackLogs(bootstrap.snackLogs);
    if (bootstrap.residents.length > 0) {
      setMealForm((prev) => (prev.resident_id ? prev : { ...prev, resident_id: bootstrap.residents[0].id }));
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      applyBootstrap({
        rows: [],
        organizationId: null,
        residents: [],
        mealLogs: [],
        snackLogs: [],
      });
      setLoading(false);
      return;
    }
    try {
      const bootstrap = await loadDietaryHubBootstrap(selectedFacilityId, supabase);
      applyBootstrap(bootstrap);
    } catch (e) {
      setError(formatLiveDataLoadError(e, "Failed to load dietary data."));
      applyBootstrap({
        rows: [],
        organizationId: null,
        residents: [],
        mealLogs: [],
        snackLogs: [],
      });
    } finally {
      setLoading(false);
    }
  }, [applyBootstrap, selectedFacilityId, supabase]);

  useEffect(() => {
    if (skipNextLoadRef.current && selectedFacilityId === initialFacilityId) {
      skipNextLoadRef.current = false;
      return;
    }
    skipNextLoadRef.current = false;
    void load();
  }, [initialFacilityId, load, selectedFacilityId]);

  const exportDietOrdersCsv = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return;
    setExportingCsv(true);
    setError(null);
    try {
      let q = supabase
        .from("diet_orders")
        .select("*, residents(first_name, last_name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null);
      if (dietOrderStatusFilter !== "all") {
        q = q.eq("status", dietOrderStatusFilter);
      }
      const { data, error: qErr } = await q.order("updated_at", { ascending: false }).limit(500);
      if (qErr) throw qErr;
      const exportRows = (data ?? []) as DietRow[];
      const csv = buildDietOrdersCsv(exportRows);
      const scope = dietOrderStatusFilter === "all" ? "" : `_${dietOrderStatusFilter}`;
      triggerCsvDownload(`diet-orders_${format(new Date(), "yyyy-MM-dd")}${scope}.csv`, csv);
    } catch (e) {
      setError(e instanceof Error ? e.message : "CSV export failed.");
    } finally {
      setExportingCsv(false);
    }
  }, [selectedFacilityId, supabase, dietOrderStatusFilter]);

  const displayRows = useMemo(() => {
    if (dietOrderStatusFilter === "all") return rows;
    return rows.filter((r) => r.status === dietOrderStatusFilter);
  }, [rows, dietOrderStatusFilter]);

  const attentionRows = useMemo(
    () =>
      displayRows
        .filter(dietOrderNeedsAttention)
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [displayRows],
  );

  const attentionIds = useMemo(() => new Set(attentionRows.map((r) => r.id)), [attentionRows]);

  const rosterRows = useMemo(
    () => displayRows.filter((r) => !attentionIds.has(r.id)).slice(0, 8),
    [displayRows, attentionIds],
  );

  const batchStats = useMemo(() => {
    const n = displayRows.length;
    if (n === 0) {
      return { thickenedPct: 0, swallowPct: 0, allergyPct: 0, medTexturePct: 0 };
    }
    const thickened = displayRows.filter((r) => fluidIsThickened(r.iddsi_fluid_level)).length;
    const swallow = displayRows.filter((r) => r.requires_swallow_eval).length;
    const allergy = displayRows.filter((r) => r.allergy_constraints.length > 0).length;
    const medTexture = displayRows.filter((r) => r.medication_texture_review_notes?.trim()).length;
    return {
      thickenedPct: Math.round((thickened / n) * 100),
      swallowPct: Math.round((swallow / n) * 100),
      allergyPct: Math.round((allergy / n) * 100),
      medTexturePct: Math.round((medTexture / n) * 100),
    };
  }, [displayRows]);

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  useEffect(() => {
    if (!facilityReady || typeof window === "undefined") return;
    if (window.location.hash !== `#${SNACK_PASS_SECTION_ID}`) return;
    const section = snackPassSectionRef.current;
    if (!section) return;
    requestAnimationFrame(() => {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [facilityReady]);

  const saveMealLog = useCallback(async () => {
    if (!facilityReady || !selectedFacilityId || !organizationId || !mealForm.resident_id) return;
    setSavingMeal(true);
    setError(null);
    try {
      const intakeValue = mealForm.intake_percent.trim();
      const intakePercent = intakeValue === "" ? null : Number(intakeValue);
      if (intakePercent !== null && (!Number.isFinite(intakePercent) || intakePercent < 0 || intakePercent > 100)) {
        throw new Error("Intake percent must be between 0 and 100.");
      }
      const { error: insertErr } = await supabase.from("meal_logs" as never).upsert(({
        organization_id: organizationId,
        facility_id: selectedFacilityId,
        resident_id: mealForm.resident_id,
        meal_date: mealForm.meal_date,
        meal_type: mealForm.meal_type,
        status: mealForm.status,
        intake_percent: intakePercent,
        notes: mealForm.notes.trim() || null,
        deleted_at: null,
      }) as never, { onConflict: "resident_id,meal_date,meal_type" });
      if (insertErr) throw insertErr;
      setMealForm((prev) => ({ ...prev, notes: "" }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save meal log.");
    } finally {
      setSavingMeal(false);
    }
  }, [facilityReady, mealForm, organizationId, selectedFacilityId, supabase, load]);

  const saveSnackLog = useCallback(async () => {
    if (!facilityReady || !selectedFacilityId || !organizationId) return;
    setSavingSnack(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        throw new Error("Sign in to log a snack pass.");
      }
      let snackAtIso: string;
      try {
        snackAtIso = snackPassDatetimeLocalToUtcIso(snackForm.snack_at);
      } catch {
        throw new Error("Snack time is required.");
      }
      const { error: insertErr } = await supabase.from("snack_logs" as never).insert(({
        organization_id: organizationId,
        facility_id: selectedFacilityId,
        snack_at: snackAtIso,
        passed_by_user_id: user.id,
      }) as never);
      if (insertErr) throw insertErr;
      setSnackForm({ snack_at: nowSnackPassDatetimeLocal() });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save snack log.");
    } finally {
      setSavingSnack(false);
    }
  }, [facilityReady, organizationId, selectedFacilityId, snackForm, supabase, load]);

  const { appRole } = useHavenAuth();
  const canActivateOrder = ["owner", "org_admin", "facility_admin", "nurse"].includes(appRole ?? "");
  const [activatingId, setActivatingId] = useState<string | null>(null);
  async function activateOrder(row: DietRow) {
    if (!canActivateOrder || !globalThis.confirm("I have reviewed this diet order against the prescriber's instructions, IDDSI levels and allergies. Activate it and supersede the resident's previous active order?")) return;
    setActivatingId(row.id); setError(null);
    try {
      const { error: activationError } = await supabase.rpc("activate_reviewed_diet_order" as never, { p_id: row.id, p_expected_updated_at: row.updated_at } as never);
      if (activationError) throw new Error(activationError.message);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Order was not activated."); }
    finally { setActivatingId(null); }
  }

  const snackPreviewFootnote = snackPassRecentPreviewFootnote(snackLogs.length);
  const dietOrderLoadCapNotice = dietOrdersHubLoadCapNotice(rows.length);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        {canActivateOrder && rows.some((row) => row.status === "draft") && <section className="rounded-lg border border-border p-4 space-y-3" aria-label="Diet orders awaiting clinical review">
          <h2 className="font-semibold">Draft orders awaiting clinical review</h2>
          {rows.filter((row) => row.status === "draft").map((row) => <div key={row.id} className="flex items-center justify-between gap-3">
            <span>{row.residents?.first_name} {row.residents?.last_name} · Food {String(row.iddsi_food_level ?? "not assessed")} · {row.iddsi_fluid_level} · Allergies: {row.allergy_constraints?.join(", ") || "none recorded"}</span>
            <Button size="sm" disabled={activatingId !== null} onClick={() => void activateOrder(row)}>Reviewed — activate order</Button>
          </div>)}
        </section>}

        
        {/* ─── MOONSHOT HEADER ─── */}
        <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-slate-200/50 dark:border-white/5 shadow-sm mt-4">
           <div className="space-y-2">
             
             <h1 className="text-4xl md:text-2xl font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
                Dietary & Nutrition
             </h1>
             <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
               IDDSI food and fluid levels with allergy constraints. Manage therapeutic diet orders across your facility.
               {rows.length > 0 && (
                 <span className="block mt-1 text-xs">
                   Showing {displayRows.length} of {rows.length} loaded order{rows.length === 1 ? "" : "s"}
                   {dietOrderStatusFilter !== "all" ? ` (${dietOrderStatusFilter})` : ""}.
                 </span>
               )}
               {dietOrderLoadCapNotice ? (
                 <span className="block mt-1 text-xs">{dietOrderLoadCapNotice}</span>
               ) : null}
             </p>
           </div>
           <div className="flex flex-wrap items-center gap-3 justify-end">
              <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="whitespace-nowrap font-bold uppercase tracking-wider">Status</span>
                <select
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-white/15 dark:bg-white/5 dark:text-slate-100"
                  value={dietOrderStatusFilter}
                  onChange={(e) =>
                    setDietOrderStatusFilter(e.target.value as "all" | DietOrderStatus)
                  }
                  aria-label="Filter diet orders by status"
                >
                  {DIET_ORDER_STATUS_FILTERS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={!facilityReady || exportingCsv}
                className="h-9 rounded-lg px-4 font-bold uppercase tracking-wider text-[10px] border-slate-200 dark:border-white/10"
                onClick={() => void exportDietOrdersCsv()}
              >
                {exportingCsv ? "Preparing…" : "Download diet orders CSV"}
              </Button>
              <Link
                href="/admin/dietary/clinical-review"
                className={cn(
                  buttonVariants({ variant: "outline", size: "default" }),
                  "h-9 px-4 rounded-lg font-bold uppercase tracking-wider text-[10px] border-slate-200 dark:border-white/10",
                )}
              >
                Med / diet review
              </Link>
              <Link href="/admin/dietary/new" className={cn(buttonVariants({ size: "default" }), "h-9 px-6 rounded-lg font-bold uppercase tracking-wide text-xs tap-responsive bg-primary-600 hover:bg-primary-700 text-white")} >
                + New Diet Order
              </Link>
           </div>
        </div>

        <KineticGrid className="grid-cols-1 md:grid-cols-3 gap-4 mb-6" staggerMs={75}>
          <div className="h-[160px] md:col-span-3">
            <V2Card hoverColor="indigo" className="border-primary-500/20 dark:border-primary-500/20 shadow-[0_8px_30px_rgba(99,102,241,0.05)]">
              <MonolithicWatermark value={displayRows.length} className="text-info/10 opacity-50" />
              <div className="relative z-10 flex flex-col h-full justify-between p-2">
                <h3 className="text-[11px] font-bold tracking-wider uppercase text-primary-600 dark:text-primary-400 flex items-center gap-2">
                  <Utensils className="h-4 w-4" /> Active Diet Orders
                </h3>
                <p className="text-2xl tracking-tight font-medium text-primary-600 dark:text-primary-400 pb-1">{displayRows.length}</p>
              </div>
            </V2Card>
          </div>
        </KineticGrid>

      {!facilityReady && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100 shadow-sm font-medium">
          Select a facility to load diet orders.
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100 shadow-sm font-medium">
          {error}
        </p>
      )}

      {facilityReady && (
        <>
          <section
            id={SNACK_PASS_SECTION_ID}
            ref={snackPassSectionRef}
            aria-labelledby="snack-pass-heading"
            className="scroll-mt-24 rounded-lg border border-primary-200/70 bg-primary-50/40 p-6 shadow-sm dark:border-primary-500/20 dark:bg-primary-950/20"
          >
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-4 lg:max-w-xl">
                <div className="space-y-2">
                  <h2
                    id="snack-pass-heading"
                    className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white flex items-center gap-2"
                  >
                    <Cookie className="h-5 w-5 text-primary-600 dark:text-primary-400" aria-hidden />
                    Snack pass
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-300">{SNACK_PASS_HELPER_COPY}</p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="flex flex-1 flex-col gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                    Pass time (ET)
                    <input
                      type="datetime-local"
                      value={snackForm.snack_at}
                      onChange={(e) => setSnackForm((prev) => ({ ...prev, snack_at: e.target.value }))}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-100"
                      aria-label="Snack pass time (Eastern Time)"
                    />
                  </label>
                  <Button
                    type="button"
                    size="default"
                    disabled={savingSnack}
                    className="h-10 shrink-0 rounded-lg px-6 font-semibold"
                    onClick={() => void saveSnackLog()}
                  >
                    {savingSnack ? "Saving…" : "Log snack pass"}
                  </Button>
                </div>
              </div>

              <div className="w-full lg:max-w-md">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-3">
                  Recent snack passes
                </p>
                {loading ? (
                  <p className="text-xs text-muted-foreground">{SNACK_PASS_LIST_LOADING_MESSAGE}</p>
                ) : snackLogs.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                    No snack passes logged yet for this facility.
                  </p>
                ) : (
                  <>
                    <ul className="space-y-2">
                      {snackPassRecentPreviewRows(snackLogs).map((log) => (
                        <li key={log.id} className="rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-xs text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
                          <span className="font-medium">{formatSnackPassLoggedAtEt(log.snack_at)} ET</span>
                          <span className="text-muted-foreground"> · Snack passed — </span>
                          <span>{formatSnackPassPasserDisplay(log.user_profiles?.full_name)}</span>
                        </li>
                      ))}
                    </ul>
                    {snackPreviewFootnote ? (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {snackPreviewFootnote}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* ACTION QUEUE: Dietary Risk Board */}
          <div className="col-span-1 lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between pb-2">
              <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-2">
                <></> Attention Queue
              </h3>
            </div>
            
            <MotionList className="space-y-4">
              {loading ? (
                <p className="text-sm font-mono text-slate-500">Loading…</p>
              ) : rows.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground bg-muted rounded-lg border border-dashed border-border">
                   <p className="font-semibold text-lg text-foreground">No diet orders</p>
                  <p className="text-sm opacity-80 mt-1">No active diet orders for this facility yet.</p>
                </div>
              ) : displayRows.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground bg-muted rounded-lg border border-dashed border-border">
                  <p className="font-semibold text-lg text-foreground">No orders match this status</p>
                  <p className="text-sm opacity-80 mt-1">Try &quot;All statuses&quot; or another filter.</p>
                </div>
              ) : attentionRows.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground bg-muted rounded-lg border border-dashed border-border">
                  <p className="font-semibold text-lg text-foreground">All Clear</p>
                  <p className="text-sm opacity-80 mt-1">
                    No draft orders, swallow-evaluation flags, med/texture review notes, or aspiration notes in this batch.
                  </p>
                </div>
              ) : (
                attentionRows.map((row) => {
                  const badge = attentionBadge(row);
                  return (
                    <MotionItem
                      key={row.id}
                      className="relative overflow-hidden flex items-center gap-3 min-h-[36px] rounded-lg border border-border bg-card px-[13px] py-2 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:-translate-y-0.5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 group tap-responsive"
                    >
                      <div className={cn("absolute top-0 left-0 w-1.5 h-full", badge.barClass)} />
                      <div className="flex justify-between items-start mb-4 gap-2 pl-2">
                        <span
                          className={cn(
                            "text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider border",
                            badge.badgeClass,
                          )}
                        >
                          {badge.label}
                        </span>
                        <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                          Updated: {formatDietaryHubRelativeUpdatedAt(row.updated_at)}
                        </span>
                      </div>
                      <div className="mb-5 pl-2">
                        <p className="text-xl font-semibold text-slate-900 dark:text-slate-100 tracking-tight mb-2">
                          {formatDietaryHubResidentDisplay(row.residents?.first_name, row.residents?.last_name)}
                        </p>
                        <p className="text-sm font-medium text-slate-600 dark:text-slate-400">{attentionSummary(row)}</p>
                      </div>
                      <div className="flex justify-start pl-2 mt-2">
                        <Link
                          href={`/admin/dietary/clinical-review?resident=${row.resident_id}`}
                          className={cn(
                            buttonVariants({ variant: "default", size: "sm" }),
                            "h-9 rounded-lg px-4 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-black dark:hover:bg-slate-200 font-semibold text-[10px]",
                          )}
                        >
                          Clinical review
                        </Link>
                      </div>
                    </MotionItem>
                  );
                })
              )}
            </MotionList>

            {!loading && displayRows.length > 0 && rosterRows.length > 0 && (
              <div className="mt-10 p-6 rounded-lg border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.015]">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500 mb-4 ml-2">Other Active Diet Orders</h4>
                <div className="rounded-lg border border-border bg-card overflow-hidden">
                  <TableRowHeader>
                    <span className="flex-[2] min-w-0">Resident</span>
                    <span className="flex-1 min-w-0">Food</span>
                    <span className="flex-1 min-w-0">Fluids</span>
                    <span className="w-[110px] shrink-0 text-right">Fluid status</span>
                  </TableRowHeader>
                  <MotionList className="space-y-1 p-1">
                    {rosterRows.map((row) => (
                      <MotionItem key={row.id}>
                        <TableRow>
                          <span className="flex-[2] min-w-0 text-[13px] font-medium text-foreground truncate">
                            {formatDietaryHubResidentDisplay(row.residents?.first_name, row.residents?.last_name)}
                          </span>
                          <span className="flex-1 min-w-0 text-[12px] text-muted-foreground capitalize truncate">
                            {String(row.iddsi_food_level ?? "not assessed").replace(/_/g, " ")}
                          </span>
                          <span className="flex-1 min-w-0 text-[12px] text-muted-foreground capitalize truncate">
                            {row.iddsi_fluid_level.replace(/_/g, " ")}
                          </span>
                          <span className="w-[110px] shrink-0 flex justify-end">
                            {fluidIsThickened(row.iddsi_fluid_level) ? (
                              <StatusPill tone="warning">Thickened</StatusPill>
                            ) : (
                              <StatusPill tone="muted">Standard</StatusPill>
                            )}
                          </span>
                        </TableRow>
                      </MotionItem>
                    ))}
                  </MotionList>
                </div>
              </div>
            )}
            
          </div>

          {/* WATCHLIST: Kitchen Operations Context */}
          <div className="col-span-1 border-l border-transparent dark:border-transparent lg:pl-6 pt-6 lg:pt-0">
            <div className="p-6 rounded-lg border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02]">
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200 dark:border-white/5">
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                  Therapeutic Context
                </h3>
              </div>
              
              <div className="space-y-4">
                <div className="p-5 rounded-lg border border-slate-200/80 dark:border-white/10 bg-white flex flex-col gap-3 shadow-sm">
                  <div className="flex justify-between items-center">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Thickened Fluids</p>
                    <span className="text-xs font-bold text-amber-500 bg-amber-50 dark:bg-amber-500/10 px-2 py-0.5 rounded-md">
                      {formatDietaryBatchStatPct("thickened", batchStats.thickenedPct, loading)}
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800/60 rounded-full h-2 overflow-hidden shadow-inner">
                    <div
                      className="bg-amber-500 h-2 rounded-full transition-all duration-1000 ease-out"
                      style={{ width: `${dietaryBatchStatBarWidthPct(batchStats.thickenedPct, loading)}%` }}
                    />
                  </div>
                </div>
                
                <div className="p-5 rounded-lg border border-slate-200/80 dark:border-white/10 bg-white flex flex-col gap-3 shadow-sm">
                  <div className="flex justify-between items-center">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Swallow Flags</p>
                    <span className="text-xs font-bold text-rose-500 bg-rose-50 dark:bg-rose-500/10 px-2 py-0.5 rounded-md">
                      {formatDietaryBatchStatPct("swallow", batchStats.swallowPct, loading)}
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800/60 rounded-full h-2 overflow-hidden shadow-inner">
                    <div
                      className="bg-rose-500 h-2 rounded-full transition-all duration-1000 ease-out"
                      style={{ width: `${dietaryBatchStatBarWidthPct(batchStats.swallowPct, loading)}%` }}
                    />
                  </div>
                </div>
                
                <div className="p-5 rounded-lg border border-slate-200/80 dark:border-white/10 bg-white flex flex-col gap-3 shadow-sm">
                  <div className="flex justify-between items-center">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Allergy Alert</p>
                    <span className="text-xs font-bold text-primary-500 bg-primary-50 dark:bg-primary-500/10 px-2 py-0.5 rounded-md">
                      {formatDietaryBatchStatPct("allergy", batchStats.allergyPct, loading)}
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800/60 rounded-full h-2 overflow-hidden shadow-inner">
                    <div
                      className="bg-primary-500 h-2 rounded-full transition-all duration-1000 ease-out"
                      style={{ width: `${dietaryBatchStatBarWidthPct(batchStats.allergyPct, loading)}%` }}
                    />
                  </div>
                </div>
                
                <div className="p-5 rounded-lg border border-slate-200/80 dark:border-white/10 bg-white flex flex-col gap-3 shadow-sm">
                  <div className="flex justify-between items-center">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">Texture Reviews</p>
                    <span className="text-xs font-bold text-primary-500 bg-primary-50 dark:bg-primary-500/10 px-2 py-0.5 rounded-md">
                      {formatDietaryBatchStatPct("texture", batchStats.medTexturePct, loading)}
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-slate-800/60 rounded-full h-2 overflow-hidden shadow-inner">
                    <div
                      className="bg-primary-500 h-2 rounded-full transition-all duration-1000 ease-out"
                      style={{ width: `${dietaryBatchStatBarWidthPct(batchStats.medTexturePct, loading)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 p-6 rounded-lg border border-slate-200/60 dark:border-white/5 bg-slate-50/50 space-y-5">
              <h3 className="text-[12px] font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">Meal log</h3>
              <div className="space-y-3 text-xs">
                <select
                  value={mealForm.resident_id}
                  onChange={(e) => setMealForm((prev) => ({ ...prev, resident_id: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10"
                >
                  {residents.map((resident) => (
                    <option key={resident.id} value={resident.id}>
                      {`${resident.first_name ?? ""} ${resident.last_name ?? ""}`.trim() || "Resident"}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300">
                    Meal date (ET)
                    <input
                      type="date"
                      value={mealForm.meal_date}
                      onChange={(e) => setMealForm((prev) => ({ ...prev, meal_date: e.target.value }))}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-normal text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-100"
                      aria-label="Meal date (Eastern Time)"
                    />
                  </label>
                  <select
                    value={mealForm.meal_type}
                    onChange={(e) => setMealForm((prev) => ({ ...prev, meal_type: e.target.value as MealLogType }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 capitalize dark:border-white/10"
                  >
                    {MEAL_TYPES.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={mealForm.status}
                    onChange={(e) => setMealForm((prev) => ({ ...prev, status: e.target.value as MealLogStatus }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 capitalize dark:border-white/10"
                  >
                    {MEAL_STATUSES.map((option) => (
                      <option key={option} value={option}>{MEAL_STATUS_LABELS[option]}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={mealForm.intake_percent}
                    onChange={(e) => setMealForm((prev) => ({ ...prev, intake_percent: e.target.value }))}
                    placeholder="Intake %"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10"
                  />
                </div>
                <textarea
                  value={mealForm.notes}
                  onChange={(e) => setMealForm((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Meal notes"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10"
                  rows={2}
                />
                <Button type="button" size="sm" disabled={!mealForm.resident_id || savingMeal} onClick={() => void saveMealLog()}>
                  {savingMeal ? "Saving meal…" : "Log meal"}
                </Button>
              </div>

              <div className="space-y-2 border-t border-slate-200/70 dark:border-white/10 pt-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">Recent meal entries</p>
                {mealLogs.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    No meal entries logged yet for this facility.
                  </p>
                ) : (
                  mealLogs.slice(0, 3).map((log) => (
                    <p key={log.id} className="text-xs text-slate-600 dark:text-slate-300">
                      {log.meal_date} {log.meal_type}: {`${log.residents?.first_name ?? ""} ${log.residents?.last_name ?? ""}`.trim() || "Resident"} — {MEAL_STATUS_LABELS[log.status]}
                    </p>
                  ))
                )}
              </div>
            </div>
          </div>

        </div>
        </>
      )}
      </div>
    </div>
  );
}
