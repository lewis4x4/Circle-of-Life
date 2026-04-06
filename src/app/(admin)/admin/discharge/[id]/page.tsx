"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { DischargeHubNav } from "../discharge-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type RowT = Database["public"]["Tables"]["discharge_med_reconciliation"]["Row"] & {
  residents: { first_name: string; last_name: string; discharge_target_date: string | null; hospice_status: string } | null;
};

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

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [row, setRow] = useState<RowT | null>(null);

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
      setRow(data as RowT | null);
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
            Read-only Core view; pharmacist attestation edits follow in a later segment.
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
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">
                    {row.residents?.discharge_target_date ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Hospice (resident)
                  </dt>
                  <dd className="mt-0.5 capitalize text-slate-900 dark:text-slate-100">
                    {row.residents?.hospice_status ? formatStatus(row.residents.hospice_status) : "—"}
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
                  <dd className="mt-0.5 font-mono text-xs text-slate-900 dark:text-slate-100">{row.pharmacist_npi ?? "—"}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Pharmacist notes</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-slate-900 dark:text-slate-100">{row.pharmacist_notes ?? "—"}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Nurse reconciliation notes</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-slate-900 dark:text-slate-100">{row.nurse_reconciliation_notes ?? "—"}</dd>
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

          {row.resident_id ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              <Link
                href={`/admin/residents/${row.resident_id}`}
                className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
              >
                Open resident profile
              </Link>{" "}
              to set <code className="text-xs">discharge_target_date</code> and <code className="text-xs">hospice_status</code>.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
