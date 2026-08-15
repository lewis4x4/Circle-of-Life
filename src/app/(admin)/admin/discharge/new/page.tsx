"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import { Loader2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { EntityCombobox, type EntityComboboxOption } from "@/components/ui/entity-combobox";
import { FormCancelLink } from "@/components/ui/form-cancel-link";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { syncSelectedFacilityCookie } from "@/lib/facilities/selected-facility-cookie";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { logSupabasePostgrestError } from "@/lib/supabase/client-query-log";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";
import {
  formatDischargeNewResidentLabel,
  formatDischargeNewStartedLabel,
  getDischargeNewStartedDaysAgo,
} from "@/lib/discharge/discharge-new-display-copy";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

type DischargePlanCategory = Database["public"]["Enums"]["discharge_plan_category"];

const DISCHARGE_TYPE_OPTIONS: { value: DischargePlanCategory; label: string }[] = [
  { value: "planned", label: "Routine" },
  { value: "hospital_transfer", label: "Hospital transfer" },
  { value: "higher_level_of_care", label: "Hospice transition" },
  { value: "ama", label: "AMA" },
  { value: "death", label: "Death" },
  { value: "other", label: "Permanent move-out" },
];

const DISCHARGE_TYPE_HELPER_INLINE = DISCHARGE_TYPE_OPTIONS.map((o) => o.label).join(" · ");

const ACTIVE_DRAFT_STATUSES = ["draft", "pharmacist_review"] as const;

const MED_REC_QUEUE_PATH = "/pipeline/discharge-management";

const DRAFTS_PANEL_GENERIC_ERROR = "Couldn't load in-progress drafts. Refresh to try again.";
const CREATE_DRAFT_GENERIC_ERROR = "Couldn't create this draft. Refresh and try again.";

/** Columns guaranteed after migration `079` — avoids PostgREST failures when plan-category migration (`255`) is not applied yet. */
const DRAFT_SELECT_MINIMAL =
  "id, resident_id, status, created_at, updated_at, residents(first_name, last_name)" as const;

type ResidentBedNested = {
  bed_label: string;
  rooms: { room_number: string } | null;
} | null;

type ResidentPickerRow = {
  id: string;
  first_name: string;
  last_name: string;
  status: string;
  admission_date: string | null;
  beds?: ResidentBedNested | ResidentBedNested[];
};

type DraftCardRow = {
  id: string;
  resident_id: string;
  status: Database["public"]["Enums"]["discharge_med_reconciliation_status"];
  created_at: string;
  updated_at: string;
  residents: { first_name: string; last_name: string } | null;
};

function normalizeBed(row: ResidentPickerRow): ResidentBedNested {
  const b = row.beds;
  if (Array.isArray(b)) return b[0] ?? null;
  return b ?? null;
}

function formatRoom(row: ResidentPickerRow): string {
  const bed = normalizeBed(row);
  const rn = bed?.rooms?.room_number?.trim();
  if (rn) return rn;
  const lbl = bed?.bed_label?.trim();
  if (lbl) return lbl;
  return "—";
}

function formatAdmitted(isoDate: string | null | undefined): string {
  if (!isoDate || !isoDate.trim()) return "—";
  try {
    return format(parseISO(isoDate.length > 10 ? isoDate : `${isoDate}T12:00:00`), "MMM d, yyyy");
  } catch {
    return "—";
  }
}

function workflowStepOf5(status: string): number {
  if (status === "pharmacist_review") return 3;
  return 2;
}

