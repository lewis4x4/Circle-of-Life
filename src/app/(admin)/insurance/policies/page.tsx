"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { InsuranceHubNav } from "../insurance-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/ui/status-pill";
import { TABLE_HEADER_CLASS, TABLE_ROW_CLASS } from "@/lib/design/row-classes";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { createClient } from "@/lib/supabase/client";
import { canMutateFinance, loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import { Constants, type Database } from "@/types/database";
import { format, parseISO } from "date-fns";

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
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6 max-w-5xl mx-auto">
        <InsuranceHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-border shadow-sm mt-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-4">
              Policies
            </h1>
            <p className="mt-2 font-medium tracking-wide text-muted-foreground max-w-2xl">
              Entity-level corporate insurance inventory.
            </p>
          </div>
          {canWrite && (
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/admin/insurance/policies/new" className={cn(buttonVariants({ size: "default" }), "font-mono uppercase tracking-wider text-[10px]")} >
                 + New Policy
              </Link>
            </div>
          )}
        </header>

        {loadError && (
          <p className="text-sm text-destructive" role="alert">
            {loadError}
          </p>
        )}

        <div className="p-6 rounded-lg border border-border bg-card">
          <div className="flex flex-col md:flex-row gap-4 mb-6 pb-6 border-b border-border">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="ent" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Entity</Label>
              <select
                id="ent"
                className="w-full h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm"
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
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="st" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</Label>
              <select
                id="st"
                className="w-full h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm"
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
            <div className="flex items-end">
              <Button type="button" variant="outline" className="h-10 rounded-lg px-6 border-border" onClick={() => void load()}>
                Apply Filters
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between pb-4 mb-4 border-b border-border pl-2">
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground">
              Policy List
            </h3>
            <span className="text-xs font-medium text-muted-foreground">{loading ? "Loading…" : `${rows.length} policies`}</span>
          </div>

          {loading ? (
            <p className="text-sm font-mono text-muted-foreground pl-2">Loading policies…</p>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center rounded-lg border border-dashed border-border bg-muted/20">
               <p className="font-semibold text-lg text-foreground">No Policies Found</p>
              <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters or adding a new policy.</p>
            </div>
          ) : (
            <>
              <div className={TABLE_HEADER_CLASS}>
                <span className="w-[110px] shrink-0">Status</span>
                <span className="flex-[2] min-w-0">Carrier</span>
                <span className="flex-1 min-w-0">Type</span>
                <span className="flex-1 min-w-0">Entity</span>
                <span className="w-[110px] shrink-0">Expires</span>
                <span className="w-[120px] shrink-0 text-right">Premium</span>
                <span className="w-[72px] shrink-0 text-right">Action</span>
              </div>
              <MotionList className="space-y-1 mt-2">
                {rows.map((r) => {
                  const isActive = r.status === "active";
                  const formattedDate = r.expiration_date ? format(parseISO(r.expiration_date.length <= 10 ? `${r.expiration_date}T12:00:00.000Z` : r.expiration_date), "MMM d, yyyy") : "—";

                  return (
                    <MotionItem key={r.id} className={cn(TABLE_ROW_CLASS, "group")}>
                      <div className="w-[110px] shrink-0">
                        <StatusPill tone={isActive ? "neutral" : "warning"}>
                          {r.status.replace(/_/g, " ")}
                        </StatusPill>
                      </div>
                      <span className="flex-[2] min-w-0 truncate text-[13px] font-medium text-foreground">
                        {r.carrier_name}
                      </span>
                      <span className="flex-1 min-w-0 truncate text-[12px] text-muted-foreground capitalize">
                        {r.policy_type.replace(/_/g, " ")}
                      </span>
                      <span className="flex-1 min-w-0 truncate text-[12px] text-muted-foreground">
                        {entityName(r.entity_id)}
                      </span>
                      <span className="w-[110px] shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
                        {formattedDate}
                      </span>
                      <span className="w-[120px] shrink-0 text-right font-mono text-[13px] font-medium tabular-nums text-foreground">
                        {formatUsdFromCents(r.premium_cents)}
                      </span>
                      <div className="w-[72px] shrink-0 flex justify-end">
                        <Link
                          href={`/admin/insurance/policies/${r.id}`}
                          className={cn(
                            buttonVariants({ variant: "outline", size: "sm" }),
                            "h-7 px-2.5 font-mono uppercase tracking-wider text-[10px]"
                          )}
                        >
                          View
                        </Link>
                      </div>
                    </MotionItem>
                  );
                })}
              </MotionList>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
