"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { InsuranceHubNav } from "../insurance-hub-nav";
import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { assembleRenewalPackagePayload } from "@/lib/insurance/assemble-renewal-package-payload";
import {
  canMutateFinance,
  loadFinanceRoleContext,
} from "@/lib/finance/load-finance-context";
import type { Database } from "@/types/database";

type PolicyMini = { id: string; policy_number: string; carrier_name: string; entity_id: string };
type EntityMini = { id: string; name: string };

type PackageRow = Database["public"]["Tables"]["renewal_data_packages"]["Row"] & {
  insurance_policies: { policy_number: string; carrier_name: string } | null;
};

function firstOfPriorMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function lastOfPriorMonth(): string {
  const d = new Date();
  d.setDate(0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function InsuranceRenewalPackagesPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<PackageRow[]>([]);
  const [entities, setEntities] = useState<EntityMini[]>([]);
  const [policies, setPolicies] = useState<PolicyMini[]>([]);
  const [entityId, setEntityId] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [periodStart, setPeriodStart] = useState(firstOfPriorMonth);
  const [periodEnd, setPeriodEnd] = useState(lastOfPriorMonth);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [canMutate, setCanMutate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const ctx = await loadFinanceRoleContext(supabase);
    if (!ctx.ok) {
      setRows([]);
      setLoadError(ctx.error);
      setLoading(false);
      return;
    }
    setCanMutate(canMutateFinance(ctx.ctx.appRole));
    setOrgId(ctx.ctx.organizationId);

    const [{ data: ent }, { data: pol }, { data: pkgs, error }] = await Promise.all([
      supabase
        .from("entities")
        .select("id, name")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .order("name"),
      supabase
        .from("insurance_policies")
        .select("id, policy_number, carrier_name, entity_id")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .order("policy_number"),
      supabase
        .from("renewal_data_packages")
        .select("*, insurance_policies(policy_number, carrier_name)")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .order("generated_at", { ascending: false })
        .limit(100),
    ]);

    if (error) {
      setLoadError(error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const el = (ent ?? []) as EntityMini[];
    setEntities(el);
    setPolicies((pol ?? []) as PolicyMini[]);
    setRows((pkgs ?? []) as unknown as PackageRow[]);
    setEntityId((prev) => prev || el[0]?.id || "");
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const filteredPolicies = policies.filter((p) => p.entity_id === entityId);

  async function generatePackage() {
    if (!orgId || !entityId || !policyId) return;
    setGenerating(true);
    setLoadError(null);
    try {
      const assembled = await assembleRenewalPackagePayload(supabase, {
        organizationId: orgId,
        entityId,
        periodStart,
        periodEnd,
      });
      if (!assembled.ok) {
        setLoadError(assembled.error);
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error: insErr } = await supabase.from("renewal_data_packages").insert({
        organization_id: orgId,
        entity_id: entityId,
        insurance_policy_id: policyId,
        period_start: periodStart,
        period_end: periodEnd,
        payload: assembled.payload as unknown as Database["public"]["Tables"]["renewal_data_packages"]["Insert"]["payload"],
        created_by: user?.id ?? null,
      });
      if (insErr) {
        setLoadError(insErr.message);
        return;
      }
      await load();
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      <InsuranceHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Renewal data packages</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Structured underwriting metrics and narrative workflow (Module 18 Enhanced). AI drafts are internal until reviewed
          and published.
        </p>
      </div>

      {loadError ? <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} /> : null}

      {canMutate ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generate package</CardTitle>
            <CardDescription>
              Snapshot census, incidents, staffing, and AR totals for the period. Owner / org admin only.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="ent">Entity</Label>
              <select
                id="ent"
                className="h-9 min-w-[200px] rounded-md border border-input bg-transparent px-3 text-sm shadow-xs dark:bg-input/30"
                value={entityId}
                onChange={(e) => {
                  setEntityId(e.target.value);
                  setPolicyId("");
                }}
              >
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pol">Policy</Label>
              <select
                id="pol"
                className="h-9 min-w-[220px] rounded-md border border-input bg-transparent px-3 text-sm shadow-xs dark:bg-input/30"
                value={policyId}
                onChange={(e) => setPolicyId(e.target.value)}
              >
                <option value="">Select policy…</option>
                {filteredPolicies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.policy_number} — {p.carrier_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ps">Period start</Label>
              <input
                id="ps"
                type="date"
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs dark:bg-input/30"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pe">Period end</Label>
              <input
                id="pe"
                type="date"
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs dark:bg-input/30"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
              />
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => void generatePackage()}
              disabled={generating || !policyId || !entityId}
            >
              {generating ? "Generating…" : "Generate package"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">View-only</CardTitle>
            <CardDescription>Generating packages requires an owner or organization administrator role.</CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Packages</CardTitle>
          <CardDescription>{loading ? "Loading…" : `${rows.length} package(s)`}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">No renewal data packages yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Generated</TableHead>
                  <TableHead>Policy</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Review</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm text-slate-600 dark:text-slate-400">
                      {new Intl.DateTimeFormat("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(r.generated_at))}
                    </TableCell>
                    <TableCell>
                      {r.insurance_policies?.policy_number ?? "—"}
                      <span className="block text-xs text-slate-500">{r.insurance_policies?.carrier_name}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.period_start} → {r.period_end}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.narrative_published_at ? (
                        <span className="text-emerald-700 dark:text-emerald-400">Published</span>
                      ) : r.narrative_reviewed_at ? (
                        <span className="text-amber-800 dark:text-amber-300">Reviewed</span>
                      ) : (
                        <span className="text-slate-500">Draft</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        className="text-primary text-sm underline-offset-4 hover:underline"
                        href={`/admin/insurance/renewal-packages/${r.id}`}
                      >
                        Open
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