export default function AdminDischargeNewPage() {
  const router = useRouter();
  const supabase = createClient();
  const { user } = useHavenAuth();
  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const availableFacilities = useFacilityStore((s) => s.availableFacilities);
  const setSelectedFacility = useFacilityStore((s) => s.setSelectedFacility);

  const [residentId, setResidentId] = useState("");
  const [residents, setResidents] = useState<ResidentPickerRow[]>([]);
  const [dischargePlanType, setDischargePlanType] = useState<DischargePlanCategory | "">("");
  const [expectedDischargeDate, setExpectedDischargeDate] = useState("");
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingReconciliationId, setExistingReconciliationId] = useState<string | null>(null);

  const [draftRows, setDraftRows] = useState<DraftCardRow[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(true);
  const [draftPanelFetchFailed, setDraftPanelFetchFailed] = useState(false);
  const [draftPanelLoadError, setDraftPanelLoadError] = useState<string | null>(null);

  const today = useMemo(() => new Date(), []);
  const minMax = useMemo(
    () => ({
      min: format(addDays(today, -90), "yyyy-MM-dd"),
      max: format(addDays(today, 90), "yyyy-MM-dd"),
    }),
    [today],
  );

  const scopedFacilityId =
    selectedFacilityId != null && isValidFacilityIdForQuery(selectedFacilityId) ? selectedFacilityId : null;

  const facilityName = useMemo(() => {
    if (!scopedFacilityId) return null;
    return availableFacilities.find((f) => f.id === scopedFacilityId)?.name ?? null;
  }, [availableFacilities, scopedFacilityId]);

  /** Auto-scope when only one accessible facility exists. */
  useEffect(() => {
    if (selectedFacilityId != null) return;
    if (availableFacilities.length !== 1) return;
    const id = availableFacilities[0]!.id;
    if (!isValidFacilityIdForQuery(id)) return;
    setSelectedFacility(id);
    syncSelectedFacilityCookie(id);
  }, [availableFacilities, selectedFacilityId, setSelectedFacility]);

  const loadResidentsAndDrafts = useCallback(async () => {
    if (!scopedFacilityId) {
      setResidents([]);
      setDraftRows([]);
      setLoadingRefs(false);
      setLoadingDrafts(false);
      setDraftPanelFetchFailed(false);
      setDraftPanelLoadError(null);
      return;
    }
    setLoadingRefs(true);
    setLoadingDrafts(true);
    setDraftPanelFetchFailed(false);
    setDraftPanelLoadError(null);

    const { data: draftData, error: draftErr } = await supabase
      .from("discharge_med_reconciliation")
      .select(DRAFT_SELECT_MINIMAL)
      .eq("facility_id", scopedFacilityId)
      .in("status", [...ACTIVE_DRAFT_STATUSES])
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });

    let blockedResidentIds = new Set<string>();
    if (draftErr) {
      logSupabasePostgrestError("discharge-new.drafts", draftErr, { facilityId: scopedFacilityId });
      setDraftPanelFetchFailed(true);
      setDraftPanelLoadError(formatLiveDataLoadError(draftErr, DRAFTS_PANEL_GENERIC_ERROR));
      setDraftRows([]);
    } else {
      const rows = (draftData ?? []) as unknown as DraftCardRow[];
      setDraftRows(rows);
      blockedResidentIds = new Set(rows.map((r) => r.resident_id));
    }
    setLoadingDrafts(false);

    const residentSelectWithRoom =
      "id, first_name, last_name, status, admission_date, beds(bed_label, rooms(room_number))";

    const primaryRes = await supabase
      .from("residents")
      .select(residentSelectWithRoom)
      .eq("facility_id", scopedFacilityId)
      .is("deleted_at", null)
      .not("status", "in", "(discharged,deceased)")
      .order("last_name");

    let pickerRows: ResidentPickerRow[];

    if (primaryRes.error) {
      logSupabasePostgrestError("discharge-new.residents.embed_fallback", primaryRes.error, {
        facilityId: scopedFacilityId,
      });
      const fb = await supabase
        .from("residents")
        .select("id, first_name, last_name, status, admission_date")
        .eq("facility_id", scopedFacilityId)
        .is("deleted_at", null)
        .not("status", "in", "(discharged,deceased)")
        .order("last_name");

      if (fb.error) {
        logSupabasePostgrestError("discharge-new.residents", fb.error, { facilityId: scopedFacilityId });
        pickerRows = [];
      } else {
        pickerRows = (fb.data ?? []).map((row) => ({
          ...row,
          beds: null,
        }));
      }
    } else {
      pickerRows = (primaryRes.data ?? []) as ResidentPickerRow[];
    }

    const allResidents = pickerRows.filter((r) => !blockedResidentIds.has(r.id));
    setResidents(allResidents);
    setLoadingRefs(false);
  }, [scopedFacilityId, supabase]);

  useEffect(() => {
    void loadResidentsAndDrafts();
  }, [loadResidentsAndDrafts]);

  useEffect(() => {
    setResidentId("");
    setExistingReconciliationId(null);
  }, [scopedFacilityId]);

  useEffect(() => {
    async function checkExisting() {
      if (!scopedFacilityId || !residentId) {
        setExistingReconciliationId(null);
        return;
      }
      const { data, error: exErr } = await supabase
        .from("discharge_med_reconciliation")
        .select("id")
        .eq("facility_id", scopedFacilityId)
        .eq("resident_id", residentId)
        .is("deleted_at", null)
        .not("status", "eq", "cancelled")
        .not("status", "eq", "complete")
        .maybeSingle();
      if (exErr) {
        logSupabasePostgrestError("discharge-new.existing-check", exErr, {
          facilityId: scopedFacilityId,
          residentId,
        });
        setExistingReconciliationId(null);
        return;
      }
      setExistingReconciliationId(data?.id ?? null);
    }
    void checkExisting();
  }, [residentId, scopedFacilityId, supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const fid = scopedFacilityId;
    if (!fid) {
      setError("Choose a facility to continue.");
      return;
    }
    if (!residentId) {
      setError("Choose a resident.");
      return;
    }
    if (!dischargePlanType) {
      setError("Choose a discharge type.");
      return;
    }
    if (!expectedDischargeDate.trim()) {
      setError("Choose an expected discharge date.");
      return;
    }
    if (existingReconciliationId) {
      setError("This resident already has an active medication reconciliation draft.");
      return;
    }

    const parsedExpect = parseISO(`${expectedDischargeDate}T12:00:00`);
    if (
      parsedExpect.getTime() < parseISO(`${minMax.min}T12:00:00`).getTime() ||
      parsedExpect.getTime() > parseISO(`${minMax.max}T12:00:00`).getTime()
    ) {
      setError("Expected discharge date must be within 90 days before or after today.");
      return;
    }

    setSubmitting(true);
    try {
      const { data: fac, error: facErr } = await supabase
        .from("facilities")
        .select("organization_id")
        .eq("id", fid)
        .is("deleted_at", null)
        .maybeSingle();
      if (facErr) {
        logSupabasePostgrestError("discharge-new.facility-org", facErr, { facilityId: fid });
        setError("Could not resolve organization for this facility.");
        return;
      }
      if (!fac?.organization_id) {
        setError("Could not resolve organization for this facility.");
        return;
      }

      if (!user?.id) {
        setError("You must be signed in.");
        return;
      }

      const payload: Database["public"]["Tables"]["discharge_med_reconciliation"]["Insert"] = {
        organization_id: fac.organization_id,
        facility_id: fid,
        resident_id: residentId,
        status: "draft",
        discharge_plan_category: dischargePlanType,
        expected_discharge_date: expectedDischargeDate,
        created_by: user.id,
      };

      const { data: inserted, error: insErr } = await supabase
        .from("discharge_med_reconciliation")
        .insert(payload)
        .select("id")
        .single();
      if (insErr) {
        logSupabasePostgrestError("discharge-new.insert", insErr, {
          facilityId: fid,
          residentId,
        });
        setError(formatLiveDataLoadError(insErr, CREATE_DRAFT_GENERIC_ERROR));
        return;
      }
      if (inserted?.id) {
        router.push(`/admin/discharge/${inserted.id}`);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  const residentOptions: EntityComboboxOption[] = useMemo(
    () =>
      residents.map((r) => {
        const room = formatRoom(r);
        const admitted = formatAdmitted(r.admission_date);
        const residentName = formatDischargeNewResidentLabel(r);
        const label = `${residentName} · Room ${room} · Admitted ${admitted}`;
        return {
          id: r.id,
          label,
          keywords: `${residentName} ${room} ${admitted} ${r.status} ${r.id}`,
        };
      }),
    [residents],
  );

  const gateBlocking =
    selectedFacilityId === null ||
    selectedFacilityId === undefined ||
    !isValidFacilityIdForQuery(selectedFacilityId ?? "");

  const manualFacilityBarrier = gateBlocking && availableFacilities.length > 1;

  const canSubmitForm =
    Boolean(scopedFacilityId) &&
    Boolean(residentId) &&
    Boolean(dischargePlanType) &&
    Boolean(expectedDischargeDate.trim()) &&
    !existingReconciliationId &&
    !submitting;

  const subtitle =
    scopedFacilityId && facilityName
      ? `Start a medication reconciliation (med rec) draft for a resident at ${facilityName}.`
      : "Start a medication reconciliation (med rec) draft after choosing a facility.";

  const awaitingSingletonFacility =
    (selectedFacilityId == null || !isValidFacilityIdForQuery(selectedFacilityId ?? "")) &&
    availableFacilities.length === 1;

  function onFacilityPicked(id: string) {
    if (!isValidFacilityIdForQuery(id)) return;
    setSelectedFacility(id);
    syncSelectedFacilityCookie(id);
  }

  const visibleDrafts = draftRows.slice(0, 5);

  const ninetyDayRationale =
    "Florida assisted living discharge planning is typically anchored near-term; ±90 days keeps scheduling realistic while allowing short lookahead.";

  return (
    <div className="space-y-8 pb-12">
      <div>
        <Link
          href={MED_REC_QUEUE_PATH}
          className="inline-flex text-[13px] font-medium text-primary underline-offset-4 hover:underline"
        >
          ← Back to medication reconciliation queue
        </Link>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">New medication reconciliation</h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{subtitle}</p>
      </div>

      {awaitingSingletonFacility ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Selecting facility…
        </p>
      ) : null}

      {manualFacilityBarrier ? (
        <div className="max-w-xl space-y-3 rounded-lg border border-border bg-muted/20 p-6 text-[13px] text-foreground">
          <p className="font-medium">Choose a facility</p>
          <p className="text-muted-foreground">
            Medication reconciliation drafts are tracked per facility. Select one facility before continuing.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="facility-scope" className="text-[13px] font-semibold text-muted-foreground">
              Facility
            </Label>
            <Select onValueChange={onFacilityPicked}>
              <SelectTrigger id="facility-scope" className="h-10 w-full max-w-md text-[13px] shadow-none">
                <SelectValue placeholder="Select a facility…" />
              </SelectTrigger>
              <SelectContent>
                {availableFacilities.map((f) => (
                  <SelectItem key={f.id} value={f.id} className="text-[13px]">
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}

      {!manualFacilityBarrier && !scopedFacilityId && availableFacilities.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No facilities are available for this profile.</p>
      ) : null}

      {!manualFacilityBarrier && scopedFacilityId && !awaitingSingletonFacility ? (
        <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 lg:flex-row lg:gap-6">
          <div className="min-w-0 max-w-[640px] flex-1 border-t border-border pt-8">
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-8">
              <div className="space-y-1">
                <p className="text-[13px] font-semibold tracking-tight text-foreground">About this discharge</p>
                <p className="text-[12px] text-muted-foreground">
                  Required fields to open a draft medication reconciliation.
                </p>
              </div>

              <div className="space-y-6">
                {existingReconciliationId ? (
                  <div className="rounded-lg border border-border bg-muted/25 px-4 py-3 text-[13px] text-foreground">
                    This resident already has an active medication reconciliation draft. Continue that record instead of
                    creating another.
                    <div className="mt-3">
                      <Link
                        href={`/admin/discharge/${existingReconciliationId}`}
                        className={cn(buttonVariants({ size: "sm" }), "inline-flex")}
                      >
                        Open existing draft
                      </Link>
                    </div>
                  </div>
                ) : null}

                {!existingReconciliationId && residents.length === 0 && !loadingRefs ? (
                  <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-[13px] leading-relaxed text-foreground">
                    All active residents have open medication reconciliation drafts.{" "}
                    <Link
                      href={MED_REC_QUEUE_PATH}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      View in-progress drafts
                    </Link>
                  </div>
                ) : (
                  <EntityCombobox
                    id="resident-combobox"
                    data-testid="med-rec-resident-combobox"
                    label="Resident"
                    placeholder="Select resident…"
                    searchPlaceholder="Search active residents…"
                    required
                    loading={loadingRefs}
                    disabled={loadingRefs || Boolean(existingReconciliationId)}
                    options={residentOptions}
                    value={residentId}
                    onChange={setResidentId}
                    triggerClassName="md:max-w-md"
                  />
                )}

                {!existingReconciliationId && residents.length > 0 ? (
                  <p className="text-[12px] leading-relaxed text-muted-foreground md:max-w-md" aria-live="polite">
                    <span className="font-medium text-foreground">{residents.length}</span> active residents available at{" "}
                    <span className="font-medium text-foreground">{facilityName ?? "this facility"}</span> without an open
                    med rec draft.
                  </p>
                ) : null}

                <div className="space-y-2 md:max-w-md">
                  <Label htmlFor="plan-type" className="text-[13px] font-semibold text-muted-foreground">
                    Discharge type<span className="font-semibold text-destructive"> *</span>
                  </Label>
                  <Select value={dischargePlanType} onValueChange={(v) => setDischargePlanType(v as DischargePlanCategory)}>
                    <SelectTrigger id="plan-type" className="h-10 w-full text-[13px] shadow-none">
                      <SelectValue placeholder="Select discharge type…" />
                    </SelectTrigger>
                    <SelectContent>
                      {DISCHARGE_TYPE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value} className="text-[13px]">
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[12px] leading-relaxed text-muted-foreground">{DISCHARGE_TYPE_HELPER_INLINE}</p>
                </div>

                <div className="space-y-2 md:max-w-md">
                  <Label htmlFor="expected-date" className="text-[13px] font-semibold text-muted-foreground">
                    Expected discharge date<span className="font-semibold text-destructive"> *</span>
                  </Label>
                  <DateInput
                    id="expected-date"
                    value={expectedDischargeDate}
                    onValueChange={setExpectedDischargeDate}
                    min={minMax.min}
                    max={minMax.max}
                    emptyHint="MM/DD/YYYY"
                    required
                    className="text-[13px] md:w-[200px]"
                  />
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    Must be within ±90 days of today. {ninetyDayRationale}
                  </p>
                </div>
              </div>

              {error ? (
                <p className="text-[13px] font-medium text-destructive" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="rounded-lg border border-border bg-muted/15 px-4 py-3 text-[13px] leading-relaxed text-foreground">
                <p className="font-semibold">What you&apos;ll do next</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
                  <li>Add current medications</li>
                  <li>Reconcile against discharge plan</li>
                  <li>Send for pharmacist review</li>
                  <li>Prescriber sign-off</li>
                  <li>Post-discharge handoff complete</li>
                </ol>
              </div>

              <div className="border-t border-border pt-6">
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <FormCancelLink href={MED_REC_QUEUE_PATH} />
                  <Button type="submit" disabled={!canSubmitForm} className="min-w-[9.5rem] text-[13px] font-semibold">
                    {submitting ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                        Saving…
                      </>
                    ) : (
                      "Create draft"
                    )}
                  </Button>
                </div>
                {!canSubmitForm && !submitting ? (
                  <p className="mt-3 text-right text-[12px] text-muted-foreground">
                    Select a resident, discharge type, and expected date to enable.
                  </p>
                ) : null}
              </div>
            </form>
          </div>

          <aside
            data-testid="med-rec-drafts-panel"
            className="w-full max-w-[360px] shrink-0 border-t border-border pt-8 lg:border-t-0 lg:pt-0"
          >
            <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Continue a draft</h2>

            <div className="mt-4 space-y-3">
              {draftPanelFetchFailed ? (
                <div className="space-y-2" role="alert">
                  <p className="text-left text-[13px] font-medium text-destructive">
                    {draftPanelLoadError ?? DRAFTS_PANEL_GENERIC_ERROR}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-[13px]"
                    data-testid="med-rec-drafts-retry"
                    onClick={() => void loadResidentsAndDrafts()}
                  >
                    Retry
                  </Button>
                </div>
              ) : loadingDrafts ? (
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Loading drafts…
                </p>
              ) : draftRows.length === 0 ? (
                <p className="text-left text-[13px] text-muted-foreground">No in-progress drafts.</p>
              ) : (
                <>
                  <ul className="space-y-3" aria-label="In-progress medication reconciliation drafts">
                    {visibleDrafts.map((row) => {
                      const name = formatDischargeNewResidentLabel(row.residents);
                      const startedLabel = formatDischargeNewStartedLabel(row.created_at);
                      const daysAgo = getDischargeNewStartedDaysAgo(row.created_at);
                      const step = workflowStepOf5(row.status);
                      return (
                        <li
                          key={row.id}
                          className="rounded-lg border border-border bg-card px-4 py-3 shadow-[var(--shadow-card)] ring-1 ring-border/50"
                          data-testid="med-rec-draft-card"
                        >
                          <p className="text-[13px] font-semibold text-foreground">{name}</p>
                          <p className="mt-1 text-[12px] text-muted-foreground">
                            Started {startedLabel} · {daysAgo} days ago
                          </p>
                          <p className="mt-1 text-[12px] text-muted-foreground">
                            Step {step} of 5 · Medication reconciliation workflow
                          </p>
                          <div className="mt-3">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-[13px]"
                              onClick={() => router.push(`/admin/discharge/${row.id}`)}
                            >
                              Resume
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {draftRows.length > 5 ? (
                    <Link
                      href={MED_REC_QUEUE_PATH}
                      className="inline-flex text-[13px] font-medium text-primary underline-offset-4 hover:underline"
                      data-testid="med-rec-view-all-drafts"
                    >
                      View all drafts ({draftRows.length})
                    </Link>
                  ) : null}
                </>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
