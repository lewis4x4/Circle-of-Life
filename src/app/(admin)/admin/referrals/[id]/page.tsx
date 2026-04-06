"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { ReferralsHubNav } from "../referrals-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type LeadDetail = Database["public"]["Tables"]["referral_leads"]["Row"] & {
  referral_sources: { name: string } | null;
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

export default function AdminReferralLeadDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lead, setLead] = useState<LeadDetail | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setLead(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("referral_leads")
      .select(
        "*, referral_sources(name)",
      )
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (qErr) {
      setError(qErr.message);
      setLead(null);
    } else {
      setLead(data as LeadDetail | null);
    }
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const wrongFacility =
    lead &&
    selectedFacilityId &&
    isValidFacilityIdForQuery(selectedFacilityId) &&
    lead.facility_id !== selectedFacilityId;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">
            <Link href="/admin/referrals" className="hover:text-brand-600 dark:hover:text-brand-400">
              Referrals
            </Link>{" "}
            / Lead
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Lead detail
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Read-only view of pipeline fields; status edits ship in a follow-up.
          </p>
        </div>
        <Link href="/admin/referrals" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Back to pipeline
        </Link>
      </div>

      <ReferralsHubNav />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading lead…
        </div>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : !lead ? (
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardContent className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
            No lead found for this id, or you do not have access.
          </CardContent>
        </Card>
      ) : (
        <>
          {wrongFacility ? (
            <p className="rounded-lg border border-amber-200/80 bg-amber-50/50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
              This lead belongs to another facility. Switch the facility in the header to{" "}
              <span className="font-mono text-xs">{lead.facility_id}</span> to align context.
            </p>
          ) : null}

          <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
            <CardHeader>
              <CardTitle className="font-display text-lg">
                {lead.first_name} {lead.last_name}
                {lead.preferred_name ? (
                  <span className="ml-2 text-base font-normal text-slate-600 dark:text-slate-400">
                    (“{lead.preferred_name}”)
                  </span>
                ) : null}
              </CardTitle>
              <p className="font-mono text-xs break-all text-slate-600 dark:text-slate-300">{lead.id}</p>
            </CardHeader>
            <CardContent className="space-y-6 text-sm">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Status</dt>
                  <dd className="mt-0.5 capitalize text-slate-900 dark:text-slate-100">{formatStatus(lead.status)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">PII tier</dt>
                  <dd className="mt-0.5 font-mono text-xs text-slate-900 dark:text-slate-100">{lead.pii_access_tier}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Referral source</dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{lead.referral_sources?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Date of birth</dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{lead.date_of_birth ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Phone</dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{lead.phone ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Email</dt>
                  <dd className="mt-0.5 break-all text-slate-900 dark:text-slate-100">{lead.email ?? "—"}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Notes</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-slate-900 dark:text-slate-100">{lead.notes ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Converted resident</dt>
                  <dd className="mt-0.5 font-mono text-xs text-slate-900 dark:text-slate-100">
                    {lead.converted_resident_id ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Converted at</dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{formatTs(lead.converted_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Created</dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{formatTs(lead.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Updated</dt>
                  <dd className="mt-0.5 text-slate-900 dark:text-slate-100">{formatTs(lead.updated_at)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
