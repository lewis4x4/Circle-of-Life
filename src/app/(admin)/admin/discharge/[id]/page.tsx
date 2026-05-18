"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

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

type RowT = Database["public"]["Tables"]["discharge_med_reconciliation"]["Row"] & {
  residents: { first_name: string; last_name: string; discharge_target_date: string | null; hospice_status: string } | null;
};

const HOSPICE_OPTIONS: Array<Database["public"]["Enums"]["hospice_status"]> = [
  "none",
  "pending",
  "active",
  "ended",
];

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

function formatTs(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function AdminDischargeDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();
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
        "*, residents(first_name, last_name, discharge_target_date, hospice_status)",
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

  const snapshotStr =
    row?.med_snapshot_json != null ? JSON.stringify(row.med_snapshot_json, null, 2) : null;

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
                  <dd className="mt-0.5 text-foreground">{formatTs(row.pharmacist_reviewed_at)}</dd>
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
                  <dd className="mt-0.5 text-foreground">{formatTs(row.updated_at)}</dd>
                </div>
              </dl>
            </div>
          </RecordDetailSection>

          <RecordDetailSection title="Med snapshot (JSON)">
            {snapshotStr ? (
              <pre className="max-h-64 overflow-auto rounded-[8px] border border-border bg-muted p-3 text-xs">
                {snapshotStr}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">No snapshot stored.</p>
            )}
          </RecordDetailSection>

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
                disabled={row.status === "complete" || !!actionLoading}
                onClick={() =>
                  void updateReconciliation(
                    {
                      status: "complete",
                      pharmacist_reviewed_at: row.pharmacist_reviewed_at ?? new Date().toISOString(),
                      pharmacist_reviewed_by: row.pharmacist_reviewed_by ?? user?.id ?? null,
                    },
                    "Reconciliation marked complete.",
                  )
                }
              >
                {actionLoading === "Reconciliation marked complete." ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mark complete"}
              </Button>
            </div>
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
