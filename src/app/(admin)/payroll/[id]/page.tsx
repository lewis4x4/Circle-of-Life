"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import { payPeriodClockBoundsUtc } from "@/lib/payroll/pay-period-bounds";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type BatchRow = Database["public"]["Tables"]["payroll_export_batches"]["Row"];
type MileageRow = Database["public"]["Tables"]["mileage_logs"]["Row"];
type TimeRecordRow = Database["public"]["Tables"]["time_records"]["Row"];

type LineWithStaff = {
  id: string;
  line_kind: string;
  amount_cents: number | null;
  idempotency_key: string;
  payload: Database["public"]["Tables"]["payroll_export_lines"]["Row"]["payload"];
  staff: { first_name: string | null; last_name: string | null } | null;
};

function buildPayrollLinesCsv(lines: LineWithStaff[]): string {
  const header = [
    "idempotency_key",
    "staff_first_name",
    "staff_last_name",
    "line_kind",
    "amount_cents",
    "payload_json",
  ].join(",");
  const body = lines.map((line) => {
    const fn = line.staff?.first_name ?? "";
    const ln = line.staff?.last_name ?? "";
    const payloadJson = JSON.stringify(line.payload ?? {});
    return [
      csvEscapeCell(line.idempotency_key),
      csvEscapeCell(fn),
      csvEscapeCell(ln),
      csvEscapeCell(line.line_kind),
      csvEscapeCell(String(line.amount_cents ?? "")),
      csvEscapeCell(payloadJson),
    ].join(",");
  });
  return [header, ...body].join("\r\n");
}

