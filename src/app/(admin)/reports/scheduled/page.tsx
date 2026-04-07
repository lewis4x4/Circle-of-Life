"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canManageReports, loadReportsRoleContext } from "@/lib/reports/auth";
import { PHASE1_TEMPLATE_SEED } from "@/lib/reports/templates";
import { createClient } from "@/lib/supabase/client";

type Schedule = {
  id: string;
  source_type: string;
  source_id: string;
  timezone: string;
  recurrence_rule: string;
  status: string;
  output_format: string;
  next_run_at: string | null;
  last_run_at: string | null;
};

export default function ScheduledReportsPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [sourceId, setSourceId] = useState(searchParams.get("fromTemplate") ?? PHASE1_TEMPLATE_SEED[0]?.slug ?? "");
  const [recurrence, setRecurrence] = useState("weekly");
  const [timezone, setTimezone] = useState("America/New_York");
  const [outputFormat, setOutputFormat] = useState("pdf");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadReportsRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      setOrgId(ctx.ctx.organizationId);
      setUserId(ctx.ctx.userId);
      setCanManage(canManageReports(ctx.ctx.appRole));

      const { data, error: queryErr } = await supabase
        .from("report_schedules")
        .select("id, source_type, source_id, timezone, recurrence_rule, status, output_format, next_run_at, last_run_at")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (queryErr) throw new Error(queryErr.message);
      setSchedules((data ?? []) as Schedule[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load schedules.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreateSchedule() {
    if (!orgId || !userId) return;
    setError(null);
    const { error: createErr } = await supabase.from("report_schedules").insert({
      organization_id: orgId,
      source_type: "template",
      source_id: sourceId,
      timezone,
      recurrence_rule: recurrence,
      output_format: outputFormat as "csv" | "pdf" | "print" | "xlsx",
      status: "active",
      next_run_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      created_by: userId,
      updated_by: userId,
    });
    if (createErr) {
      setError(createErr.message);
      return;
    }
    await load();
  }

  async function onToggleStatus(schedule: Schedule) {
    if (!orgId) return;
    const nextStatus = schedule.status === "paused" ? "active" : "paused";
    const { error: updateErr } = await supabase
      .from("report_schedules")
      .update({ status: nextStatus })
      .eq("id", schedule.id)
      .eq("organization_id", orgId);
    if (updateErr) {
      setError(updateErr.message);
      return;
    }
    await load();
  }

  return (
    <div className="space-y-6">
      <ReportsHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Scheduled reports</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Configure recurring runs, pause/resume delivery, and track run cadence.
        </p>
      </div>

      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Create schedule</CardTitle>
            <CardDescription>Phase 1 supports template schedules with in-app delivery tracking.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <select
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
            >
              {PHASE1_TEMPLATE_SEED.map((template) => (
                <option key={template.slug} value={template.slug}>
                  {template.name}
                </option>
              ))}
            </select>
            <Input value={recurrence} onChange={(event) => setRecurrence(event.target.value)} placeholder="daily | weekly | monthly" />
            <Input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/New_York" />
            <select
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
              value={outputFormat}
              onChange={(event) => setOutputFormat(event.target.value)}
            >
              <option value="pdf">PDF</option>
              <option value="csv">CSV</option>
              <option value="xlsx">XLSX</option>
            </select>
            <Button className="md:col-span-4" onClick={() => void onCreateSchedule()}>
              Save schedule
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Schedule registry</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>
          ) : schedules.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No schedules configured.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Recurrence</TableHead>
                  <TableHead>Timezone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Next run</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((schedule) => (
                  <TableRow key={schedule.id}>
                    <TableCell>{schedule.source_id}</TableCell>
                    <TableCell>{schedule.recurrence_rule}</TableCell>
                    <TableCell>{schedule.timezone}</TableCell>
                    <TableCell>
                      <Badge variant={schedule.status === "active" ? "secondary" : "outline"}>
                        {schedule.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{schedule.next_run_at ? new Date(schedule.next_run_at).toLocaleString() : "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => void onToggleStatus(schedule)}>
                        {schedule.status === "paused" ? "Resume" : "Pause"}
                      </Button>
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
