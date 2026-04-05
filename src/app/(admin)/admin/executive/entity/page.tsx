"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Building2 } from "lucide-react";

import { ExecutiveHubNav } from "../../../executive/executive-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { createClient } from "@/lib/supabase/client";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function ExecutiveEntityIndexPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<{ id: string; name: string; status: string | null }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setError(ctx.error);
        setRows([]);
        return;
      }
      const { data, error: qErr } = await supabase
        .from("entities")
        .select("id, name, status")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .order("name");
      if (qErr) throw qErr;
      setRows(data ?? []);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Unable to load entities.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

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

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No entities found for this organization.</p>
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
