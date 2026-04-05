"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { InsuranceHubNav } from "../insurance-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { canMutateFinance, loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import { Constants, type Database } from "@/types/database";

type PolicyRow = Database["public"]["Tables"]["insurance_policies"]["Row"];
type EntityMini = { id: string; name: string };

export default function InsurancePoliciesPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<PolicyRow[]>([]);
  const [entities, setEntities] = useState<EntityMini[]>([]);
  const [entityFilter, setEntityFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof loadFinanceRoleContext>> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const c = await loadFinanceRoleContext(supabase);
    setCtx(c);
    if (!c.ok) {
      setRows([]);
      setLoadError(c.error);
      setLoading(false);
      return;
    }
    const { data: ent, error: entErr } = await supabase
      .from("entities")
      .select("id, name")
      .eq("organization_id", c.ctx.organizationId)
      .is("deleted_at", null)
      .order("name");
    if (entErr) {
      setLoadError(entErr.message);
      setRows([]);
      setLoading(false);
      return;
    }
    setEntities((ent ?? []) as EntityMini[]);

    let q = supabase
      .from("insurance_policies")
      .select("*")
      .eq("organization_id", c.ctx.organizationId)
      .is("deleted_at", null)
      .order("expiration_date", { ascending: true });
    if (entityFilter) q = q.eq("entity_id", entityFilter);
    if (statusFilter) q = q.eq("status", statusFilter as PolicyRow["status"]);
    const { data, error: polErr } = await q;
    if (polErr) {
      setLoadError(polErr.message);
      setRows([]);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as PolicyRow[]);
    setLoading(false);
  }, [supabase, entityFilter, statusFilter]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const entityName = useMemo(() => {
    const m = new Map(entities.map((e) => [e.id, e.name]));
    return (id: string) => m.get(id) ?? id;
  }, [entities]);

  const canWrite = ctx?.ok && canMutateFinance(ctx.ctx.appRole);

  return (
    <div className="space-y-6">
      <InsuranceHubNav />
      {loadError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Policies</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Entity-level corporate insurance inventory.</p>
        </div>
        {canWrite && (
          <Link className={cn(buttonVariants({ size: "sm" }))} href="/admin/insurance/policies/new">
            New policy
          </Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>Scope by entity and status.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <div className="space-y-1">
            <Label htmlFor="ent">Entity</Label>
            <select
              id="ent"
              className="flex h-10 min-w-[200px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
            >
              <option value="">All entities</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="st">Status</Label>
            <select
              id="st"
              className="flex h-10 min-w-[180px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              {Constants.public.Enums.insurance_policy_status.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <Button type="button" variant="outline" size="sm" className="mt-6" onClick={() => void load()}>
            Refresh
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Policy list</CardTitle>
          <CardDescription>{loading ? "Loading…" : `${rows.length} row(s)`}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="py-2 pr-4 font-medium">Carrier</th>
                <th className="py-2 pr-4 font-medium">Entity</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Expires</th>
                <th className="py-2 pr-4 font-medium">Premium</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-900">
                  <td className="py-2 pr-4">{r.carrier_name}</td>
                  <td className="py-2 pr-4">{entityName(r.entity_id)}</td>
                  <td className="py-2 pr-4">{r.policy_type.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-4">{r.status.replace(/_/g, " ")}</td>
                  <td className="py-2 pr-4">{r.expiration_date}</td>
                  <td className="py-2 pr-4 tabular-nums">{formatUsdFromCents(r.premium_cents)}</td>
                  <td className="py-2">
                    <Link className="text-primary underline-offset-4 hover:underline" href={`/admin/insurance/policies/${r.id}`}>
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && (
            <p className="text-sm text-slate-600 dark:text-slate-400">No policies match filters.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
