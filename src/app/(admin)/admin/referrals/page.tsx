"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ClipboardList, GitMerge, Phone, UserPlus } from "lucide-react";

import { ReferralsHubNav } from "./referrals-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type LeadRow = Pick<
  Database["public"]["Tables"]["referral_leads"]["Row"],
  "id" | "first_name" | "last_name" | "status" | "updated_at"
> & {
  referral_sources: { name: string } | null;
};

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

export default function AdminReferralsHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [counts, setCounts] = useState({
    new: 0,
    pipeline: 0,
    converted: 0,
    attention: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setCounts({ new: 0, pipeline: 0, converted: 0, attention: 0 });
      setLoading(false);
      return;
    }

    try {
      const { data: list, error: listErr } = await supabase
        .from("referral_leads")
        .select("id, first_name, last_name, status, updated_at, referral_sources(name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(50);

      if (listErr) throw listErr;
      setRows((list ?? []) as LeadRow[]);

      const base = () =>
        supabase
          .from("referral_leads")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null);

      const [cNew, cConv, cAtt, cPipe] = await Promise.all([
        base().eq("status", "new"),
        base().eq("status", "converted"),
        base().in("status", ["new", "contacted"]),
        supabase
          .from("referral_leads")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .not("status", "in", "(converted,lost,merged)"),
      ]);

      setCounts({
        new: cNew.count ?? 0,
        pipeline: cPipe.count ?? 0,
        converted: cConv.count ?? 0,
        attention: cAtt.count ?? 0,
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load referrals.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const noFacility = !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Referrals
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Inquiries and pipeline before admission — source attribution, status, and conversion to residents.
        </p>
      </div>

      <ReferralsHubNav />

      {noFacility ? (
        <p className="rounded-lg border border-amber-200/80 bg-amber-50/50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
          Select a facility in the header to load referral leads and metrics.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">New</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">
              {noFacility ? "—" : loading ? "—" : counts.new}
            </p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">Active pipeline</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">
              {noFacility ? "—" : loading ? "—" : counts.pipeline}
            </p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">Converted</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">
              {noFacility ? "—" : loading ? "—" : counts.converted}
            </p>
          </CardContent>
        </Card>
        <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">Needs attention</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums">
              {noFacility ? "—" : loading ? "—" : counts.attention}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/admin/referrals/new" className="group block">
          <Card className="h-full border-slate-200/80 shadow-soft transition-colors hover:border-brand-500/40 dark:border-slate-800">
            <CardHeader className="flex flex-row items-start gap-3 space-y-0">
              <div className="rounded-md bg-slate-100 p-2 dark:bg-slate-900">
                <UserPlus className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              </div>
              <div>
                <CardTitle className="font-display text-base group-hover:text-brand-700 dark:group-hover:text-brand-300">
                  New lead
                </CardTitle>
                <p className="text-xs text-slate-600 dark:text-slate-300">Add an inquiry for the selected facility.</p>
              </div>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/admin/referrals/sources" className="group block">
          <Card className="h-full border-slate-200/80 shadow-soft transition-colors hover:border-brand-500/40 dark:border-slate-800">
            <CardHeader className="flex flex-row items-start gap-3 space-y-0">
              <div className="rounded-md bg-slate-100 p-2 dark:bg-slate-900">
                <Phone className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              </div>
              <div>
                <CardTitle className="font-display text-base group-hover:text-brand-700 dark:group-hover:text-brand-300">
                  Referral sources
                </CardTitle>
                <p className="text-xs text-slate-600 dark:text-slate-300">Hospitals, agencies, web, and other channels</p>
              </div>
            </CardHeader>
          </Card>
        </Link>
      </div>

      <div className="flex flex-wrap items-start gap-2 rounded-lg border border-slate-200/80 bg-slate-50/50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
        <GitMerge className="mt-0.5 h-4 w-4 shrink-0 text-slate-600 dark:text-slate-300" />
        <span>
          Duplicate merge and status transitions follow org policy; merge is restricted to owner / org admin by default (
          <span className="whitespace-nowrap">spec: `01-referral-inquiry.md`</span>).
        </span>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          <ClipboardList className="h-4 w-4 shrink-0" />
          Pipeline leads
        </div>
        {loadError ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {loadError}
          </p>
        ) : null}
        <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {noFacility ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                    Select a facility to view leads.
                  </TableCell>
                </TableRow>
              ) : loading ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                    No leads yet. Use <strong>New lead</strong> to add one.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id} className="hover:bg-transparent">
                    <TableCell className="font-medium">
                      <Link
                        href={`/admin/referrals/${r.id}`}
                        className="text-brand-700 hover:underline dark:text-brand-300"
                      >
                        {r.first_name} {r.last_name}
                      </Link>
                    </TableCell>
                    <TableCell className="capitalize">{formatStatus(r.status)}</TableCell>
                    <TableCell>{r.referral_sources?.name ?? "—"}</TableCell>
                    <TableCell className="text-right text-slate-600 dark:text-slate-400">
                      {new Date(r.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-slate-600 dark:text-slate-300">
        <span>Admissions start from a lead or a resident record:</span>
        <Link href="/admin/residents/new" className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs")}>
          New resident
        </Link>
      </div>
    </div>
  );
}
