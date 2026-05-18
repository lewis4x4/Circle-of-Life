"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import { ChevronRight, Loader2 } from "lucide-react";

import { DischargeHubNav } from "../discharge-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { syncSelectedFacilityCookie } from "@/lib/facilities/selected-facility-cookie";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

type DischargePlanCategory = Database["public"]["Enums"]["discharge_plan_category"];

const DISCHARGE_TYPE_OPTIONS: { value: DischargePlanCategory; label: string }[] = [
  { value: "planned", label: "Planned" },
  { value: "hospital_transfer", label: "Hospital transfer" },
  { value: "ama", label: "AMA" },
  { value: "higher_level_of_care", label: "Higher level of care" },
  { value: "death", label: "Death" },
  { value: "other", label: "Other" },
];

const ACTIVE_DRAFT_STATUSES = ["draft", "pharmacist_review"] as const;

type ResidentRow = {
  id: string;
  first_name: string;
  last_name: string;
  status: string;
};

type DraftCardRow = {
  id: string;
  resident_id: string;
  discharge_plan_category: DischargePlanCategory | null;
  expected_discharge_date: string | null;
  updated_at: string;
  residents: { first_name: string; last_name: string } | null;
};

function residentLabel(r: Pick<ResidentRow, "first_name" | "last_name">): string {
  return `${r.last_name}, ${r.first_name}`;
}

function formatPlanCategory(c: string | null | undefined): string {
  if (!c) return "—";
  const found = DISCHARGE_TYPE_OPTIONS.find((o) => o.value === c);
  return found?.label ?? c.replace(/_/g, " ");
}

function formatCalendarDate(isoDate: string | null | undefined): string {
  if (!isoDate || !isoDate.trim()) return "—";
  try {
    return format(parseISO(isoDate.length > 10 ? isoDate : `${isoDate}T12:00:00`), "MMM d, yyyy");
  } catch {
    return isoDate;
  }
}

