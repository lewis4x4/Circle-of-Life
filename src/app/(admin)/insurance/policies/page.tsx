"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { InsuranceHubNav } from "../insurance-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/ui/status-pill";
import { TableRow, TableRowHeader } from "@/components/ui/table-row";
import { cn } from "@/lib/utils";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { canMutateFinance } from "@/lib/finance/load-finance-context";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import {
  formatInsurancePolicyExpirationDate,
  INSURANCE_POLICIES_LOADING_COPY,
  INSURANCE_POLICIES_LOADING_PROFILE_COPY,
  INSURANCE_POLICIES_ORG_DATE_SCOPE_COPY,
} from "@/lib/insurance/policies-display-copy";
import {
  resolveInsurancePoliciesFetchErrorBannerMessage,
  resolveInsurancePoliciesOrganizationGapMessage,
} from "@/lib/insurance/policies-page-state";
import {
  INSURANCE_HUB_LIST_LIMIT,
  INSURANCE_POLICIES_LIST_SELECT,
} from "@/lib/admin/hub-list-limits";
import { Constants, type Database } from "@/types/database";
type PolicyRow = Database["public"]["Tables"]["insurance_policies"]["Row"];
type EntityMini = { id: string; name: string };

export default function InsurancePoliciesPage() {
  const supabase = createClient();
  const { organizationId, appRole, loading: authLoading } = useHavenAuth();
  const [entityFilter, setEntityFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const { data: entities = [] } = useQuery({
    queryKey: ["insurance", "policy-entities", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<EntityMini[]> => {
      const { data, error } = await supabase
        .from("entities")
        .select("id, name")
        .eq("organization_id", organizationId as string)
        .is("deleted_at", null)
        .order("name");
      if (error) throw new Error(error.message);
      return (data ?? []) as EntityMini[];
    },
  });

  const {
    data: rows = [],
    isPending,
    error,
    refetch,
  } = useQuery({
    queryKey: ["insurance", "policies", organizationId, entityFilter, statusFilter],
    enabled: !!organizationId,
    queryFn: async (): Promise<PolicyRow[]> => {
      let q = supabase
        .from("insurance_policies")
        .select(INSURANCE_POLICIES_LIST_SELECT)
        .eq("organization_id", organizationId as string)
        .is("deleted_at", null)
        .order("expiration_date", { ascending: true })
        .limit(INSURANCE_HUB_LIST_LIMIT);
      if (entityFilter) q = q.eq("entity_id", entityFilter);
      if (statusFilter) q = q.eq("status", statusFilter as PolicyRow["status"]);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as PolicyRow[];
    },
  });

  const organizationGapMessage = resolveInsurancePoliciesOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: rows.length > 0,
  });
  const fetchErrorBannerMessage = resolveInsurancePoliciesFetchErrorBannerMessage({
    authLoading,
    fetchError: error?.message ?? null,
  });
  const loadingPolicies = !!organizationId && !authLoading && isPending;

  const entityName = useMemo(() => {
    const m = new Map(entities.map((e) => [e.id, e.name]));
    return (id: string) => m.get(id) ?? id;
  }, [entities]);

  const canWrite = !!organizationId && canMutateFinance(appRole as Database["public"]["Enums"]["app_role"]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6 w-full">
        <InsuranceHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-border shadow-sm mt-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-4">
              Policies
            </h1>
            <p className="mt-2 font-medium tracking-wide text-muted-foreground max-w-2xl">
              Entity-level corporate insurance inventory.
            </p>
            <p className="text-sm text-muted-foreground max-w-2xl">{INSURANCE_POLICIES_ORG_DATE_SCOPE_COPY}</p>
          </div>
          {canWrite && (
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/admin/insurance/policies/new" className={cn(buttonVariants({ size: "default" }))}>
                + New Policy
              </Link>
            </div>
          )}
        </header>

        {authLoading ? (
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
            {INSURANCE_POLICIES_LOADING_PROFILE_COPY}
          </p>
        ) : null}

        {organizationGapMessage ? (
          <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
            <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
          </Card>
        ) : null}

        {fetchErrorBannerMessage && (
          <p className="text-sm text-destructive" role="alert">
            {fetchErrorBannerMessage}
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
                disabled={authLoading || !organizationId}
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
                disabled={authLoading || !organizationId}
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
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-lg px-6 border-border"
                onClick={() => void refetch()}
                disabled={authLoading || !organizationId}
              >
                Apply Filters
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between pb-4 mb-4 border-b border-border pl-2">
            <h3 className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground">
              Policy List
            </h3>
            <span className="text-xs font-medium text-muted-foreground">
              {authLoading || loadingPolicies ? "Loading…" : `${rows.length} policies`}
            </span>
          </div>

          {authLoading || loadingPolicies ? (
            <p className="text-sm text-muted-foreground pl-2" role="status" aria-live="polite">
              {INSURANCE_POLICIES_LOADING_COPY}
            </p>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center rounded-lg border border-dashed border-border bg-muted/20">
              <p className="font-semibold text-lg text-foreground">No Policies Found</p>
              <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters or adding a new policy.</p>
            </div>
          ) : (
            <>
              <TableRowHeader>
                <span className="w-[110px] shrink-0">Status</span>
                <span className="flex-[2] min-w-0">Carrier</span>
                <span className="flex-1 min-w-0">Type</span>
                <span className="flex-1 min-w-0">Entity</span>
                <span className="w-[110px] shrink-0">Expires (ET)</span>
                <span className="w-[120px] shrink-0 text-right">Premium</span>
                <span className="w-[72px] shrink-0 text-right">Action</span>
              </TableRowHeader>
              <MotionList className="space-y-1 mt-2">
                {rows.map((r) => {
                  const isActive = r.status === "active";
                  const formattedDate = formatInsurancePolicyExpirationDate(r.expiration_date);

                  return (
                    <MotionItem key={r.id}>
                      <TableRow>
                        <div className="w-[110px] shrink-0">
                          <StatusPill tone={isActive ? "muted" : "warning"}>
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
                            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 px-2.5 text-[10px]")}
                          >
                            View
                          </Link>
                        </div>
                      </TableRow>
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
