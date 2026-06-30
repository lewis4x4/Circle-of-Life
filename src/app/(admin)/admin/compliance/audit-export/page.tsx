"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Download, FileSpreadsheet } from "lucide-react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { invokeExportAuditLog } from "@/lib/audit-export";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type JobRow = {
  id: string;
  status: string;
  format: string;
  date_from: string | null;
  date_to: string | null;
  facility_id: string | null;
  row_count: number | null;
  created_at: string;
  error_message: string | null;
};

const EXPORT_ROLES = new Set(["owner", "org_admin", "facility_admin"]);

export default function AuditLogExportPage() {
  const supabase = createClient();
  const { user, organizationId, appRole } = useHavenAuth();
  type AppRole = Database["public"]["Enums"]["app_role"];
  const role = appRole as AppRole;
  const roleOk = EXPORT_ROLES.has(role);
  const { selectedFacilityId } = useFacilityStore();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      if (!organizationId || !roleOk) {
        setJobs([]);
        return;
      }
      const { data, error: qErr } = await supabase
        .from("audit_log_export_jobs")
        .select(
          "id, status, format, date_from, date_to, facility_id, row_count, created_at, error_message",
        )
        .order("created_at", { ascending: false })
        .limit(25);
      if (qErr) throw qErr;
      setJobs((data ?? []) as JobRow[]);
    } catch (e) {
      console.warn("[audit-export] load jobs", e);
      setJobs([]);
    } finally {
      setJobsLoading(false);
    }
  }, [organizationId, roleOk, supabase]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const onExport = async () => {
    setError(null);
    setLoading(true);
    try {
      if (!organizationId) {
        setError("Organization missing on profile.");
        return;
      }
      if (!roleOk) {
        setError("Your role cannot export audit logs.");
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError("Session expired. Sign in again.");
        return;
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
      const anonKey =
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "";
      if (!supabaseUrl || !anonKey) {
        setError("Supabase environment is not configured.");
        return;
      }

      const facilityId =
        selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId) ? selectedFacilityId : null;

      if (!user) {
        setError("Sign in required.");
        return;
      }

      const insertPayload = {
        organization_id: organizationId,
        requested_by: user.id,
        format: "csv" as const,
        status: "pending" as const,
        date_from: dateFrom.trim() || null,
        date_to: dateTo.trim() || null,
        facility_id: facilityId,
      };

      const { data: job, error: insErr } = await supabase
        .from("audit_log_export_jobs")
        .insert(insertPayload)
        .select("id")
        .single();

      if (insErr || !job) {
        setError(insErr?.message ?? "Could not create export job.");
        return;
      }

      const result = await invokeExportAuditLog({
        supabaseUrl,
        anonKey,
        accessToken: session.access_token,
        jobId: job.id,
      });

      if (!result.ok) {
        setError(result.message);
        void loadJobs();
        return;
      }

      const url = URL.createObjectURL(result.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);

      void loadJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/admin/compliance"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mb-2 -ml-2 gap-1")}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Compliance
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900 dark:text-white">
            <FileSpreadsheet className="h-7 w-7 text-slate-600 dark:text-slate-300" aria-hidden />
            Audit log export
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Download CSV extracts from the platform audit log for your organization (scoped by optional dates
            and facility).
          </p>
        </div>
      </div>

      {roleOk === false && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Only owner, org admin, or facility admin can export audit logs.
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>New export</CardTitle>
          <CardDescription>
            Exports include metadata columns (table, record id, action, user, org, facility, timestamp). Leave
            dates empty to include all rows in scope.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="date-from">From date (optional)</Label>
              <Input
                id="date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                disabled={loading || roleOk === false}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date-to">To date (optional)</Label>
              <Input
                id="date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                disabled={loading || roleOk === false}
              />
            </div>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Facility scope follows the header selector: choose a facility to filter audit rows to that site and
            org-wide rows; choose &quot;All facilities&quot; for the full organization export.
          </p>
          <Button
            type="button"
            onClick={() => void onExport()}
            disabled={loading || roleOk === false}
            className="gap-2"
          >
            <Download className="h-4 w-4" aria-hidden />
            {loading ? "Exporting…" : "Download CSV"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent jobs</CardTitle>
          <CardDescription>Latest export jobs for your organization.</CardDescription>
        </CardHeader>
        <CardContent>
          {jobsLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-slate-500">No jobs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Range</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(j.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{j.status}</span>
                      {j.error_message && (
                        <span className="mt-1 block text-xs text-destructive">{j.error_message}</span>
                      )}
                    </TableCell>
                    <TableCell>{j.row_count ?? "—"}</TableCell>
                    <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                      {j.date_from ?? "…"} → {j.date_to ?? "…"}
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
