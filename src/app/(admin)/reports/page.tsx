"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { loadReportsRoleContext } from "@/lib/reports/auth";

type CountCard = { title: string; value: number; hint: string };

export default function ReportsOverviewPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<CountCard[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const ctx = await loadReportsRoleContext(supabase);
        if (!ctx.ok) throw new Error(ctx.error);

        const [templatesRes, savedRes, schedulesRes, packsRes, runsRes] = await Promise.all([
          supabase.from("report_templates").select("id", { count: "exact", head: true }),
          supabase
            .from("report_saved_views")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", ctx.ctx.organizationId)
            .is("deleted_at", null),
          supabase
            .from("report_schedules")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", ctx.ctx.organizationId)
            .is("deleted_at", null)
            .eq("status", "active"),
          supabase
            .from("report_packs")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", ctx.ctx.organizationId)
            .is("deleted_at", null)
            .eq("active", true),
          supabase
            .from("report_runs")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", ctx.ctx.organizationId),
        ]);

        const firstError = [
          templatesRes.error,
          savedRes.error,
          schedulesRes.error,
          packsRes.error,
          runsRes.error,
        ].find(Boolean);
        if (firstError) throw new Error(firstError.message);

        if (alive) {
          setCards([
            {
              title: "Template Library",
              value: templatesRes.count ?? 0,
              hint: "Official and custom templates",
            },
            {
              title: "Saved Reports",
              value: savedRes.count ?? 0,
              hint: "Pinned or inherited variants",
            },
            {
              title: "Active Schedules",
              value: schedulesRes.count ?? 0,
              hint: "Recurring report jobs",
            },
            {
              title: "Report Packs",
              value: packsRes.count ?? 0,
              hint: "Executive/compliance bundles",
            },
            {
              title: "Run History",
              value: runsRes.count ?? 0,
              hint: "Executed report runs",
            },
          ]);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load reporting overview.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [supabase]);

  const orderedCards = useMemo(() => cards, [cards]);
  const placeholderCards = useMemo<CountCard[]>(
    () =>
      Array.from({ length: 6 }, (_, index) => ({
        title: `loading-${index}`,
        value: 0,
        hint: "Please wait",
      })),
    [],
  );

  return (
    <div className="space-y-6">
      <ReportsHubNav />
      <div className="flex items-center gap-3">
        <BarChart3 className="h-8 w-8 text-slate-600 dark:text-slate-300" aria-hidden />
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Reporting overview</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Template-first reporting with scheduling, packs, and audited exports.
          </p>
        </div>
      </div>
      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(loading ? placeholderCards : orderedCards).map((card) => (
          <Card key={card.title}>
            <CardHeader>
              <CardTitle className="text-base">{loading ? "Loading..." : card.title}</CardTitle>
              <CardDescription>{loading ? "Please wait" : card.hint}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold text-slate-900 dark:text-white">
                {loading ? "-" : card.value.toLocaleString()}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
