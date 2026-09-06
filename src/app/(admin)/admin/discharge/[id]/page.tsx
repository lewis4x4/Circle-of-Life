"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

import { DischargeMedicationReview } from "@/components/discharge/DischargeMedicationReview";
import { Button } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { logSupabasePostgrestError } from "@/lib/supabase/client-query-log";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import {
  RecordDetailHeader,
  RecordDetailSection,
} from "@/design-system/components/record-detail";
import { formatDischargeDetailTimestamp } from "@/lib/discharge/discharge-detail-display-copy";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

type RowT = Database["public"]["Tables"]["discharge_med_reconciliation"]["Row"] & {
  residents: {
    first_name: string;
    last_name: string;
    status: string | null;
    discharge_date: string | null;
    discharge_target_date: string | null;
    hospice_status: string;
  } | null;
};

const HOSPICE_OPTIONS: Array<Database["public"]["Enums"]["hospice_status"]> = [
  "none",
  "pending",
  "active",
  "ended",
];

const DISCHARGE_REASONS: Array<Database["public"]["Enums"]["discharge_reason"]> = [
  "resident_voluntary",
  "facility_with_cause",
  "facility_immediate",
  "medicaid_relocation",
  "higher_level_of_care",
  "hospital_permanent",
  "another_alf",
  "home",
  "death",
  "non_payment",
  "behavioral",
  "other",
];

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

