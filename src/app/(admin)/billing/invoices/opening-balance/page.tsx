"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { BILLABLE_RESIDENT_STATUSES } from "@/lib/billing/generate-monthly-invoices";
import { formatCents } from "@/lib/finance/format-cents";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

import { BillingHubNav } from "../../billing-hub-nav";

type ResidentOption = { id: string; name: string; organizationId: string };

/**
 * BH-5 — Opening balance entry for a selected facility/resident.
 * Creates a draft invoice via haven_create_invoice_with_line_items so balances
 * land in the real AR ledger (not launch-intake JSON).
 */
export default function AdminOpeningBalancePage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();

  const [residents, setResidents] = useState<ResidentOption[]>([]);
  const [residentId, setResidentId] = useState("");
  const [amountDollars, setAmountDollars] = useState("");
  const [periodStart, setPeriodStart] = useState(() => todayFacilityDateIso());
  const [dueDate, setDueDate] = useState("");
  const [payerType, setPayerType] = useState("private_pay");
  const [payerName, setPayerName] = useState("Responsible party");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadResidents = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setResidents([]);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("residents")
      .select("id, first_name, last_name, organization_id")
      .eq("facility_id", selectedFacilityId)
      .is("deleted_at", null)
      .in("status", [...BILLABLE_RESIDENT_STATUSES])
      .order("last_name", { ascending: true })
      .limit(500);
    if (qErr) {
      setError(qErr.message);
      setResidents([]);
    } else {
      setResidents(
        (data ?? []).map((r) => ({
          id: r.id,
          organizationId: r.organization_id,
          name: `${(r.last_name ?? "").trim()}, ${(r.first_name ?? "").trim()}`.replace(
            /^, |, $/,
            "",
          ),
        })),
      );
    }
    setLoading(false);
  }, [selectedFacilityId, supabase]);

  useEffect(() => {
    void loadResidents();
  }, [loadResidents]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSuccess(null);
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setError("Select a facility in the header.");
      return;
    }
    if (!residentId) {
      setError("Choose a resident.");
      return;
    }
    const cents = Math.round(Number.parseFloat(amountDollars) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError("Enter a positive balance amount.");
      return;
    }
    if (!periodStart || !dueDate) {
      setError("Period start and due date are required.");
      return;
    }

    const start = new Date(`${periodStart}T12:00:00`);
    const periodEndDate = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    const periodEnd = `${periodEndDate.getFullYear()}-${String(periodEndDate.getMonth() + 1).padStart(2, "0")}-${String(periodEndDate.getDate()).padStart(2, "0")}`;
    const facilityCode = selectedFacilityId.replace(/-/g, "").slice(0, 8).toUpperCase();
    const invoiceNumber = `${facilityCode}-OB-${residentId.slice(0, 8)}-${periodStart.replace(/-/g, "")}`;

    setSaving(true);
    try {
      const rpcResult = (await supabase.rpc("haven_create_invoice_with_line_items" as never, {
        p_facility_id: selectedFacilityId,
        p_resident_id: residentId,
        p_invoice_number: invoiceNumber,
        p_invoice_date: periodStart,
        p_due_date: dueDate,
        p_period_start: periodStart,
        p_period_end: periodEnd,
        p_subtotal: cents,
        p_adjustments: 0,
        p_tax: 0,
        p_total: cents,
        p_amount_paid: 0,
        p_balance_due: cents,
        p_payer_type: payerType,
        p_payer_name: payerName,
        p_notes: notes.trim() || "Opening balance",
        p_line_items: [
          {
            line_type: "room_and_board",
            description: "Opening balance",
            quantity: 1,
            unit_price: cents,
            total: cents,
            sort_order: 1,
          },
        ],
      } as never)) as unknown as {
        data: { invoice_id: string | null; inserted: boolean }[] | null;
        error: { message: string } | null;
      };

      if (rpcResult.error) throw new Error(rpcResult.error.message);
      const row = rpcResult.data?.[0];
      if (!row?.inserted) {
        setError("An opening-balance invoice already exists for this resident/period key. Check Invoices.");
        return;
      }
      setSuccess(
        `Created opening balance ${formatCents(cents)} — invoice ${invoiceNumber}.`,
      );
      setAmountDollars("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create opening balance.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BillingHubNav />
      <div className="flex items-center gap-3">
        <Link
          href="/admin/billing/invoices"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Invoices
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Opening balance</CardTitle>
          <CardDescription>
            Record a resident&apos;s outstanding balance carried into Haven for the selected
            facility. Creates a draft invoice so aging, collections, and payments work against the
            real ledger.
          </CardDescription>
          <p className="text-sm text-muted-foreground">
            This records prior AR already owed — not a new monthly room-and-board invoice. Use{" "}
            <Link href="/admin/billing/invoices/generate" className="font-medium underline-offset-2 hover:underline">
              Generate invoices
            </Link>{" "}
            for recurring billing.
          </p>
        </CardHeader>
        <CardContent>
          {!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId) ? (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              Select a facility in the header to enter an opening balance for that site.
            </p>
          ) : loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading residents…
            </div>
          ) : residents.length === 0 ? (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              No billable residents found for this facility. Confirm resident status is active or
              pending move-in, then refresh.
            </p>
          ) : (
            <form className="space-y-4" onSubmit={(e) => void submit(e)}>
              {error ? (
                <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              {success ? (
                <p className="rounded-md border border-success/20 bg-success/10 px-3 py-2 text-sm text-success">
                  {success}
                </p>
              ) : null}

              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Resident</span>
                <select
                  className="w-full rounded-md border border-input bg-card px-3 py-2"
                  value={residentId}
                  onChange={(e) => setResidentId(e.target.value)}
                  required
                >
                  <option value="">Select…</option>
                  {residents.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Balance due (USD)</span>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amountDollars}
                  onChange={(e) => setAmountDollars(e.target.value)}
                  placeholder="1650.00"
                  required
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium">Period start (ET)</span>
                  <Input
                    type="date"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    required
                  />
                </label>
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium">Due date (ET)</span>
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    required
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium">Payer type</span>
                  <select
                    className="w-full rounded-md border border-input bg-card px-3 py-2"
                    value={payerType}
                    onChange={(e) => setPayerType(e.target.value)}
                  >
                    <option value="private_pay">Private pay</option>
                    <option value="medicaid_oss">Medicaid OSS</option>
                    <option value="ltc_insurance">LTC insurance</option>
                    <option value="va_aid_attendance">VA aid & attendance</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium">Payer name</span>
                  <Input value={payerName} onChange={(e) => setPayerName(e.target.value)} />
                </label>
              </div>

              <label className="block space-y-1.5 text-sm">
                <span className="font-medium">Notes</span>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                />
              </label>

              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create opening balance invoice"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