function formatCents(cents: number | null) {
  if (cents === null || Number.isNaN(cents)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export default function AdminPayrollBatchDetailPage() {
  const params = useParams();
  const router = useRouter();
  const batchId = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();

  const [batch, setBatch] = useState<BatchRow | null>(null);
  const [lines, setLines] = useState<LineWithStaff[]>([]);
  const [eligibleMileage, setEligibleMileage] = useState<MileageRow[]>([]);
  const [eligibleTimeRecords, setEligibleTimeRecords] = useState<TimeRecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [timeImportSummary, setTimeImportSummary] = useState<string | null>(null);

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setImportSummary(null);
    setTimeImportSummary(null);
    if (!batchId || !facilityReady || !selectedFacilityId) {
      setBatch(null);
      setLines([]);
      setEligibleMileage([]);
      setEligibleTimeRecords([]);
      setLoading(false);
      return;
    }
    try {
      const { data: b, error: bErr } = await supabase
        .from("payroll_export_batches")
        .select("*")
        .eq("id", batchId)
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .maybeSingle();
      if (bErr) throw bErr;
      if (!b) {
        setBatch(null);
        setLines([]);
        setEligibleMileage([]);
        setEligibleTimeRecords([]);
        return;
      }
      setBatch(b);

      const { data: lineRows, error: lErr } = await supabase
        .from("payroll_export_lines")
        .select("id, line_kind, amount_cents, idempotency_key, payload, staff(first_name, last_name)")
        .eq("batch_id", batchId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (lErr) throw lErr;
      setLines((lineRows ?? []) as LineWithStaff[]);

      const { data: mileageRows, error: mErr } = await supabase
        .from("mileage_logs")
        .select("*")
        .eq("facility_id", b.facility_id)
        .is("deleted_at", null)
        .not("approved_at", "is", null)
        .is("payroll_export_id", null)
        .gte("trip_date", b.period_start)
        .lte("trip_date", b.period_end)
        .order("trip_date", { ascending: false });
      if (mErr) throw mErr;
      setEligibleMileage(mileageRows ?? []);

      const { startIso, endIso } = payPeriodClockBoundsUtc(b.period_start, b.period_end);

      const { data: trRows, error: trErr } = await supabase
        .from("time_records")
        .select("*")
        .eq("facility_id", b.facility_id)
        .is("deleted_at", null)
        .eq("approved", true)
        .not("approved_at", "is", null)
        .gte("clock_in", startIso)
        .lte("clock_in", endIso)
        .order("clock_in", { ascending: true });
      if (trErr) throw trErr;

      const { data: trKeyRows, error: trKeyErr } = await supabase
        .from("payroll_export_lines")
        .select("idempotency_key")
        .is("deleted_at", null)
        .like("idempotency_key", "time_record:%");
      if (trKeyErr) throw trKeyErr;

      const exportedTimeIds = new Set(
        (trKeyRows ?? []).map((r) => r.idempotency_key.replace(/^time_record:/, "")),
      );
      setEligibleTimeRecords((trRows ?? []).filter((tr) => !exportedTimeIds.has(tr.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load batch.");
      setBatch(null);
      setLines([]);
      setEligibleMileage([]);
      setEligibleTimeRecords([]);
    } finally {
      setLoading(false);
    }
  }, [batchId, facilityReady, selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function importMileage() {
    if (!batch || batch.status !== "draft" || !facilityReady) return;
    setImporting(true);
    setError(null);
    setImportSummary(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");

      let added = 0;
      let linkedOnly = 0;
      let skippedOtherBatch = 0;

      for (const log of eligibleMileage) {
        const idempotencyKey = `mileage:${log.id}`;

        const { data: existing, error: exErr } = await supabase
          .from("payroll_export_lines")
          .select("id, batch_id")
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();
        if (exErr) throw exErr;

        if (existing) {
          if (existing.batch_id === batch.id) {
            const { error: upErr } = await supabase
              .from("mileage_logs")
              .update({ payroll_export_id: batch.id, updated_by: user.id })
              .eq("id", log.id)
              .is("payroll_export_id", null);
            if (upErr) throw upErr;
            linkedOnly += 1;
          } else {
            skippedOtherBatch += 1;
          }
          continue;
        }

        const payload = {
          mileage_log_id: log.id,
          trip_date: log.trip_date,
          purpose: log.purpose,
          miles: log.miles,
        };

        const { error: insErr } = await supabase.from("payroll_export_lines").insert({
          organization_id: batch.organization_id,
          batch_id: batch.id,
          staff_id: log.staff_id,
          line_kind: "mileage_reimbursement",
          amount_cents: log.reimbursement_amount_cents,
          payload,
          idempotency_key: idempotencyKey,
          created_by: user.id,
        });

        if (insErr) throw insErr;

        const { error: mlErr } = await supabase
          .from("mileage_logs")
          .update({ payroll_export_id: batch.id, updated_by: user.id })
          .eq("id", log.id);
        if (mlErr) throw mlErr;

        added += 1;
      }

      const parts = [`${added} line(s) added.`];
      if (linkedOnly > 0) parts.push(`${linkedOnly} already linked to this batch.`);
      if (skippedOtherBatch > 0)
        parts.push(`${skippedOtherBatch} skipped (already exported in another batch).`);
      setImportSummary(parts.join(" "));

      await load();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function importTimeRecords() {
    if (!batch || batch.status !== "draft" || !facilityReady) return;
    setImporting(true);
    setError(null);
    setTimeImportSummary(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");

      let added = 0;
      let skippedOtherBatch = 0;

      for (const tr of eligibleTimeRecords) {
        const idempotencyKey = `time_record:${tr.id}`;

        const { data: existing, error: exErr } = await supabase
          .from("payroll_export_lines")
          .select("id, batch_id")
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();
        if (exErr) throw exErr;

        if (existing) {
          if (existing.batch_id !== batch.id) skippedOtherBatch += 1;
          continue;
        }

        const payload = {
          time_record_id: tr.id,
          clock_in: tr.clock_in,
          clock_out: tr.clock_out,
          regular_hours: tr.regular_hours,
          actual_hours: tr.actual_hours,
          overtime_hours: tr.overtime_hours,
          break_minutes: tr.break_minutes,
        };

        const { error: insErr } = await supabase.from("payroll_export_lines").insert({
          organization_id: batch.organization_id,
          batch_id: batch.id,
          staff_id: tr.staff_id,
          line_kind: "time_record_hours",
          amount_cents: null,
          payload,
          time_record_id: tr.id,
          idempotency_key: idempotencyKey,
          created_by: user.id,
        });

        if (insErr) throw insErr;

        added += 1;
      }

      const parts = [`${added} line(s) added.`];
      if (skippedOtherBatch > 0)
        parts.push(`${skippedOtherBatch} skipped (idempotency key already used in another batch).`);
      setTimeImportSummary(parts.join(" "));

      await load();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  if (!facilityReady) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <p className="text-sm text-amber-800 dark:text-amber-200">Select a facility first.</p>
        <Link href="/admin/payroll" className={cn(buttonVariants({ variant: "outline" }))}>
          Back to payroll
        </Link>
      </div>
    );
  }

  if (!batchId) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <p className="text-sm text-slate-600">Invalid batch.</p>
        <Link href="/admin/payroll" className={cn(buttonVariants({ variant: "outline" }))}>
          Back to payroll
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase font-mono tracking-widest text-slate-500">
            SYS: Module 13 / Payroll
          </p>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Payroll batch
          </h1>
        </div>
        <Link href="/admin/payroll" className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}>
          Back
        </Link>
      </div>

      {loading && <p className="text-sm font-mono text-slate-500">Loading…</p>}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      )}

      {!loading && !batch && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Batch not found for this facility, or it was removed.
        </p>
      )}

      {batch && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Period & status</CardTitle>
              <CardDescription>
                {batch.period_start} → {batch.period_end} · {batch.provider} ·{" "}
                <span className="font-mono uppercase">{batch.status}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-slate-600 dark:text-slate-400">
              Updated {format(new Date(batch.updated_at), "MMM d, yyyy HH:mm")}
            </CardContent>
          </Card>

          {batch.status === "draft" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Approved mileage</CardTitle>
                <CardDescription>
                  Imports approved mileage logs in this pay period that are not yet tied to an export.
                  Lines use idempotency key <code className="text-xs">mileage:{"{log_id}"}</code>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm">
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {eligibleMileage.length}
                  </span>{" "}
                  eligible trip(s) in range.
                </p>
                {importSummary && (
                  <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
                    {importSummary}
                  </p>
                )}
                <Button
                  type="button"
                  onClick={() => void importMileage()}
                  disabled={importing || eligibleMileage.length === 0}
                >
                  {importing ? "Importing…" : "Import mileage into batch"}
                </Button>
              </CardContent>
            </Card>
          )}

          {batch.status === "draft" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Approved time records</CardTitle>
                <CardDescription>
                  Imports approved punches whose <strong>clock-in</strong> falls in this pay period (
                  <span className="font-mono text-xs">America/New_York</span> bounds) and are not already on an export
                  line. Idempotency <code className="text-xs">time_record:{"{id}"}</code>. Amount is left to the vendor;
                  hours are in <span className="font-mono text-xs">payload_json</span>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm">
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {eligibleTimeRecords.length}
                  </span>{" "}
                  eligible punch(es) in range.
                </p>
                {timeImportSummary && (
                  <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
                    {timeImportSummary}
                  </p>
                )}
                <Button
                  type="button"
                  onClick={() => void importTimeRecords()}
                  disabled={importing || eligibleTimeRecords.length === 0}
                >
                  {importing ? "Importing…" : "Import time records into batch"}
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-lg">Export lines ({lines.length})</CardTitle>
                <CardDescription>Rows written for the external payroll handoff.</CardDescription>
              </div>
              {lines.length > 0 && batch && (
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0 self-start"
                  onClick={() => {
                    const csv = buildPayrollLinesCsv(lines);
                    const safeProv = batch.provider.replace(/[^a-zA-Z0-9._-]+/g, "_");
                    triggerCsvDownload(
                      `payroll-export_${batch.period_start}_${batch.period_end}_${safeProv}.csv`,
                      csv,
                    );
                  }}
                >
                  Download CSV
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {lines.length === 0 ? (
                <p className="text-sm text-slate-500">No lines yet.</p>
              ) : (
                <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                  {lines.map((line) => {
                    const name = line.staff
                      ? [line.staff.first_name, line.staff.last_name].filter(Boolean).join(" ") ||
                        "Staff"
                      : "Staff";
                    return (
                      <li key={line.id} className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-sm">
                        <div>
                          <span className="font-medium text-slate-900 dark:text-slate-100">{name}</span>
                          <span className="ml-2 font-mono text-xs uppercase text-slate-500">
                            {line.line_kind}
                          </span>
                        </div>
                        <span className="font-mono">{formatCents(line.amount_cents)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
