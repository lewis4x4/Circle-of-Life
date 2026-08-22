"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2 } from "lucide-react";

import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { ExecutiveHubNav } from "../../../executive/executive-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const EXECUTIVE_ENTITY_LOADING_MESSAGE = "Loading entities…";
export const EXECUTIVE_ENTITY_EMPTY_LIST_MESSAGE = "No legal entities on file.";

export default function ExecutiveEntityIndexPage() {
  const supabase = useMemo(() => createClient(), []);
  const { organizationId, loading: authLoading } = useHavenAuth();
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [rows, setRows] = useState<{ id: string; name: string; status: string | null }[]>([]);

  const hasOrgScopedData = rows.length > 0;
  const organizationGapMessage = resolveExecutiveOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData,
  });
  const fetchErrorBannerMessage = resolveExecutiveFetchErrorBannerMessage({
    authLoading,
    fetchError,
  });
  const loading = authLoading || fetching;

  const load = useCallback(async () => {
    if (authLoading) {
      return;
    }

    if (!organizationId) {
      setRows([]);
      setFetchError(null);
      setFetching(false);
      return;
    }

    setFetching(true);
    setFetchError(null);
    try {
      const { data, error: qErr } = await supabase
        .from("entities")
        .select("id, name, status")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("name");
      if (qErr) {
        setFetchError(qErr.message);
        return;
      }
      setRows(data ?? []);
    } catch (e) {
      setRows([]);
      setFetchError(e instanceof Error ? e.message : "Unable to load entities.");
    } finally {
      setFetching(false);
    }
  }, [authLoading, supabase, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <ExecutiveHubNav />

      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900 dark:text-white">
          <Building2 className="h-8 w-8 text-slate-600 dark:text-slate-300" aria-hidden />
          Entities
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Drill down by legal entity; each page lists facilities with a KPI strip (Module 24).
        </p>
      </div>

      {organizationGapMessage ? (
        <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
          <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
        </Card>
      ) : null}

      {fetchErrorBannerMessage ? (
        <AdminLiveDataFallbackNotice message={fetchErrorBannerMessage} onRetry={() => void load()} />
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {EXECUTIVE_ENTITY_LOADING_MESSAGE}
        </p>
      ) : organizationGapMessage || fetchErrorBannerMessage ? null : rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{EXECUTIVE_ENTITY_EMPTY_LIST_MESSAGE}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((e) => (
            <Card key={e.id}>
              <CardHeader>
                <CardTitle className="text-lg">{e.name}</CardTitle>
                {e.status && (
                  <CardDescription className="capitalize">{e.status.replace(/_/g, " ")}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <Link
                  href={`/admin/executive/entity/${e.id}`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  View portfolio →
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
