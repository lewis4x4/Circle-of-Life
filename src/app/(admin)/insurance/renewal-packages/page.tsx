"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

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
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { assembleRenewalPackagePayload } from "@/lib/insurance/assemble-renewal-package-payload";
import { formatRenewalPackagePolicyNumber } from "@/lib/insurance/renewal-packages-display-copy";
import { canMutateFinance } from "@/lib/finance/load-finance-context";
import type { Database } from "@/types/database";

type PolicyMini = { id: string; policy_number: string; carrier_name: string; entity_id: string };
type EntityMini = { id: string; name: string };

type PackageRow = Database["public"]["Tables"]["renewal_data_packages"]["Row"] & {
  insurance_policies: { policy_number: string; carrier_name: string } | null;
};

type PackagesData = {
  entities: EntityMini[];
  policies: PolicyMini[];
  rows: PackageRow[];
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
  const queryClient = useQueryClient();
  const { user, organizationId, appRole, loading: authLoading } = useHavenAuth();
  const [entityId, setEntityId] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [periodStart, setPeriodStart] = useState(firstOfPriorMonth);
  const [periodEnd, setPeriodEnd] = useState(lastOfPriorMonth);
  const [generating, setGenerating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const packagesQueryKey = ["insurance", "renewal-packages", organizationId] as const;

  const {
    data,
    isPending,
    error,
  } = useQuery({
    queryKey: packagesQueryKey,
    enabled: !!organizationId,
    queryFn: async (): Promise<PackagesData> => {
      const [{ data: ent }, { data: pol }, { data: pkgs, error: pkgErr }] = await Promise.all([
        supabase
          .from("entities")
          .select("id, name")
          .eq("organization_id", organizationId as string)
          .is("deleted_at", null)
          .order("name"),
        supabase
          .from("insurance_policies")
          .select("id, policy_number, carrier_name, entity_id")
          .eq("organization_id", organizationId as string)
          .is("deleted_at", null)
          .order("policy_number"),
        supabase
          .from("renewal_data_packages")
          .select("*, insurance_policies(policy_number, carrier_name)")
          .eq("organization_id", organizationId as string)
          .is("deleted_at", null)
          .order("generated_at", { ascending: false })
          .limit(100),
      ]);

      if (pkgErr) throw new Error(pkgErr.message);

      return {
        entities: (ent ?? []) as EntityMini[],
        policies: (pol ?? []) as PolicyMini[],
        rows: (pkgs ?? []) as unknown as PackageRow[],
      };
    },
  });

  const entities = data?.entities ?? [];
  const policies = data?.policies ?? [];
  const rows = data?.rows ?? [];

  const loading = authLoading || isPending;
  const loadError =
    !authLoading && !organizationId
      ? "Organization missing on profile."
      : mutationError
        ? mutationError
        : error
          ? error.message
          : null;

  const canMutate = canMutateFinance(appRole as Database["public"]["Enums"]["app_role"]);

  // Default to the first entity (matches the previous post-load behavior) while
  // still letting the user override the selection.
  const effectiveEntityId = entityId || entities[0]?.id || "";
  const filteredPolicies = policies.filter((p) => p.entity_id === effectiveEntityId);

  async function generatePackage() {
    if (!organizationId || !effectiveEntityId || !policyId) return;
    setGenerating(true);
    setMutationError(null);
    try {
      const assembled = await assembleRenewalPackagePayload(supabase, {
        organizationId,
        entityId: effectiveEntityId,
        periodStart,
        periodEnd,
      });
      if (!assembled.ok) {
        setMutationError(assembled.error);
        return;
      }
      const { error: insErr } = await supabase.from("renewal_data_packages").insert({
        organization_id: organizationId,
        entity_id: effectiveEntityId,
        insurance_policy_id: policyId,
        period_start: periodStart,
        period_end: periodEnd,
        payload: assembled.payload as unknown as Database["public"]["Tables"]["renewal_data_packages"]["Insert"]["payload"],
        created_by: user?.id ?? null,
      });
      if (insErr) {
        setMutationError(insErr.message);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: packagesQueryKey });
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

      {loadError ? (
        <AdminLiveDataFallbackNotice
          message={loadError}
          onRetry={() => void queryClient.invalidateQueries({ queryKey: packagesQueryKey })}
        />
      ) : null}

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
                value={effectiveEntityId}
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
              disabled={generating || !policyId || !effectiveEntityId}
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
                      {formatRenewalPackagePolicyNumber(r.insurance_policies?.policy_number)}
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
