"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, Play } from "lucide-react";

import { RoundingHubNav } from "../rounding-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { cn } from "@/lib/utils";

type PlanRow = {
  id: string;
  status: string;
  source_type: string;
  effective_from: string;
  rationale: string | null;
  residents?: { first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
  resident_observation_plan_rules?: { id: string }[];
};

function displayName(person?: { first_name: string | null; last_name: string | null; preferred_name: string | null } | null) {
  return [person?.preferred_name ?? person?.first_name ?? null, person?.last_name ?? null].filter(Boolean).join(" ");
}

export default function AdminRoundingPlansPage() {
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!selectedFacilityId) {
      setPlans([]);
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/rounding/plans?facilityId=${encodeURIComponent(selectedFacilityId)}`, {
        cache: "no-store",
      });
      const json = (await response.json()) as { error?: string; plans?: PlanRow[] };
      if (!response.ok) {
        throw new Error(json.error ?? "Could not load observation plans");
      }
      setPlans(json.plans ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load observation plans.");
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, [selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generateTasks() {
    if (!selectedFacilityId) return;
    setGenerating(true);
    setError(null);
    try {
      const now = new Date();
      const response = await fetch("/api/rounding/generate-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facilityId: selectedFacilityId,
          windowStart: now.toISOString(),
          windowEnd: new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(),
        }),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "Could not generate rounding tasks");
      }
      await load();
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Could not generate rounding tasks.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Observation plans</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Manage resident cadence, active rules, and shift-ready task generation.</p>
      </div>

      <RoundingHubNav />

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Refresh plans
        </Button>
        <Button variant="outline" onClick={() => void generateTasks()} disabled={!selectedFacilityId || generating}>
          {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          Generate next 8 hours
        </Button>
        <Link href="/admin/rounding/plans/new" className={cn(buttonVariants({ variant: "outline" }))}>
          <Plus className="mr-2 h-4 w-4" />
          New plan
        </Link>
      </div>

      <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
        <CardHeader>
          <CardTitle>Facility plans</CardTitle>
          <CardDescription>{selectedFacilityId ? "Only plans in the selected facility are shown." : "Select a facility to manage plans."}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Resident</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Rules</TableHead>
                  <TableHead>Effective from</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!selectedFacilityId ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                      Select a facility to load plans.
                    </TableCell>
                  </TableRow>
                ) : loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : plans.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                      No plans found. Create one to start generating rounding tasks.
                    </TableCell>
                  </TableRow>
                ) : (
                  plans.map((plan) => (
                    <TableRow key={plan.id}>
                      <TableCell className="font-medium">{displayName(plan.residents) || "Resident"}</TableCell>
                      <TableCell>
                        <Badge variant={plan.status === "active" ? "default" : "outline"}>{plan.status}</Badge>
                      </TableCell>
                      <TableCell>{plan.source_type.replaceAll("_", " ")}</TableCell>
                      <TableCell>{plan.resident_observation_plan_rules?.length ?? 0}</TableCell>
                      <TableCell>{new Date(plan.effective_from).toLocaleString()}</TableCell>
                      <TableCell>
                        <Link href={`/admin/rounding/plans/${plan.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                          Edit
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
