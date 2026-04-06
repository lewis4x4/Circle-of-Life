"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { AdmissionsHubNav } from "../admissions-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type CaseDetail = Database["public"]["Tables"]["admission_cases"]["Row"] & {
  residents: { first_name: string; last_name: string } | null;
  referral_leads: { first_name: string; last_name: string } | null;
  beds: { bed_label: string } | null;
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

export default function AdminAdmissionCaseDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [row, setRow] = useState<CaseDetail | null>(null);
  const [rateTerms, setRateTerms] = useState<Database["public"]["Tables"]["admission_case_rate_terms"]["Row"][]>([]);

  const load = useCallback(async () => {
    if (!id) {
      setRow(null);
      setRateTerms([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const [{ data: c, error: cErr }, { data: rt }] = await Promise.all([
      supabase
        .from("admission_cases")
        .select("*, residents(first_name, last_name), referral_leads(first_name, last_name), beds(bed_label)")
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle(),
      supabase.from("admission_case_rate_terms").select("*").eq("admission_case_id", id),
    ]);

    if (cErr) {
      setError(cErr.message);
      setRow(null);
      setRateTerms([]);
    } else {
      setRow(c as CaseDetail | null);
      setRateTerms((rt ?? []) as Database["public"]["Tables"]["admission_case_rate_terms"]["Row"][]);
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

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">
            <Link href="/admin/admissions" className="hover:text-brand-600 dark:hover:text-brand-400">
              Admissions
            </Link>{" "}
            / Case
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Admission case
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Read-only view; status transitions and rate quotes can ship in a follow-up.
          </p>
        </div>
        <Link href="/admin/admissions" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Back to pipeline
        </Link>
      </div>

      <AdmissionsHubNav />

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
            No case found for this id, or you do not have access.
          </CardContent>
        </Card>
      ) : (
        <>
          {wrongFacility ? (
            <p className="rounded-lg border border-amber-200/80 bg-amber-50/50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
              This case belongs to another facility. Switch the facility in the header to match.
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
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Target move-in</dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{row.target_move_in_date ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Referral lead</dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">
                    {row.referral_leads
                      ? `${row.referral_leads.first_name} ${row.referral_leads.last_name}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Bed</dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{row.beds?.bed_label ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Financial clearance</dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{formatTs(row.financial_clearance_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Physician orders</dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{formatTs(row.physician_orders_received_at)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Physician orders summary</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-slate-900 dark:text-slate-100">
                    {row.physician_orders_summary ?? "—"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Notes</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-slate-900 dark:text-slate-100">{row.notes ?? "—"}</dd>
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
              <CardTitle className="font-display text-lg">Quoted rate terms</CardTitle>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Rows in <code className="text-xs">admission_case_rate_terms</code> (add UI in a follow-up).
              </p>
            </CardHeader>
            <CardContent>
              {rateTerms.length === 0 ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">No rate quotes recorded.</p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-800">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Accommodation</TableHead>
                        <TableHead className="text-right">Base (¢)</TableHead>
                        <TableHead className="text-right">Care (¢)</TableHead>
                        <TableHead>Effective</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rateTerms.map((t) => (
                        <TableRow key={t.id} className="hover:bg-transparent">
                          <TableCell className="capitalize">{t.accommodation_type.replace("_", " ")}</TableCell>
                          <TableCell className="text-right tabular-nums">{t.quoted_base_rate_cents}</TableCell>
                          <TableCell className="text-right tabular-nums">{t.quoted_care_surcharge_cents}</TableCell>
                          <TableCell>{t.effective_date ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
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
              </Link>
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