export default function AdminDischargeDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const { user } = useHavenAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [row, setRow] = useState<RowT | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [nurseNotesDraft, setNurseNotesDraft] = useState("");
  const [pharmacistNotesDraft, setPharmacistNotesDraft] = useState("");
  const [pharmacistNpiDraft, setPharmacistNpiDraft] = useState("");
  const [dischargeTargetDraft, setDischargeTargetDraft] = useState("");
  const [hospiceStatusDraft, setHospiceStatusDraft] = useState<Database["public"]["Enums"]["hospice_status"]>("none");
  const [officialDischargeDate, setOfficialDischargeDate] = useState("");
  const [officialDischargeReason, setOfficialDischargeReason] =
    useState<Database["public"]["Enums"]["discharge_reason"]>("resident_voluntary");
  const [officialDischargeDestination, setOfficialDischargeDestination] = useState("");

  const load = useCallback(async () => {
    if (!id) {
      setRow(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const { data, error: qErr } = await supabase
      .from("discharge_med_reconciliation")
      .select(
        "*, residents(first_name, last_name, status, discharge_date, discharge_target_date, hospice_status)",
      )
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (qErr) {
      logSupabasePostgrestError("discharge-detail.load", qErr, { reconciliationId: id });
      setError("Couldn't load this medication reconciliation. Refresh to try again.");
      setRow(null);
    } else {
      const loadedRow = data as RowT | null;
      setRow(loadedRow);
      setNurseNotesDraft(loadedRow?.nurse_reconciliation_notes ?? "");
      setPharmacistNotesDraft(loadedRow?.pharmacist_notes ?? "");
      setPharmacistNpiDraft(loadedRow?.pharmacist_npi ?? "");
      setDischargeTargetDraft(loadedRow?.residents?.discharge_target_date ?? "");
      setHospiceStatusDraft((loadedRow?.residents?.hospice_status as Database["public"]["Enums"]["hospice_status"] | undefined) ?? "none");
      const todayIso = todayFacilityDateIso();
      setOfficialDischargeDate(
        loadedRow?.residents?.discharge_date ??
          loadedRow?.residents?.discharge_target_date ??
          loadedRow?.expected_discharge_date ??
          todayIso,
      );
    }
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const wrongFacility =
    row &&
    selectedFacilityId &&
    isValidFacilityIdForQuery(selectedFacilityId) &&
    row.facility_id !== selectedFacilityId;

  async function updateReconciliation(
    patch: Partial<Database["public"]["Tables"]["discharge_med_reconciliation"]["Update"]>,
    successMessage: string,
  ) {
    if (!row) return;
    setActionLoading(successMessage);
    setActionError(null);
    setActionMessage(null);
    try {
      const { error: updateError } = await supabase
        .from("discharge_med_reconciliation")
        .update({
          ...patch,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq("id", row.id);
      if (updateError) throw updateError;
      setActionMessage(successMessage);
      await load();
    } catch (err) {
      logSupabasePostgrestError("discharge-detail.patch-reconciliation", err, { reconciliationId: row?.id });
      setActionError("Couldn't save changes. Retry or refresh.");
    } finally {
      setActionLoading(null);
    }
  }

  async function updateResidentDischargeFields(
    patch: Partial<Database["public"]["Tables"]["residents"]["Update"]>,
    successMessage: string,
  ) {
    if (!row?.resident_id) return;
    setActionLoading(successMessage);
    setActionError(null);
    setActionMessage(null);
    try {
      const { error: updateError } = await supabase
        .from("residents")
        .update({
          ...patch,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq("id", row.resident_id);
      if (updateError) throw updateError;
      setActionMessage(successMessage);
      await load();
    } catch (err) {
      logSupabasePostgrestError("discharge-detail.patch-resident", err, { reconciliationId: row?.id });
      setActionError("Couldn't save discharge planning. Retry or refresh.");
    } finally {
      setActionLoading(null);
    }
  }

  /** BH-1: official discharge — belongings out; stops full monthly rent / bed hold. */
  async function completeOfficialDischarge() {
    if (!row?.resident_id) return;
    if (!officialDischargeDate) {
      setActionError("Choose the official discharge date (belongings removed).");
      return;
    }
    const successMessage = "Official discharge recorded — resident is no longer billable.";
    setActionLoading(successMessage);
    setActionError(null);
    setActionMessage(null);
    try {
      const status: Database["public"]["Enums"]["resident_status"] =
        officialDischargeReason === "death" ? "deceased" : "discharged";
      const { error: updateError } = await supabase
        .from("residents")
        .update({
          status,
          discharge_date: officialDischargeDate,
          discharge_reason: officialDischargeReason,
          discharge_destination: officialDischargeDestination.trim() || null,
          bed_id: null,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq("id", row.resident_id);
      if (updateError) throw updateError;
      setActionMessage(successMessage);
      await load();
    } catch (err) {
      logSupabasePostgrestError("discharge-detail.official-discharge", err, {
        reconciliationId: row?.id,
      });
      setActionError("Couldn't complete official discharge. Retry or refresh.");
    } finally {
      setActionLoading(null);
    }
  }

  const alreadyOfficiallyDischarged =
    row?.residents?.status === "discharged" || row?.residents?.status === "deceased";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <RecordDetailHeader
        title="Medication reconciliation"
        subtitle="Operational workspace for discharge reconciliation, pharmacist attestation, and transition notes."
        backLink={{ label: "Back to medication reconciliation queue", href: "/pipeline/discharge-management" }}
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : !row ? (
        <div className="rounded-[8px] border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          No row found for this id, or you do not have access.
        </div>
      ) : (
        <>
          {actionError ? (
            <p className="rounded-[8px] border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {actionError}
            </p>
          ) : null}
          {actionMessage ? (
            <p className="rounded-[8px] border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
              {actionMessage}
            </p>
          ) : null}
          {wrongFacility ? (
            <p className="rounded-[8px] border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-warning">
              This record belongs to another facility. Switch the facility in the header to align context.
            </p>
          ) : null}

          <RecordDetailSection
            title={row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : "Resident"}
            description={row.id}
          >
            <div className="space-y-6 text-sm">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</dt>
                  <dd className="mt-0.5 capitalize text-foreground">{formatStatus(row.status)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Discharge target (resident)
                  </dt>
                  <dd className="mt-2 space-y-2">
                    <input
                      type="date"
                      value={dischargeTargetDraft}
                      onChange={(event) => setDischargeTargetDraft(event.target.value)}
                      className="w-full rounded-[8px] border border-input bg-card px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={actionLoading === "Resident discharge target saved." || dischargeTargetDraft === (row.residents?.discharge_target_date ?? "")}
                      onClick={() =>
                        void updateResidentDischargeFields(
                          { discharge_target_date: dischargeTargetDraft || null },
                          "Resident discharge target saved.",
                        )
                      }
                    >
                      {actionLoading === "Resident discharge target saved." ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save target"}
                    </Button>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Hospice (resident)
                  </dt>
                  <dd className="mt-2 space-y-2">
                    <select
                      value={hospiceStatusDraft}
                      onChange={(event) => setHospiceStatusDraft(event.target.value as Database["public"]["Enums"]["hospice_status"])}
                      className="w-full rounded-[8px] border border-input bg-card px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {HOSPICE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {formatStatus(option)}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={actionLoading === "Resident hospice status saved." || hospiceStatusDraft === (row.residents?.hospice_status ?? "none")}
                      onClick={() =>
                        void updateResidentDischargeFields(
                          { hospice_status: hospiceStatusDraft },
                          "Resident hospice status saved.",
                        )
                      }
                    >
                      {actionLoading === "Resident hospice status saved." ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save hospice"}
                    </Button>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Pharmacist reviewed
                  </dt>
                  <dd className="mt-0.5 text-foreground">{formatDischargeDetailTimestamp(row.pharmacist_reviewed_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pharmacist NPI</dt>
                  <dd className="mt-2 space-y-2">
                    <input
                      value={pharmacistNpiDraft}
                      onChange={(event) => setPharmacistNpiDraft(event.target.value)}
                      className="w-full rounded-[8px] border border-input bg-card px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={actionLoading === "Pharmacist NPI saved." || pharmacistNpiDraft === (row.pharmacist_npi ?? "")}
                      onClick={() =>
                        void updateReconciliation(
                          { pharmacist_npi: pharmacistNpiDraft.trim() || null },
                          "Pharmacist NPI saved.",
                        )
                      }
                    >
                      {actionLoading === "Pharmacist NPI saved." ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save NPI"}
                    </Button>
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pharmacist notes</dt>
                  <dd className="mt-2 space-y-3">
                    <textarea
                      value={pharmacistNotesDraft}
                      onChange={(event) => setPharmacistNotesDraft(event.target.value)}
                      rows={4}
                      className="w-full rounded-[8px] border border-input bg-card px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={actionLoading === "Pharmacist notes saved." || pharmacistNotesDraft === (row.pharmacist_notes ?? "")}
                        onClick={() =>
                          void updateReconciliation(
                            { pharmacist_notes: pharmacistNotesDraft.trim() || null },
                            "Pharmacist notes saved.",
                          )
                        }
                      >
                        {actionLoading === "Pharmacist notes saved." ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save pharmacist notes"}
                      </Button>
                    </div>
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Nurse reconciliation notes</dt>
                  <dd className="mt-2 space-y-3">
                    <textarea
                      value={nurseNotesDraft}
                      onChange={(event) => setNurseNotesDraft(event.target.value)}
                      rows={4}
                      className="w-full rounded-[8px] border border-input bg-card px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={actionLoading === "Nurse reconciliation notes saved." || nurseNotesDraft === (row.nurse_reconciliation_notes ?? "")}
                        onClick={() =>
                          void updateReconciliation(
                            { nurse_reconciliation_notes: nurseNotesDraft.trim() || null },
                            "Nurse reconciliation notes saved.",
                          )
                        }
                      >
                        {actionLoading === "Nurse reconciliation notes saved." ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save nurse notes"}
                      </Button>
                    </div>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Updated</dt>
                  <dd className="mt-0.5 text-foreground">{formatDischargeDetailTimestamp(row.updated_at)}</dd>
                </div>
              </dl>
            </div>
          </RecordDetailSection>

          <RecordDetailSection title="Record pharmacist review evidence"><p>Enter the pharmacist NPI and review notes above, including the signed report reference. This records evidence of external review; it does not identify the current operator as the pharmacist.</p><Button disabled={!!actionLoading || !/^\d{10}$/.test(pharmacistNpiDraft) || !pharmacistNotesDraft.trim()} onClick={() => void updateReconciliation({ pharmacist_npi: pharmacistNpiDraft, pharmacist_notes: pharmacistNotesDraft, pharmacist_reviewed_at: new Date().toISOString() }, "Pharmacist review evidence recorded.")}>Record reviewed report</Button></RecordDetailSection>
          <RecordDetailSection title="Medication reconciliation"><DischargeMedicationReview key={row.id} residentId={row.resident_id} initial={row.med_snapshot_json} busy={!!actionLoading} onSave={(snapshot) => void updateReconciliation({ med_snapshot_json: snapshot }, "Medication decisions saved.")} /></RecordDetailSection>


          <RecordDetailSection title="Workflow actions">
            <div className="grid gap-3 sm:grid-cols-3">
              <Button
                type="button"
                variant="outline"
                disabled={row.status === "draft" || !!actionLoading}
                onClick={() => void updateReconciliation({ status: "draft" }, "Reconciliation moved to draft.")}
              >
                {actionLoading === "Reconciliation moved to draft." ? <Loader2 className="h-4 w-4 animate-spin" /> : "Move to draft"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={row.status === "pharmacist_review" || !!actionLoading}
                onClick={() => void updateReconciliation({ status: "pharmacist_review" }, "Reconciliation moved to pharmacist review.")}
              >
                {actionLoading === "Reconciliation moved to pharmacist review." ? <Loader2 className="h-4 w-4 animate-spin" /> : "Move to pharmacist review"}
              </Button>
              <Button
                type="button"
                disabled={row.status === "complete" || !!actionLoading || !row.pharmacist_reviewed_at || !row.med_snapshot_json}
                onClick={() =>
                  void updateReconciliation(
                    {
                      status: "complete",

                    },
                    "Reconciliation marked complete.",
                  )
                }
              >
                {actionLoading === "Reconciliation marked complete." ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mark complete"}
              </Button>
            </div>
          </RecordDetailSection>

          <RecordDetailSection
            title="Official discharge (billing cutoff)"
            description="Use when belongings are removed and the resident is no longer on census. Stops full monthly rent / bed-hold billing. Med rec complete is recommended first."
          >
            {alreadyOfficiallyDischarged ? (
              <p className="text-sm text-muted-foreground">
                Resident status is already{" "}
                <span className="font-medium text-foreground">{formatStatus(row.residents?.status ?? "")}</span>
                {row.residents?.discharge_date ? ` (discharge date ${row.residents.discharge_date})` : ""}.
              </p>
            ) : (
              <div className="space-y-4 text-sm">
                {row.status !== "complete" ? (
                  <p className="rounded-[8px] border border-warning/20 bg-warning/10 px-4 py-3 text-warning">
                    Medication reconciliation is not marked complete yet. You can still record official
                    discharge if belongings are out; finish med rec when able.
                  </p>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Official discharge date (ET)
                    </span>
                    <input
                      type="date"
                      value={officialDischargeDate}
                      onChange={(event) => setOfficialDischargeDate(event.target.value)}
                      className="w-full rounded-[8px] border border-input bg-card px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Discharge reason
                    </span>
                    <select
                      value={officialDischargeReason}
                      onChange={(event) =>
                        setOfficialDischargeReason(
                          event.target.value as Database["public"]["Enums"]["discharge_reason"],
                        )
                      }
                      className="w-full rounded-[8px] border border-input bg-card px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      {DISCHARGE_REASONS.map((reason) => (
                        <option key={reason} value={reason}>
                          {formatStatus(reason)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5 sm:col-span-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Destination (optional)
                    </span>
                    <input
                      value={officialDischargeDestination}
                      onChange={(event) => setOfficialDischargeDestination(event.target.value)}
                      placeholder="Home, another ALF, hospital, etc."
                      className="w-full rounded-[8px] border border-input bg-card px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                </div>
                <Button
                  type="button"
                  disabled={!!actionLoading || !officialDischargeDate}
                  onClick={() => void completeOfficialDischarge()}
                >
                  {actionLoading ===
                  "Official discharge recorded — resident is no longer billable." ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Complete official discharge"
                  )}
                </Button>
              </div>
            )}
          </RecordDetailSection>

          {row.resident_id ? (
            <p className="text-sm text-muted-foreground">
              <Link
                href={`/admin/residents/${row.resident_id}`}
                className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
              >
                Open resident profile
              </Link>{" "}
              for broader resident context and downstream transition planning.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
