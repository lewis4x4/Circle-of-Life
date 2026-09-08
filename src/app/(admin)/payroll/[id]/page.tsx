"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";

import { Button, buttonVariants } from "@/components/ui/button";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { triggerCsvDownload } from "@/lib/csv-export";
import {
  payrollExportIssue,
  buildPayrollLinesCsvFlat,
  buildPayrollLinesCsvGeneric,
  buildPayrollLinesCsvHoursSplit,
  buildPayrollLinesCsvVendorHandoff,
  type PayrollExportLineRow,
} from "@/lib/payroll/payroll-export-csv";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import { payPeriodClockBoundsUtc } from "@/lib/payroll/pay-period-bounds";
import { readAllPages } from "@/lib/supabase/read-all-pages";
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

function toExportRows(lines: LineWithStaff[]): PayrollExportLineRow[] {
  return lines.map((line) => ({
    ...line,
    payload:
      line.payload && typeof line.payload === "object" && !Array.isArray(line.payload)
        ? (line.payload as Record<string, unknown>)
        : null,
  }));
}

export default function AdminPayrollBatchDetailPage() {
  const params = useParams();
  const router = useRouter();
  const batchId = typeof params.id === "string" ? params.id : "";
  const supabase = createClient();
  const { user } = useHavenAuth();
  const { selectedFacilityId } = useFacilityStore();

  const [batch, setBatch] = useState<BatchRow | null>(null);
  const [lines, setLines] = useState<LineWithStaff[]>([]);
  const [eligibleMileage, setEligibleMileage] = useState<MileageRow[]>([]);
  const [eligibleTimeRecords, setEligibleTimeRecords] = useState<TimeRecordRow[]>([]);
  const [exporting, setExporting] = useState(false);
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

      const { data: lineRows, error: lErr } = await readAllPages((from, to) => supabase
        .from("payroll_export_lines")
        .select("id, line_kind, amount_cents, idempotency_key, payload, staff(first_name, last_name)", { count: "exact" })
        .eq("batch_id", batchId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to));
      if (lErr) throw lErr;
      setLines((lineRows ?? []) as LineWithStaff[]);

      const { data: mileageRows, error: mErr } = await readAllPages((from, to) => supabase
        .from("mileage_logs")
        .select("*", { count: "exact" })
        .eq("facility_id", b.facility_id)
        .is("deleted_at", null)
        .not("approved_at", "is", null)
        .is("payroll_export_id", null)
        .gte("trip_date", b.period_start)
        .lte("trip_date", b.period_end)
        .order("trip_date", { ascending: false }).order("id", { ascending: true }).range(from, to));
      if (mErr) throw mErr;
      setEligibleMileage(mileageRows ?? []);

      const { startIso, endIso } = payPeriodClockBoundsUtc(b.period_start, b.period_end);

      const { data: trRows, error: trErr } = await readAllPages((from, to) => supabase
        .from("time_records")
        .select("*", { count: "exact" })
        .eq("facility_id", b.facility_id)
        .is("deleted_at", null)
        .eq("approved", true)
        .not("approved_at", "is", null)
        .gte("clock_in", startIso)
        .lte("clock_in", endIso)
        .order("clock_in", { ascending: true }).order("id", { ascending: true }).range(from, to));
      if (trErr) throw trErr;

      setEligibleTimeRecords(trRows ?? []);
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
    setTimeImportSummary(null);
    void load();
  }, [load]);

  async function importMileage() {
    if (!batch || batch.status !== "draft" || !facilityReady) return;
    setImporting(true);
    setError(null);
    setImportSummary(null);
    try {
      if (!user?.id) throw new Error("Sign in required.");

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
      if (!user?.id) throw new Error("Sign in required.");

      const { data, error: refreshError } = await supabase.rpc("refresh_payroll_time_records" as never, {
        p_batch_id: batch.id, p_expected_actor: user.id,
      } as never);
      if (refreshError) throw new Error(refreshError.message);
      const receipt = data as unknown as { added: number; refreshed: number; other_batch: number; needs_review: number };
      setTimeImportSummary(`${receipt.added} added; ${receipt.refreshed} refreshed; ${receipt.other_batch} owned by another batch. ${receipt.needs_review} ineligible line(s) need review: correct and reapprove the punch, or explicitly exclude it below.`);

      await load();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function excludePunch(lineId: string) {
    if (!batch || !user?.id || importing || exporting) return;
    setImporting(true); setError(null);
    try {
      const { error: excludeError } = await supabase.rpc("exclude_payroll_draft_punch" as never, {
        p_batch_id: batch.id, p_line_id: lineId, p_expected_actor: user.id,
      } as never);
      if (excludeError) throw new Error(excludeError.message);
      await load();
      setTimeImportSummary("Ineligible punch excluded from this draft. Its prior line evidence and global ownership are retained. Correct and reapprove the punch, then refresh to restore it.");
    } catch (e) { setError(e instanceof Error ? e.message : "Exclusion failed."); }
    finally { setImporting(false); }
  }

  async function exportBatch(format: "full" | "flat" | "vendor" | "split") {
    if (!batch || exporting || importing) return;
    setExporting(true); setError(null);
    try {
      const { data, error: snapshotError } = await supabase.rpc("payroll_export_snapshot" as never, { p_batch_id: batch.id } as never);
      if (snapshotError) throw new Error(snapshotError.message);
      const snapshot = data as unknown as { batch: BatchRow; lines: LineWithStaff[]; line_count: number };
      if (!snapshot || snapshot.batch.facility_id !== selectedFacilityId || snapshot.lines.length !== snapshot.line_count) throw new Error("Payroll snapshot could not be reconciled. Reload before exporting.");
      const rows = toExportRows(snapshot.lines);
      const csv = format === "full" ? buildPayrollLinesCsvGeneric(rows) : format === "flat" ? buildPayrollLinesCsvFlat(rows) : format === "split" ? buildPayrollLinesCsvHoursSplit(rows, snapshot.batch) : buildPayrollLinesCsvVendorHandoff(rows, snapshot.batch);
      triggerCsvDownload(`payroll-${format}_${snapshot.batch.period_start}_${snapshot.batch.period_end}_${snapshot.line_count}-lines.csv`, csv);
      setLines(snapshot.lines);
    } catch (error) { setError(error instanceof Error ? error.message : "Payroll export failed."); }
    finally { setExporting(false); }
  }

  const exportIssue = payrollExportIssue(toExportRows(lines));
  const splitIssue = payrollExportIssue(toExportRows(lines), true);

  if (!facilityReady) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <p className="text-sm text-warning">Select a facility first.</p>
        <Link href="/admin/payroll" className={cn(buttonVariants({ variant: "outline" }))}>
          Back to payroll
        </Link>
      </div>
    );
  }

  if (!batchId) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <p className="text-sm text-muted-foreground">Invalid batch.</p>
        <Link href="/admin/payroll" className={cn(buttonVariants({ variant: "outline" }))}>
          Back to payroll
        </Link>
      </div>
    );
  }

  const batchSubtitle = batch
    ? `${batch.period_start} → ${batch.period_end} · ${batch.provider} · ${batch.status.toUpperCase()}`
    : undefined;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <RecordDetailHeader
        title="Payroll batch"
        subtitle={batchSubtitle}
        backLink={{ label: "Back to payroll", href: "/admin/payroll" }}
      />

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {error && (
        <p className="rounded-[8px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {!loading && !batch && (
        <p className="text-sm text-muted-foreground">
          Batch not found for this facility, or it was removed.
        </p>
      )}

      {batch && (
        <>
          <RecordDetailSection title="Period & status">
            <p className="text-sm text-muted-foreground">
              Updated {format(new Date(batch.updated_at), "MMM d, yyyy HH:mm")}
            </p>
          </RecordDetailSection>

          {batch.status === "draft" && (
            <RecordDetailSection
              title="Approved mileage"
              description={`Imports approved mileage logs in this pay period that are not yet tied to an export. Lines use idempotency key mileage:{log_id}.`}
            >
              <div className="space-y-4">
                <p className="text-sm">
                  <span className="font-mono font-semibold tabular-nums text-foreground">
                    {eligibleMileage.length}
                  </span>{" "}
                  eligible trip(s) in range.
                </p>
                {importSummary && (
                  <p className="rounded-[8px] border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
                    {importSummary}
                  </p>
                )}
                <Button
                  type="button"
                  onClick={() => void importMileage()}
                  disabled={importing || exporting || eligibleMileage.length === 0}
                >
                  {importing ? "Importing…" : "Import mileage into batch"}
                </Button>
              </div>
            </RecordDetailSection>
          )}

          {batch.status === "draft" && (
            <RecordDetailSection
              title="Approved time records"
              description="Refreshes this draft from currently approved punches in the pay period (America/New_York). Correct and reapprove changed punches in Time records first. Existing lines keep their identity; another batch retains its ownership."
            >
              <div className="space-y-4">
                <p className="text-sm">
                  <span className="font-mono font-semibold tabular-nums text-foreground">
                    {eligibleTimeRecords.length}
                  </span>{" "}
                  approved punch(es) in range, including punches already imported.
                </p>
                {timeImportSummary && (
                  <p className="rounded-[8px] border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
                    {timeImportSummary}
                  </p>
                )}
                <Button
                  type="button"
                  onClick={() => void importTimeRecords()}
                  disabled={importing || exporting}
                >
                  {importing ? "Importing…" : "Refresh approved punches"}
                </Button>
              </div>
            </RecordDetailSection>
          )}

          {batch.status === "exported" && <p className="text-sm text-muted-foreground">Historical exported batch: downloads use stored payroll line evidence, without applying later punch corrections. Legacy batches do not contain an original file archive.</p>}
          <RecordDetailSection
            title={`Export lines (${lines.length})`}
            description="Full export includes JSON payload per row. Flat export adds parsed hours (time lines) and miles (mileage) columns without a JSON field. Vendor handoff adds pay-period columns and amount_usd. Hours split adds separate regular_hours / overtime_hours / total_hours for time lines."
            action={
              lines.length > 0 && batch ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={exporting || importing || Boolean(exportIssue)}
                    onClick={() => void exportBatch("full")}
                  >
                    CSV (full)
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={exporting || importing || Boolean(exportIssue)}
                    onClick={() => void exportBatch("flat")}
                  >
                    CSV (flat)
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={exporting || importing || Boolean(exportIssue)}
                    onClick={() => void exportBatch("vendor")}
                  >
                    CSV (vendor handoff)
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={exporting || importing || Boolean(splitIssue)}
                    title="Regular / overtime / total hours for time lines; generic columns, not vendor-specific layouts."
                    onClick={() => void exportBatch("split")}
                  >
                    CSV (hours split)
                  </Button>
                </div>
              ) : undefined
            }
          >
            {exportIssue && <p role="alert" className="text-sm text-destructive">{exportIssue}</p>}
            {!exportIssue && splitIssue && <p className="text-sm text-warning">{splitIssue} Total worked-hours exports remain available; workweek overtime allocation requires payroll review.</p>}
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">No lines yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {lines.map((line) => {
                  const name = line.staff
                    ? [line.staff.first_name, line.staff.last_name].filter(Boolean).join(" ") ||
                      "Staff"
                    : "Staff";
                  return (
                    <li key={line.id} className="flex flex-wrap items-baseline justify-between gap-2 py-[14px] text-sm">
                      <div>
                        <span className="font-medium text-foreground">{name}</span>
                        <span className="ml-2 text-xs uppercase tracking-wider text-muted-foreground">
                          {line.line_kind}
                        </span>
                      </div>
                      <span className="tabular-nums font-mono">{formatUsdFromCents(line.amount_cents)}</span>
                      {batch.status === "draft" && line.line_kind === "time_record_hours" && (
                        <Button type="button" variant="outline" size="sm" disabled={importing || exporting}
                          onClick={() => void excludePunch(line.id)}>
                          Exclude ineligible punch from draft
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </RecordDetailSection>
        </>
      )}
    </div>
  );
}
