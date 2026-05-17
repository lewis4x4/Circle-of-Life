"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { InsuranceHubNav } from "../insurance-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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

          <MotionList className="space-y-3">
             {loading ? (
               <p className="text-sm font-mono text-muted-foreground pl-2">Loading policies…</p>
             ) : rows.length === 0 ? (
               <div className="p-12 text-center rounded-lg border border-dashed border-border bg-muted/20">
                  <p className="font-semibold text-lg text-foreground">No Policies Found</p>
                 <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters or adding a new policy.</p>
               </div>
             ) : (
               rows.map((r) => {
                 const isActive = r.status === "active";
                 const formattedDate = r.expiration_date ? format(parseISO(r.expiration_date.length <= 10 ? `${r.expiration_date}T12:00:00.000Z` : r.expiration_date), "MMM d, yyyy") : "—";
                 
                 return (
                   <MotionItem
                     key={r.id}
                     className="flex items-center gap-3 min-h-[36px] px-[13px] py-2 rounded-lg border border-border bg-card hover:bg-muted/40 hover:-translate-y-0.5 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] relative overflow-hidden"
                   >
                     {isActive && <div className="absolute left-0 top-0 w-1 h-full bg-success rounded-l-lg" />}
                     <div className="flex-1 min-w-0 pl-1 flex flex-col sm:flex-row sm:items-center gap-3">
                       <div className="flex items-center gap-3">
                         <span className={cn(
                           "text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full border",
                           isActive 
                             ? "bg-success/10 text-success border-success/20"
                             : "bg-muted text-muted-foreground border-border"
                         )}>
                           {r.status.replace(/_/g, " ")}
                         </span>
                         <span className="text-sm font-semibold text-foreground tracking-tight">{r.carrier_name}</span>
                       </div>
                       <div className="flex gap-3 items-center text-xs text-muted-foreground">
                         <span className="bg-muted px-2 py-0.5 rounded-md">{r.policy_type.replace(/_/g, " ")}</span>
                         <span>{entityName(r.entity_id)}</span>
                         <span className="font-mono tracking-wider uppercase">Expires: {formattedDate}</span>
                       </div>
                     </div>
                     <div className="shrink-0 flex items-center gap-4">
                       <div className="flex flex-col items-end">
                         <span className="text-[10px] font-mono tracking-wider uppercase text-muted-foreground">Premium</span>
                         <span className="font-semibold text-foreground tabular-nums">{formatUsdFromCents(r.premium_cents)}</span>
                       </div>
                       <Link
                         href={`/admin/insurance/policies/${r.id}`}
                         className={cn(
                           buttonVariants({ variant: "outline", size: "sm" }),
                           "font-mono uppercase tracking-wider text-[10px]"
                         )}
                       >
                         View
                       </Link>
                     </div>
                   </MotionItem>
                 );
               })
             )}
           </MotionList>
        </div>
      </div>
    </div>
  );
}
