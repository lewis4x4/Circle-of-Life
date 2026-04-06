"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Umbrella } from "lucide-react";

import { InsuranceHubNav } from "./insurance-hub-nav";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { computeTotalCostOfRisk, type TcorSnapshot } from "@/lib/insurance/compute-tcor";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";

export default function AdminInsuranceHubPage() {
  const supabase = createClient();
  const [activePolicies, setActivePolicies] = useState<number | null>(null);
  const [renewalsInFlight, setRenewalsInFlight] = useState<number | null>(null);
  const [openClaims, setOpenClaims] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [entities, setEntities] = useState<{ id: string; name: string }[]>([]);
  const [entityFilter, setEntityFilter] = useState("");
  const [tcor, setTcor] = useState<TcorSnapshot | null>(null);
  const [tcorError, setTcorError] = useState<string | null>(null);
  const [tcorLoading, setTcorLoading] = useState(false);

  const loadTcor = useCallback(
    async (oid: string) => {
      setTcorLoading(true);
      setTcorError(null);
      try {
        const r = await computeTotalCostOfRisk(supabase, {
          organizationId: oid,
          entityId: entityFilter || null,
        });
        if (!r.ok) {
          setTcor(null);
          setTcorError(r.error);
          return;
        }
        setTcor(r.snapshot);
      } finally {
        setTcorLoading(false);
      }
    },
    [supabase, entityFilter],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setActivePolicies(null);
        setRenewalsInFlight(null);
        setOpenClaims(null);
        setOrgId(null);
        setEntities([]);
        setLoadError(ctx.error);
        return;
      }
      const oid = ctx.ctx.organizationId;
      setOrgId(oid);

      const [{ data: entRows }, { count: polCount, error: e1 }, { count: renCount, error: e2 }, { count: clCount, error: e3 }] =
        await Promise.all([
          supabase
            .from("entities")
            .select("id, name")
            .eq("organization_id", oid)
            .is("deleted_at", null)
            .order("name"),
          supabase
            .from("insurance_policies")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", oid)
            .eq("status", "active")
            .is("deleted_at", null),
          supabase
            .from("insurance_renewals")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", oid)
            .in("status", ["upcoming", "in_progress"])
            .is("deleted_at", null),
          supabase
            .from("insurance_claims")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", oid)
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
      setEntities((entRows ?? []) as { id: string; name: string }[]);
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

  useEffect(() => {
    if (!orgId) return;
    void loadTcor(orgId);
  }, [orgId, loadTcor]);

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
          <CardTitle className="text-base">Total cost of risk (TCoR)</CardTitle>
          <CardDescription>
            Module 18 Enhanced — rolling ~12 months. Premiums sum stated policy premiums for in-force policies
            overlapping the window; losses sum paid + reserve on claims whose loss date (or reported date) falls in the
            window. Operational estimate, not GAAP.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="tcor-entity">Entity</Label>
              <select
                id="tcor-entity"
                className="h-9 min-w-[220px] rounded-md border border-input bg-transparent px-3 text-sm shadow-xs dark:bg-input/30"
                value={entityFilter}
                onChange={(e) => setEntityFilter(e.target.value)}
                disabled={loading || !orgId}
              >
                <option value="">All entities</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {tcorError ? (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {tcorError}
            </p>
          ) : null}
          {tcorLoading ? (
            <p className="text-sm text-slate-500">Loading TCoR…</p>
          ) : tcor ? (
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <p className="text-slate-600 dark:text-slate-400">
                <span className="font-medium text-slate-800 dark:text-slate-200">Window:</span>{" "}
                <span className="font-mono text-xs">
                  {tcor.periodStart} → {tcor.periodEnd}
                </span>
              </p>
              <p className="text-slate-600 dark:text-slate-400">
                <span className="font-medium text-slate-800 dark:text-slate-200">Policies in window:</span>{" "}
                {tcor.policyRows}
              </p>
              <p>
                <span className="text-slate-500">Premiums (stated):</span>{" "}
                <span className="font-semibold tabular-nums">{formatUsdFromCents(tcor.premiumsCents)}</span>
              </p>
              <p>
                <span className="text-slate-500">Incurred losses (paid + reserve, {tcor.claimRows} claims):</span>{" "}
                <span className="font-semibold tabular-nums">{formatUsdFromCents(tcor.incurredLossesCents)}</span>
              </p>
              <p className="md:col-span-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                <span className="text-slate-500">TCoR (simple sum):</span>{" "}
                <span className="text-lg font-semibold tabular-nums text-slate-900 dark:text-white">
                  {formatUsdFromCents(tcor.tcorCents)}
                </span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No TCoR data.</p>
          )}
        </CardContent>
      </Card>

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
          <Link className="text-primary underline-offset-4 hover:underline" href="/admin/insurance/renewal-packages">
            Renewal data packages
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