export default function AdminDischargeNewPage() {
  const router = useRouter();
  const supabase = createClient();
  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const availableFacilities = useFacilityStore((s) => s.availableFacilities);
  const setSelectedFacility = useFacilityStore((s) => s.setSelectedFacility);

  const [residentId, setResidentId] = useState("");
  const [residentOpen, setResidentOpen] = useState(false);
  const [residents, setResidents] = useState<ResidentRow[]>([]);
  const [dischargePlanType, setDischargePlanType] = useState<DischargePlanCategory | "">("");
  const [expectedDischargeDate, setExpectedDischargeDate] = useState(() =>
    format(addDays(new Date(), 3), "yyyy-MM-dd"),
  );
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingReconciliationId, setExistingReconciliationId] = useState<string | null>(null);

  const [draftRows, setDraftRows] = useState<DraftCardRow[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(true);
  const [draftLoadError, setDraftLoadError] = useState<string | null>(null);

  const today = useMemo(() => new Date(), []);
  const minDateStr = useMemo(() => format(addDays(today, -90), "yyyy-MM-dd"), [today]);
  const maxDateStr = useMemo(() => format(addDays(today, 90), "yyyy-MM-dd"), [today]);

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
      return;
    }
    setLoadingRefs(true);
    setLoadingDrafts(true);
    setError(null);

    const { data: draftData, error: draftErr } = await supabase
      .from("discharge_med_reconciliation")
      .select(
        "id, resident_id, discharge_plan_category, expected_discharge_date, updated_at, residents(first_name, last_name)",
      )
      .eq("facility_id", scopedFacilityId)
      .in("status", [...ACTIVE_DRAFT_STATUSES])
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });

    let blockedResidentIds = new Set<string>();
    if (draftErr) {
      setDraftLoadError(draftErr.message);
      setDraftRows([]);
    } else {
      setDraftLoadError(null);
      const rows = (draftData ?? []) as unknown as DraftCardRow[];
      setDraftRows(rows);
      blockedResidentIds = new Set(rows.map((r) => r.resident_id));
    }
    setLoadingDrafts(false);

    const { data: residentData } = await supabase
      .from("residents")
      .select("id, first_name, last_name, status")
      .eq("facility_id", scopedFacilityId)
      .is("deleted_at", null)
      .not("status", "in", "(discharged,deceased)")
      .order("last_name");

    const allResidents = ((residentData ?? []) as ResidentRow[]).filter((r) => !blockedResidentIds.has(r.id));
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
      const { data } = await supabase
        .from("discharge_med_reconciliation")
        .select("id")
        .eq("facility_id", scopedFacilityId)
        .eq("resident_id", residentId)
        .is("deleted_at", null)
        .not("status", "eq", "cancelled")
        .not("status", "eq", "complete")
        .maybeSingle();
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
      setError("This resident already has an active discharge reconciliation.");
      return;
    }

    const parsedExpect = parseISO(`${expectedDischargeDate}T12:00:00`);
    if (
      parsedExpect.getTime() < parseISO(`${minDateStr}T12:00:00`).getTime() ||
      parsedExpect.getTime() > parseISO(`${maxDateStr}T12:00:00`).getTime()
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
      if (facErr || !fac?.organization_id) {
        setError("Could not resolve organization for this facility.");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
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
        setError(insErr.message);
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

  const selectedResidentLabel = useMemo(() => {
    const r = residents.find((x) => x.id === residentId);
    return r ? residentLabel(r) : "";
  }, [residentId, residents]);

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
      ? `Start a discharge medication reconciliation draft for a resident at ${facilityName}.`
      : "Start a discharge medication reconciliation draft after choosing a facility.";

  const awaitingSingletonFacility =
    (selectedFacilityId == null || !isValidFacilityIdForQuery(selectedFacilityId ?? "")) &&
    availableFacilities.length === 1;

  function onFacilityPicked(id: string) {
    if (!isValidFacilityIdForQuery(id)) return;
    setSelectedFacility(id);
    syncSelectedFacilityCookie(id);
  }

  return (
    <div className="space-y-8 pb-12">
      <div>
        <Link
          href="/admin/discharge"
          className="inline-flex text-[13px] font-medium text-primary underline-offset-4 hover:underline"
        >
          ← Back to discharge queue
        </Link>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">New medication reconciliation</h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">{subtitle}</p>

        <div className="mt-4">
          <DischargeHubNav />
        </div>
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
            Medicine reconciliation drafts are tracked per facility. Select one facility before continuing.
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
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-5 lg:gap-10">
          <div className="border-t border-border pt-8 lg:col-span-3">
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-8">
              <div className="space-y-1">
                <p className="text-[13px] font-semibold tracking-tight text-foreground">About this discharge</p>
                <p className="text-[12px] text-muted-foreground">Required fields to open a draft medication reconciliation.</p>
              </div>

              <div className="space-y-6">
                {existingReconciliationId ? (
                  <div className="rounded-lg border border-border bg-muted/25 px-4 py-3 text-[13px] text-foreground">
                    This resident already has an active medication reconciliation draft. Continue that record instead of
                    creating another.
                    <div className="mt-3">
                      <Link
                        href={`/admin/discharge/${existingReconciliationId}`}
                        className={cn(buttonVariants({ size: "sm" }))}
                      >
                        Open existing draft
                      </Link>
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor="resident-combobox" className="text-[13px] font-semibold text-muted-foreground">
                    Resident<span className="font-semibold text-destructive"> *</span>
                  </Label>
                  <Popover open={residentOpen} onOpenChange={setResidentOpen}>
                    <PopoverTrigger
                      id="resident-combobox"
                      type="button"
                      disabled={loadingRefs}
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                        "h-10 w-full justify-between px-3 font-normal shadow-none md:max-w-md",
                      )}
                      aria-required
                    >
                      <span className={cn("truncate text-left", !selectedResidentLabel && "text-muted-foreground")}>
                        {loadingRefs ? "Loading residents…" : selectedResidentLabel || "Search active residents…"}
                      </span>
                    </PopoverTrigger>
                    <PopoverContent className="w-[min(100vw-2rem,440px)] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search active residents…" />
                        <CommandList>
                          <CommandEmpty>No matching residents.</CommandEmpty>
                          <CommandGroup heading="Residents">
                            {residents.map((r) => (
                              <CommandItem
                                key={r.id}
                                value={`${residentLabel(r)} ${r.id}`}
                                onSelect={() => {
                                  setResidentId(r.id);
                                  setResidentOpen(false);
                                }}
                              >
                                {residentLabel(r)}
                                <span className="ml-2 text-[12px] text-muted-foreground">({r.status})</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    Active residents at{" "}
                    <span className="font-medium text-foreground">{facilityName ?? "this facility"}</span> without an
                    open med rec draft.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="plan-type" className="text-[13px] font-semibold text-muted-foreground">
                    Discharge type<span className="font-semibold text-destructive"> *</span>
                  </Label>
                  <Select value={dischargePlanType} onValueChange={(v) => setDischargePlanType(v as DischargePlanCategory)}>
                    <SelectTrigger id="plan-type" className="h-10 w-full text-[13px] shadow-none md:max-w-md">
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
                </div>

                <div className="space-y-2">
                  <Label htmlFor="expected-date" className="text-[13px] font-semibold text-muted-foreground">
                    Expected discharge date<span className="font-semibold text-destructive"> *</span>
                  </Label>
                  <div className="md:max-w-md">
                    <DateInput
                      id="expected-date"
                      value={expectedDischargeDate}
                      onValueChange={setExpectedDischargeDate}
                      min={minDateStr}
                      max={maxDateStr}
                      emptyHint={null}
                      required
                      className="text-[13px]"
                    />
                  </div>
                  <p className="text-[12px] text-muted-foreground">Defaults to three days from today; must stay within ±90 days.</p>
                </div>
              </div>

              {error ? (
                <p className="text-[13px] font-medium text-destructive" role="alert">
                  {error}
                </p>
              ) : null}

              <p className="text-[12px] leading-relaxed text-muted-foreground">
                The next step opens the full med rec editor — current meds, prescriber sign-off, post-discharge
                instructions, and attachments.
              </p>

              <div className="border-t border-border pt-6">
                <div className="flex flex-wrap items-center justify-end gap-3">
                <Link
                  href="/admin/discharge"
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-[13px]")}
                >
                  Cancel
                </Link>
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

          <aside className="border-t border-border pt-8 lg:col-span-2">
            <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Continue a draft</h2>
            <p className="mt-1 text-[12px] text-muted-foreground">
              In-progress medication reconciliations for {facilityName ?? "this facility"}.
            </p>

            <div className="mt-4 space-y-2">
              {draftLoadError ? (
                <p className="text-left text-[13px] font-medium text-destructive" role="alert">
                  Could not load drafts ({draftLoadError}).
                </p>
              ) : null}
              {loadingDrafts ? (
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Loading drafts…
                </p>
              ) : draftRows.length === 0 ? (
                <p className="text-left text-[13px] leading-relaxed text-muted-foreground">
                  No drafts in progress. Once you start a med rec draft, it appears here until completed.
                </p>
              ) : (
                <ul className="space-y-2">
                  {draftRows.map((row) => {
                      const rn = row.residents;
                      const name = rn ? residentLabel({ first_name: rn.first_name, last_name: rn.last_name }) : "Unknown resident";
                      return (
                      <li key={row.id}>
                        <button
                          type="button"
                          className={cn(
                            "w-full rounded-lg border border-border bg-card px-4 py-3 text-left shadow-[var(--shadow-card)] ring-1 ring-border/50 transition-colors",
                            "hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          )}
                          onClick={() => {
                            router.push(`/admin/discharge/${row.id}`);
                          }}
                        >
                          <span className="flex items-start justify-between gap-2">
                            <span className="text-[13px] font-medium text-foreground">{name}</span>
                            <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                          </span>
                          <span className="mt-1 block text-[12px] text-muted-foreground">
                            {formatPlanCategory(row.discharge_plan_category)} · {formatCalendarDate(row.expected_discharge_date)}
                          </span>
                          <span className="mt-1 block text-[11px] text-muted-foreground">
                            Updated{" "}
                            {format(parseISO(row.updated_at), "MMM d, yyyy 'at' h:mm a")}
                          </span>
                        </button>
                      </li>
                      );
                  })}
                </ul>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
