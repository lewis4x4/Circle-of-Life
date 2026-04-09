"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { InsuranceHubNav } from "../insurance-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { AmbientMatrix } from "@/components/ui/moonshot/ambient-matrix";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
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
      <AmbientMatrix hasCriticals={rows.some(r => r.status === "cancelled")} 
        primaryClass="bg-slate-500/10"
        secondaryClass="bg-indigo-500/10"
      />
      
      <div className="relative z-10 space-y-6 max-w-5xl mx-auto">
        <InsuranceHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
          <div className="space-y-2">
            <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Policies {rows.some(r => r.status === "cancelled") && <PulseDot colorClass="bg-red-500" />}
            </h1>
            <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
              Entity-level corporate insurance inventory.
            </p>
          </div>
          {canWrite && (
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/admin/insurance/policies/new" className={cn(buttonVariants({ size: "default" }), "h-12 px-6 rounded-full font-bold uppercase tracking-widest text-[10px] tap-responsive bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg")} >
                 + New Policy
              </Link>
            </div>
          )}
        </header>

        {loadError && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {loadError}
          </p>
        )}

        <div className="glass-panel p-6 rounded-[2.5rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02]">
          <div className="flex flex-col md:flex-row gap-4 mb-6 pb-6 border-b border-slate-200 dark:border-white/5">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="ent" className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Entity</Label>
              <select
                id="ent"
                className="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-900 shadow-sm"
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
              <Label htmlFor="st" className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Status</Label>
              <select
                id="st"
                className="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-900 shadow-sm"
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
              <Button type="button" variant="outline" className="h-10 rounded-xl px-6 bg-white dark:bg-white/5 border-slate-200 dark:border-white/10" onClick={() => void load()}>
                Apply Filters
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200 dark:border-white/5 pl-2">
            <h3 className="text-[12px] font-bold uppercase tracking-widest text-slate-800 dark:text-slate-200">
              Policy List
            </h3>
            <span className="text-xs font-medium text-slate-500">{loading ? "Loading…" : `${rows.length} policies`}</span>
          </div>

          <MotionList className="space-y-3">
             {loading ? (
               <p className="text-sm font-mono text-slate-500 pl-2">Loading policies…</p>
             ) : rows.length === 0 ? (
               <div className="p-12 text-center text-slate-500 bg-white/50 dark:bg-white/[0.02] rounded-[2.5rem] border border-dashed border-slate-200 dark:border-white/10 backdrop-blur-md">
                  <p className="font-semibold text-lg text-slate-900 dark:text-slate-100">No Policies Found</p>
                 <p className="text-sm opacity-80 mt-1">Try adjusting your filters or adding a new policy.</p>
               </div>
             ) : (
               rows.map((r) => {
                 const isActive = r.status === "active";
                 const formattedDate = r.expiration_date ? format(parseISO(r.expiration_date.length <= 10 ? `${r.expiration_date}T12:00:00.000Z` : r.expiration_date), "MMM d, yyyy") : "—";
                 
                 return (
                   <MotionItem
                     key={r.id}
                     className={cn(
                       "p-5 rounded-[1.5rem] border shadow-sm flex flex-col sm:flex-row gap-4 sm:items-center justify-between group overflow-hidden relative transition-colors",
                       isActive 
                         ? "border-emerald-200/80 bg-white dark:border-emerald-900/30 dark:bg-emerald-950/20 hover:border-emerald-300 dark:hover:border-emerald-800/40"
                         : "border-slate-200/80 bg-white dark:border-white/5 dark:bg-white/[0.03] hover:border-slate-300 dark:hover:border-white/20"
                     )}
                   >
                     {isActive && <div className="absolute left-0 top-0 w-1.5 h-full bg-emerald-500" />}
                     <div className="flex-1 min-w-0 pl-1">
                       <div className="flex items-center gap-3 mb-1">
                         <span className={cn(
                           "text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border",
                           isActive 
                             ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20" 
                             : "bg-slate-100 text-slate-600 border-slate-200 dark:bg-white/5 dark:text-slate-400 dark:border-white/10"
                         )}>
                           {r.status.replace(/_/g, " ")}
                         </span>
                         <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                           Expires: {formattedDate}
                         </span>
                       </div>
                       <p className="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight mt-2">{r.carrier_name}</p>
                       <div className="flex gap-4 mt-1 items-center">
                         <span className="text-slate-400 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-md text-xs font-medium">{r.policy_type.replace(/_/g, " ")}</span>
                         <span className="text-slate-500 text-sm">{entityName(r.entity_id)}</span>
                       </div>
                       <div className="mt-3">
                         <p className="text-[10px] font-mono tracking-widest uppercase text-slate-400 mb-0.5">Premium</p>
                         <p className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">{formatUsdFromCents(r.premium_cents)}</p>
                       </div>
                     </div>
                     <div className="shrink-0 flex items-center gap-3 pl-1 sm:pl-0">
                       <Link
                         href={`/admin/insurance/policies/${r.id}`}
                         className={cn(
                           buttonVariants({ variant: "outline", size: "sm" }),
                           "h-10 rounded-full px-5 font-bold uppercase tracking-widest text-[10px] bg-white dark:bg-white/5 dark:border-white/10"
                         )}
                       >
                         View Details
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
