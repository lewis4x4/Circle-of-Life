"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Umbrella } from "lucide-react";

import { InsuranceHubNav } from "./insurance-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";

export default function AdminInsuranceHubPage() {
  const supabase = createClient();
  const [activePolicies, setActivePolicies] = useState<number | null>(null);
  const [renewalsInFlight, setRenewalsInFlight] = useState<number | null>(null);
  const [openClaims, setOpenClaims] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setActivePolicies(null);
        setRenewalsInFlight(null);
        setOpenClaims(null);
        setLoadError(ctx.error);
        return;
      }
      const orgId = ctx.ctx.organizationId;
      const [{ count: polCount, error: e1 }, { count: renCount, error: e2 }, { count: clCount, error: e3 }] =
        await Promise.all([
          supabase
            .from("insurance_policies")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .eq("status", "active")
            .is("deleted_at", null),
          supabase
            .from("insurance_renewals")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .in("status", ["upcoming", "in_progress"])
            .is("deleted_at", null),
          supabase
            .from("insurance_claims")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId)
            .in("status", ["reported", "investigating", "reserved", "partially_paid"])
            .is("deleted_at", null),
        ]);
      const err = e1 ?? e2 ?? e3;
      if (err) {
        setLoadError(err.message);
        setActivePolicies(null);
        setRenewalsInFlight(null);
        setOpenClaims(null);
        return;
      }
      setActivePolicies(polCount ?? 0);
      setRenewalsInFlight(renCount ?? 0);
      setOpenClaims(clCount ?? 0);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  return (
    <div className="space-y-6">
      <InsuranceHubNav />
      <div className="flex items-center gap-3">
        <Umbrella className="h-8 w-8 text-slate-600 dark:text-slate-300" aria-hidden />
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Insurance & risk</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Corporate policies, renewals, claims, COIs, and workers’ compensation (Module 18).
          </p>
        </div>
      </div>

      {loadError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active policies</CardTitle>
            <CardDescription>Policies in active status.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{loading ? "…" : activePolicies ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Renewals in progress</CardTitle>
            <CardDescription>Upcoming or in-progress renewal workflows.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{loading ? "…" : renewalsInFlight ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open claims</CardTitle>
            <CardDescription>GL claims not closed, denied, or withdrawn.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{loading ? "…" : openClaims ?? "—"}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick links</CardTitle>
          <CardDescription>Navigate insurance workflows.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <Link className="text-primary underline-offset-4 hover:underline" href="/admin/insurance/policies">
            Policy inventory
          </Link>
          <Link className="text-primary underline-offset-4 hover:underline" href="/admin/insurance/renewals">
            Renewals
          </Link>
          <Link className="text-primary underline-offset-4 hover:underline" href="/admin/insurance/claims">
            Claims
          </Link>
          <Link className="text-primary underline-offset-4 hover:underline" href="/admin/insurance/coi">
            Certificates of insurance
          </Link>
          <Link className="text-primary underline-offset-4 hover:underline" href="/admin/insurance/workers-comp">
            Workers’ comp
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
