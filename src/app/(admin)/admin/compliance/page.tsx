"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ClipboardList, FileWarning, Shield } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { fetchComplianceDashboardSnapshot } from "@/lib/compliance-dashboard-snapshot";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type DefRow = {
  id: string;
  tag_number: string;
  severity: string;
  status: string;
  submission_due_date: string | null;
};

export default function AdminCompliancePage() {
  const { selectedFacilityId } = useFacilityStore();
  const supabase = createClient();
  const [snapLoading, setSnapLoading] = useState(true);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof fetchComplianceDashboardSnapshot>> | null>(null);
  const [defRows, setDefRows] = useState<DefRow[]>([]);
  const [defLoading, setDefLoading] = useState(true);

  const loadSnapshot = useCallback(async () => {
    setSnapLoading(true);
    setSnapError(null);
    try {
      const data = await fetchComplianceDashboardSnapshot(selectedFacilityId);
      setSnapshot(data);
    } catch (e) {
      setSnapshot(null);
      setSnapError(e instanceof Error ? e.message : "Unable to load compliance metrics.");
    } finally {
      setSnapLoading(false);
    }
  }, [selectedFacilityId]);

  const loadDeficiencies = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setDefRows([]);
      setDefLoading(false);
      return;
    }
    setDefLoading(true);
    const { data, error } = await supabase
      .from("survey_deficiencies")
      .select("id, tag_number, severity, status")
      .eq("facility_id", selectedFacilityId)
      .is("deleted_at", null)
      .in("status", ["open", "poc_submitted", "poc_accepted", "recited"])
      .order("survey_date", { ascending: false })
      .limit(25);

    if (error || !data) {
      setDefRows([]);
      setDefLoading(false);
      return;
    }

    const ids = data.map((d) => d.id);
    if (ids.length === 0) {
      setDefRows([]);
      setDefLoading(false);
      return;
    }

    const { data: pocs } = await supabase
      .from("plans_of_correction")
      .select("deficiency_id, submission_due_date, status")
      .in("deficiency_id", ids)
      .is("deleted_at", null)
      .in("status", ["draft", "submitted", "accepted"]);

    const dueByDef = new Map<string, string>();
    for (const p of pocs ?? []) {
      if (p.submission_due_date && !dueByDef.has(p.deficiency_id)) {
        dueByDef.set(p.deficiency_id, p.submission_due_date);
      }
    }

    setDefRows(
      data.map((d) => ({
        id: d.id,
        tag_number: d.tag_number,
        severity: d.severity,
        status: d.status,
        submission_due_date: dueByDef.get(d.id) ?? null,
      })),
    );
    setDefLoading(false);
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    void loadDeficiencies();
  }, [loadDeficiencies]);

  const facilityReady = !!(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Compliance
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Operational readiness, survey deficiencies, and policy library.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/compliance/audit-export"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Audit log export
          </Link>
          <Link href="/admin/compliance/policies" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Policy library
          </Link>
          <Link href="/admin/compliance/deficiencies/new" className={cn(buttonVariants({ size: "sm" }))}>
            Add deficiencies
          </Link>
          <Link href="/admin/certifications" className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}>
            Certifications
          </Link>
        </div>
      </div>

      {!facilityReady ? (
        <Card className="border-amber-200/80 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle className="text-base">Select a facility</CardTitle>
            <CardDescription>
              Choose a facility in the header to load compliance metrics for that site.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {snapError ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {snapError}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Tile
          title="Overdue assessments"
          value={snapLoading ? null : snapshot?.overdueAssessments ?? 0}
          href="/admin/assessments/overdue"
        />
        <Tile
          title="Overdue care plan reviews"
          value={snapLoading ? null : snapshot?.overdueCarePlanReviews ?? 0}
          href="/admin/care-plans/reviews-due"
        />
        <Tile
          title="Incident follow-ups past due"
          value={snapLoading ? null : snapshot?.openIncidentFollowupsPastDue ?? 0}
          href="/admin/incidents"
        />
        <Tile
          title="Active infections"
          value={snapLoading ? null : snapshot?.activeInfections ?? 0}
          href="/admin/infection-control"
          badge={
            !snapLoading && snapshot && snapshot.activeOutbreaks > 0 ? (
              <Badge variant="destructive" className="ml-2">
                Outbreak {snapshot.activeOutbreaks}
              </Badge>
            ) : null
          }
        />
        <Tile
          title="Certs expiring (30d)"
          value={snapLoading ? null : snapshot?.expiringCertifications30d ?? 0}
          href="/admin/certifications"
        />
        <Tile
          title="Open deficiencies"
          value={snapLoading ? null : snapshot?.openDeficiencies ?? 0}
          href="/admin/compliance/deficiencies/new"
        />
      </div>

      <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileWarning className="h-5 w-5 text-slate-500" />
            <CardTitle className="text-lg">Open deficiencies</CardTitle>
          </div>
          <CardDescription>Survey citations that still need correction or verification.</CardDescription>
        </CardHeader>
        <CardContent>
          {!facilityReady ? (
            <p className="text-sm text-slate-500">Select a facility to list deficiencies.</p>
          ) : defLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : defRows.length === 0 ? (
            <p className="text-sm text-slate-500">No open deficiencies for this facility.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tag</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>POC due</TableHead>
                  <TableHead className="text-right"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {defRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.tag_number}</TableCell>
                    <TableCell>{row.severity}</TableCell>
                    <TableCell>{row.status}</TableCell>
                    <TableCell>{row.submission_due_date ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/admin/compliance/deficiencies/${row.id}`}
                        className={cn(buttonVariants({ variant: "link", size: "sm" }), "text-slate-700")}
                      >
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-slate-500" />
              <CardTitle className="text-base">Survey visit mode</CardTitle>
            </div>
            <CardDescription>
              Use the bar below the header to activate logging while a regulator is on site.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-slate-600 dark:text-slate-400">
            {snapLoading ? "—" : snapshot?.surveyVisitActive ? "Session active for this facility." : "No active session."}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-slate-500" />
              <CardTitle className="text-base">Quick links</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <Link href="/admin/compliance/policies" className="text-slate-700 underline-offset-4 hover:underline dark:text-slate-300">
              Policy library
            </Link>
            <Link
              href="/admin/compliance/deficiencies/new"
              className="text-slate-700 underline-offset-4 hover:underline dark:text-slate-300"
            >
              Enter survey deficiencies
            </Link>
            <Link href="/admin/incidents" className="text-slate-700 underline-offset-4 hover:underline dark:text-slate-300">
              Incidents & follow-ups
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50/50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Tiles aggregate live operational data. Trends and enhanced scoring are out of scope for Core — focus on
          accurate counts and traceable deficiency workflows.
        </p>
      </div>
    </div>
  );
}

function Tile({
  title,
  value,
  href,
  badge,
}: {
  title: string;
  value: number | null;
  href: string;
  badge?: ReactNode;
}) {
  return (
    <Link href={href}>
      <Card className="h-full border-slate-200/80 shadow-soft transition-colors hover:bg-slate-50/80 dark:border-slate-800 dark:hover:bg-slate-900/50">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center text-sm font-medium text-slate-500 dark:text-slate-400">
            {title}
            {badge}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-display text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {value === null ? "—" : value}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
