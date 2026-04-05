"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { InsuranceHubNav } from "../../insurance-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import type { Database } from "@/types/database";

type Policy = Database["public"]["Tables"]["insurance_policies"]["Row"];
type Renewal = Database["public"]["Tables"]["insurance_renewals"]["Row"];
type Claim = Database["public"]["Tables"]["insurance_claims"]["Row"];
type Alloc = Database["public"]["Tables"]["premium_allocations"]["Row"];

export default function InsurancePolicyDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [entityName, setEntityName] = useState<string>("");
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [allocs, setAllocs] = useState<Alloc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const ctx = await loadFinanceRoleContext(supabase);
    if (!ctx.ok) {
      setError(ctx.error);
      setLoading(false);
      return;
    }
    const { data: pol, error: pErr } = await supabase.from("insurance_policies").select("*").eq("id", id).maybeSingle();
    if (pErr || !pol) {
      setError(pErr?.message ?? "Policy not found.");
      setPolicy(null);
      setLoading(false);
      return;
    }
    const p = pol as Policy;
    setPolicy(p);
    const { data: ent, error: entErr } = await supabase.from("entities").select("name").eq("id", p.entity_id).maybeSingle();
    if (entErr) {
      setError(entErr.message);
      setLoading(false);
      return;
    }
    setEntityName((ent as { name: string } | null)?.name ?? p.entity_id);

    const [{ data: r, error: rErr }, { data: c, error: cErr }, { data: a, error: aErr }] = await Promise.all([
      supabase
        .from("insurance_renewals")
        .select("*")
        .eq("insurance_policy_id", id)
        .is("deleted_at", null)
        .order("target_effective_date", { ascending: false }),
      supabase
        .from("insurance_claims")
        .select("*")
        .eq("insurance_policy_id", id)
        .is("deleted_at", null)
        .order("date_of_loss", { ascending: false }),
      supabase
        .from("premium_allocations")
        .select("*")
        .eq("insurance_policy_id", id)
        .is("deleted_at", null)
        .order("period_end", { ascending: false }),
    ]);
    const subErr = rErr ?? cErr ?? aErr;
    if (subErr) {
      setError(subErr.message);
      setLoading(false);
      return;
    }
    setRenewals((r ?? []) as Renewal[]);
    setClaims((c ?? []) as Claim[]);
    setAllocs((a ?? []) as Alloc[]);
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-6">
        <InsuranceHubNav />
        <p className="text-sm text-slate-600 dark:text-slate-400">Loading…</p>
      </div>
    );
  }

  if (error || !policy) {
    return (
      <div className="space-y-6">
        <InsuranceHubNav />
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error ?? "Not found."}
        </p>
        <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href="/admin/insurance/policies">
          Back to policies
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <InsuranceHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">{policy.carrier_name}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {entityName} · {policy.policy_type.replace(/_/g, " ")} · {policy.policy_number}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Coverage</CardTitle>
          <CardDescription>Effective {policy.effective_date} through {policy.expiration_date}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-2">
          <p>
            <span className="text-slate-500">Status:</span> {policy.status.replace(/_/g, " ")}
          </p>
          <p>
            <span className="text-slate-500">Premium:</span> {formatUsdFromCents(policy.premium_cents)}
          </p>
          {policy.broker_name && (
            <p>
              <span className="text-slate-500">Broker:</span> {policy.broker_name}
            </p>
          )}
          {policy.notes && (
            <p className="md:col-span-2">
              <span className="text-slate-500">Notes:</span> {policy.notes}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Renewals</CardTitle>
          <CardDescription>Milestones and premiums for this policy.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {renewals.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">No renewals recorded.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2 pr-4 font-medium">Target effective</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Quoted</th>
                  <th className="py-2 font-medium">Bound</th>
                </tr>
              </thead>
              <tbody>
                {renewals.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 dark:border-slate-900">
                    <td className="py-2 pr-4">{r.target_effective_date}</td>
                    <td className="py-2 pr-4">{r.status.replace(/_/g, " ")}</td>
                    <td className="py-2 pr-4 tabular-nums">{formatUsdFromCents(r.quoted_premium_cents)}</td>
                    <td className="py-2 tabular-nums">{formatUsdFromCents(r.bound_premium_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Premium allocations</CardTitle>
          <CardDescription>Facility splits for internal reporting.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {allocs.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">No allocations.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2 pr-4 font-medium">Period</th>
                  <th className="py-2 pr-4 font-medium">Method</th>
                  <th className="py-2 font-medium">Allocated</th>
                </tr>
              </thead>
              <tbody>
                {allocs.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100 dark:border-slate-900">
                    <td className="py-2 pr-4">
                      {a.period_start} – {a.period_end}
                    </td>
                    <td className="py-2 pr-4">{a.allocation_method.replace(/_/g, " ")}</td>
                    <td className="py-2 tabular-nums">{formatUsdFromCents(a.allocated_premium_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Linked claims</CardTitle>
          <CardDescription>Corporate GL claims on this policy.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {claims.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">No linked claims.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2 pr-4 font-medium">Loss date</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Reserve</th>
                  <th className="py-2 font-medium">Paid</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 dark:border-slate-900">
                    <td className="py-2 pr-4">{c.date_of_loss ?? "—"}</td>
                    <td className="py-2 pr-4">{c.status.replace(/_/g, " ")}</td>
                    <td className="py-2 pr-4 tabular-nums">{formatUsdFromCents(c.reserve_cents)}</td>
                    <td className="py-2 pr-4 tabular-nums">{formatUsdFromCents(c.paid_cents)}</td>
                    <td className="py-2">
                      <Link className="text-primary underline-offset-4 hover:underline" href={`/admin/insurance/claims/${c.id}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href="/admin/insurance/policies">
        Back to list
      </Link>
    </div>
  );
}
