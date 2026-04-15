"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { DischargeHubNav } from "../discharge-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { useHavenAuth } from "@/contexts/haven-auth-context";

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
      setError(qErr.message);
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
      setActionError(err instanceof Error ? err.message : "Could not update discharge reconciliation.");
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
      setActionError(err instanceof Error ? err.message : "Could not update resident discharge planning.");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">
            <Link href="/admin/discharge" className="hover:text-brand-600 dark:hover:text-brand-400">
              Discharge
            </Link>{" "}
            / Reconciliation
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Med reconciliation
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Operational workspace for discharge reconciliation, pharmacist attestation, and transition notes.
          </p>
        </div>
        <Link href="/admin/discharge" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Back to pipeline
        </Link>
      </div>

      <DischargeHubNav />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading…
        </div>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : !row ? (
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardContent className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
            No row found for this id, or you do not have access.
          </CardContent>
        </Card>
      ) : (
        <>
          {actionError ? (
            <p className="rounded-lg border border-red-200/80 bg-red-50/50 px-4 py-3 text-sm text-red-950 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100">
              {actionError}
            </p>
          ) : null}
          {actionMessage ? (
            <p className="rounded-lg border border-emerald-200/80 bg-emerald-50/50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100">
              {actionMessage}
            </p>
          ) : null}
          {wrongFacility ? (
            <p className="rounded-lg border border-amber-200/80 bg-amber-50/50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
              This record belongs to another facility. Switch the facility in the header to align context.
            </p>
          ) : null}

          <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
            <CardHeader>
              <CardTitle className="font-display text-lg">
                {row.residents ? `${row.residents.first_name} ${row.residents.last_name}` : "Resident"}
              </CardTitle>
              <p className="font-mono text-xs break-all text-slate-600 dark:text-slate-300">{row.id}</p>
            </CardHeader>
            <CardContent className="space-y-6 text-sm">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</dt>
                  <dd className="mt-0.5 capitalize text-slate-900 dark:text-slate-100">{formatStatus(row.status)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Discharge target (resident)
                  </dt>
                  <dd className="mt-2 space-y-2">
                    <input
                      type="date"
                      value={dischargeTargetDraft}
                      onChange={(event) => setDischargeTargetDraft(event.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Hospice (resident)
                  </dt>
                  <dd className="mt-2 space-y-2">
                    <select
                      value={hospiceStatusDraft}
                      onChange={(event) => setHospiceStatusDraft(event.target.value as Database["public"]["Enums"]["hospice_status"])}
                      className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Pharmacist reviewed
                  </dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{formatTs(row.pharmacist_reviewed_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Pharmacist NPI</dt>
                  <dd className="mt-2 space-y-2">
                    <input
                      value={pharmacistNpiDraft}
                      onChange={(event) => setPharmacistNpiDraft(event.target.value)}
                      className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2.5 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Pharmacist notes</dt>
                  <dd className="mt-2 space-y-3">
                    <textarea
                      value={pharmacistNotesDraft}
                      onChange={(event) => setPharmacistNotesDraft(event.target.value)}
                      rows={4}
                      className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-3 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Nurse reconciliation notes</dt>
                  <dd className="mt-2 space-y-3">
                    <textarea
                      value={nurseNotesDraft}
                      onChange={(event) => setNurseNotesDraft(event.target.value)}
                      rows={4}
                      className="w-full rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-3 text-sm text-slate-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Updated</dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{formatTs(row.updated_at)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
            <CardHeader>
              <CardTitle className="font-display text-lg">Med snapshot (JSON)</CardTitle>
            </CardHeader>
            <CardContent>
              {snapshotStr ? (
                <pre className="max-h-64 overflow-auto rounded-lg border border-slate-200/80 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900">
                  {snapshotStr}
                </pre>
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-300">No snapshot stored.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
            <CardHeader>
              <CardTitle className="font-display text-lg">Workflow actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
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
            </CardContent>
          </Card>

          {row.resident_id ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">
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
