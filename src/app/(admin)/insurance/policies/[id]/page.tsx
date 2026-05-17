"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { InsuranceHubNav } from "../../insurance-hub-nav";
import { buttonVariants } from "@/components/ui/button";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";
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
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (error || !policy) {
    return (
      <div className="space-y-6">
        <InsuranceHubNav />
        <p className="text-sm text-destructive" role="alert">
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
      <RecordDetailHeader
        title={policy.carrier_name}
        subtitle={`${entityName} · ${policy.policy_type.replace(/_/g, " ")} · ${policy.policy_number}`}
        backLink={{ label: "Back to policies", href: "/admin/insurance/policies" }}
      />

      <RecordDetailSection
        title="Coverage"
        description={`Effective ${policy.effective_date} through ${policy.expiration_date}`}
      >
        <div className="grid gap-2 text-sm md:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Status:</span> {policy.status.replace(/_/g, " ")}
          </p>
          <p>
            <span className="text-muted-foreground">Premium:</span>{" "}
            <span className="tabular-nums">{formatUsdFromCents(policy.premium_cents)}</span>
          </p>
          {policy.broker_name && (
            <p>
              <span className="text-muted-foreground">Broker:</span> {policy.broker_name}
            </p>
          )}
          {policy.notes && (
            <p className="md:col-span-2">
              <span className="text-muted-foreground">Notes:</span> {policy.notes}
            </p>
          )}
        </div>
      </RecordDetailSection>

      <RecordDetailSection
        title="Renewals"
        description="Milestones and premiums for this policy."
      >
        <div className="overflow-x-auto">
          {renewals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No renewals recorded.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 pr-4 font-medium">Target effective</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Quoted</th>
                  <th className="py-2 font-medium">Bound</th>
                </tr>
              </thead>
              <tbody>
                {renewals.map((r) => (
                  <tr key={r.id} className="border-b border-border/50">
                    <td className="py-2 pr-4">{r.target_effective_date}</td>
                    <td className="py-2 pr-4">{r.status.replace(/_/g, " ")}</td>
                    <td className="py-2 pr-4 tabular-nums">{formatUsdFromCents(r.quoted_premium_cents)}</td>
                    <td className="py-2 tabular-nums">{formatUsdFromCents(r.bound_premium_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </RecordDetailSection>

      <RecordDetailSection
        title="Premium allocations"
        description="Facility splits for internal reporting."
      >
        <div className="overflow-x-auto">
          {allocs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No allocations.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 pr-4 font-medium">Period</th>
                  <th className="py-2 pr-4 font-medium">Method</th>
                  <th className="py-2 font-medium">Allocated</th>
                </tr>
              </thead>
              <tbody>
                {allocs.map((a) => (
                  <tr key={a.id} className="border-b border-border/50">
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
        </div>
      </RecordDetailSection>

      <RecordDetailSection
        title="Linked claims"
        description="Corporate GL claims on this policy."
      >
        <div className="overflow-x-auto">
          {claims.length === 0 ? (
            <p className="text-sm text-muted-foreground">No linked claims.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-2 pr-4 font-medium">Loss date</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Reserve</th>
                  <th className="py-2 pr-4 font-medium">Paid</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.id} className="border-b border-border/50">
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
        </div>
      </RecordDetailSection>
    </div>
  );
}
