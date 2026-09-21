"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { EntityCombobox } from "@/components/ui/entity-combobox";
import { FormLabel } from "@/components/ui/form-label";
import { Input } from "@/components/ui/input";
import { QuietDatePicker } from "@/components/ui/quiet-date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { BILLABLE_RESIDENT_STATUSES } from "@/lib/billing/generate-monthly-invoices";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { formatCents } from "@/lib/finance/format-cents";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

import { BillingHubNav } from "../../billing-hub-nav";

type ResidentOption = { id: string; name: string; organizationId: string };

type CreatedOpeningBalance = {
  invoiceId: string;
  invoiceNumber: string;
  amountCents: number;
};

const PAYER_TYPE_LABELS: Record<string, string> = {
  private_pay: "Private pay",
  medicaid_oss: "Medicaid OSS",
  ltc_insurance: "LTC insurance",
  va_aid_attendance: "VA aid & attendance",
  other: "Other",
};

/**
 * BH-5 — Opening balance entry for a selected facility/resident.
 * Creates a draft invoice via create_finance_opening_balance so balances land
 * in the real AR ledger (not launch-intake JSON).
 */
export default function AdminOpeningBalancePage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId, availableFacilities } = useFacilityStore();

  const [residents, setResidents] = useState<ResidentOption[]>([]);
  const [residentId, setResidentId] = useState("");
  const [amountDollars, setAmountDollars] = useState("");
  const [periodStart, setPeriodStart] = useState(() => todayFacilityDateIso());
  const [dueDate, setDueDate] = useState("");
  const [payerType, setPayerType] = useState("");
  const [payerName, setPayerName] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedOpeningBalance | null>(null);

  const selectedFacility = availableFacilities?.find((facility) => facility.id === selectedFacilityId);
  const selectedResident = residents.find((resident) => resident.id === residentId);
  const amountCents = Math.round(Number.parseFloat(amountDollars) * 100);
  const displayAmount = Number.isFinite(amountCents) && amountCents > 0 ? formatCents(amountCents) : "—";

  const residentOptions = useMemo(
    () => residents.map((resident) => ({
      id: resident.id,
      label: resident.name,
      keywords: resident.name,
    })),
    [residents],
  );

  const loadResidents = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setResidents([]);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from("residents")
      .select("id, first_name, last_name, organization_id")
      .eq("facility_id", selectedFacilityId)
      .is("deleted_at", null)
      .in("status", [...BILLABLE_RESIDENT_STATUSES])
      .order("last_name", { ascending: true })
      .limit(500);
    if (queryError) {
      setError(queryError.message);
      setResidents([]);
    } else {
      setResidents(
        (data ?? []).map((resident) => ({
          id: resident.id,
          organizationId: resident.organization_id,
          name: `${(resident.last_name ?? "").trim()}, ${(resident.first_name ?? "").trim()}`.replace(
            /^, |, $/,
            "",
          ),
        })),
      );
    }
    setLoading(false);
  }, [selectedFacilityId, supabase]);

  useEffect(() => {
    setResidentId("");
    setAmountDollars("");
    setPeriodStart(todayFacilityDateIso());
    setDueDate("");
    setPayerType("");
    setPayerName("");
    setNotes("");
    setReviewing(false);
    setCreated(null);
    setError(null);
    void loadResidents();
  }, [loadResidents]);

  function markEntryChanged() {
    setReviewing(false);
    setCreated(null);
    setError(null);
  }

  function validateEntry(): number | null {
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setError("Select a facility in the header.");
      return null;
    }
    if (!residentId) {
      setError("Choose a resident.");
      return null;
    }
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setError("Enter a positive opening balance.");
      return null;
    }
    if (!periodStart || !dueDate) {
      setError("Opening balance date and due date are required.");
      return null;
    }
    if (!payerType) {
      setError("Choose the payer type recorded on the prior receivable.");
      return null;
    }
    if (!payerName.trim()) {
      setError("Enter the payer name recorded on the prior receivable.");
      return null;
    }
    return amountCents;
  }

  function reviewEntry(event: React.FormEvent) {
    event.preventDefault();
    if (validateEntry() == null) return;
    setReviewing(true);
  }

  async function createOpeningBalance() {
    const validatedAmountCents = validateEntry();
    if (validatedAmountCents == null || !selectedFacilityId) return;

    const start = new Date(`${periodStart}T12:00:00`);
    const periodEndDate = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    const periodEnd = `${periodEndDate.getFullYear()}-${String(periodEndDate.getMonth() + 1).padStart(2, "0")}-${String(periodEndDate.getDate()).padStart(2, "0")}`;
    const facilityCode = selectedFacilityId.replace(/-/g, "").slice(0, 8).toUpperCase();
    const invoiceNumber = `${facilityCode}-OB-${residentId.slice(0, 8)}-${periodStart.replace(/-/g, "")}`;

    setSaving(true);
    try {
      const rpcResult = (await supabase.rpc("create_finance_opening_balance" as never, {
        p_facility_id: selectedFacilityId,
        p_resident_id: residentId,
        p_invoice_number: invoiceNumber,
        p_invoice_date: periodStart,
        p_due_date: dueDate,
        p_period_start: periodStart,
        p_period_end: periodEnd,
        p_amount_cents: validatedAmountCents,
        p_payer_type: payerType,
        p_payer_name: payerName.trim(),
        p_notes: notes.trim() || "Opening balance",
      } as never)) as unknown as {
        data: { invoice_id: string | null; inserted: boolean }[] | null;
        error: { message: string } | null;
      };

      if (rpcResult.error) throw new Error(rpcResult.error.message);
      const row = rpcResult.data?.[0];
      if (!row?.inserted || !row.invoice_id) {
        setError("An opening-balance invoice already exists for this resident and opening-balance date. Check Invoices.");
        return;
      }
      setCreated({
        invoiceId: row.invoice_id,
        invoiceNumber,
        amountCents: validatedAmountCents,
      });
      setReviewing(false);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not create opening balance.");
    } finally {
      setSaving(false);
    }
  }

  function resetEntry() {
    setResidentId("");
    setAmountDollars("");
    setPeriodStart(todayFacilityDateIso());
    setDueDate("");
    setPayerType("");
    setPayerName("");
    setNotes("");
    setReviewing(false);
    setCreated(null);
    setError(null);
  }

  return (
    <div className="space-y-6 pb-12">
      <BillingHubNav />

      <div className="mx-auto w-full max-w-6xl space-y-5">
        <Link
          href="/admin/billing/invoices"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 h-8 gap-1 px-2")}
        >
          <ArrowLeft className="size-4" aria-hidden />
          Invoices
        </Link>

        <header className="flex flex-col gap-2 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Enter opening balance</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Carry a resident&apos;s prior receivable into Haven as a draft invoice. It will be included in AR aging,
              collections, and payment allocation.
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs font-medium text-muted-foreground">Selected facility</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{selectedFacility?.name ?? "Choose a facility"}</p>
          </div>
        </header>

        {!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId) ? (
          <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            Select a facility in the header to enter an opening balance for that site.
          </div>
        ) : loading ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading residents…
          </div>
        ) : residents.length === 0 ? (
          <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            No billable residents were found for this facility. Confirm the resident is active or pending move-in,
            then refresh.
          </div>
        ) : (
          <form className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]" onSubmit={reviewEntry}>
            <section className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)] ring-1 ring-border/60">
              <div className="border-b border-border px-5 py-4">
                <h2 className="text-[15px] font-semibold text-foreground">Entry details</h2>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Use the payer and balance shown on the source receivable. Do not enter a new monthly charge here.
                </p>
              </div>

              <div className="space-y-6 p-5">
                {error ? (
                  <div role="alert" className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">
                    {error}
                  </div>
                ) : null}

                {created ? (
                  <div role="status" className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-foreground">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                      <div>
                        <p className="font-semibold">Opening balance created</p>
                        <p className="mt-1 text-[13px] text-muted-foreground">
                          {formatCents(created.amountCents)} · invoice {created.invoiceNumber}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link href={`/admin/billing/invoices/${created.invoiceId}`} className={buttonVariants({ size: "sm" })}>
                            View invoice
                          </Link>
                          <Button type="button" variant="outline" size="sm" onClick={resetEntry}>
                            Enter another
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <fieldset className="space-y-4" disabled={saving || Boolean(created)}>
                  <legend className="text-[13px] font-semibold text-foreground">Resident and balance</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <EntityCombobox
                      id="opening-balance-resident"
                      label="Resident"
                      placeholder="Select resident"
                      searchPlaceholder="Search residents…"
                      options={residentOptions}
                      value={residentId}
                      onChange={(value) => {
                        markEntryChanged();
                        setResidentId(value);
                      }}
                      required
                    />
                    <div className="space-y-2">
                      <FormLabel htmlFor="opening-balance-amount" required>Opening balance</FormLabel>
                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">$</span>
                        <Input
                          id="opening-balance-amount"
                          type="number"
                          min="0.01"
                          step="0.01"
                          inputMode="decimal"
                          className="h-10 pl-7 font-mono tabular-nums"
                          value={amountDollars}
                          onChange={(event) => {
                            markEntryChanged();
                            setAmountDollars(event.target.value);
                          }}
                          placeholder="0.00"
                          required
                        />
                      </div>
                    </div>
                  </div>
                </fieldset>

                <fieldset className="space-y-4 border-t border-border pt-5" disabled={saving || Boolean(created)}>
                  <legend className="text-[13px] font-semibold text-foreground">Timing</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <FormLabel htmlFor="opening-balance-date" required>Opening balance as of</FormLabel>
                      <QuietDatePicker
                        id="opening-balance-date"
                        value={periodStart}
                        onValueChange={(value) => {
                          markEntryChanged();
                          setPeriodStart(value);
                        }}
                        initialVisibleMonthIso={todayFacilityDateIso()}
                        calendarIconAlign="end"
                        className="w-full [&>button]:w-full"
                      />
                      <p className="text-xs text-muted-foreground">Eastern Time · used as the invoice and period start date.</p>
                    </div>
                    <div className="space-y-2">
                      <FormLabel htmlFor="opening-balance-due-date" required>Due date</FormLabel>
                      <QuietDatePicker
                        id="opening-balance-due-date"
                        value={dueDate}
                        onValueChange={(value) => {
                          markEntryChanged();
                          setDueDate(value);
                        }}
                        initialVisibleMonthIso={periodStart || todayFacilityDateIso()}
                        calendarIconAlign="end"
                        className="w-full [&>button]:w-full"
                      />
                      <p className="text-xs text-muted-foreground">The AR aging clock uses this date.</p>
                    </div>
                  </div>
                </fieldset>

                <fieldset className="space-y-4 border-t border-border pt-5" disabled={saving || Boolean(created)}>
                  <legend className="text-[13px] font-semibold text-foreground">Payer and source note</legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <FormLabel htmlFor="opening-balance-payer-type" required>Payer type</FormLabel>
                      <Select
                        value={payerType}
                        onValueChange={(value) => {
                          markEntryChanged();
                          setPayerType(value);
                        }}
                        required
                      >
                        <SelectTrigger id="opening-balance-payer-type" className="h-10 bg-background">
                          <SelectValue placeholder="Select payer type" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(PAYER_TYPE_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <FormLabel htmlFor="opening-balance-payer-name" required>Payer name</FormLabel>
                      <Input
                        id="opening-balance-payer-name"
                        className="h-10"
                        value={payerName}
                        onChange={(event) => {
                          markEntryChanged();
                          setPayerName(event.target.value);
                        }}
                        placeholder="Name on prior receivable"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <FormLabel htmlFor="opening-balance-notes">Source note</FormLabel>
                    <Textarea
                      id="opening-balance-notes"
                      value={notes}
                      onChange={(event) => {
                        markEntryChanged();
                        setNotes(event.target.value);
                      }}
                      placeholder="Optional reconciliation or source-document context"
                    />
                  </div>
                </fieldset>
              </div>
            </section>

            <aside className="self-start rounded-xl border border-border bg-card shadow-[var(--shadow-card)] ring-1 ring-border/60 lg:sticky lg:top-4">
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-[14px] font-semibold text-foreground">Entry summary</h2>
              </div>
              <dl className="divide-y divide-border px-4 text-[13px]">
                <SummaryRow label="Facility" value={selectedFacility?.name ?? "Selected facility"} />
                <SummaryRow label="Resident" value={selectedResident?.name ?? "—"} />
                <SummaryRow label="Opening balance" value={displayAmount} valueClassName="font-mono tabular-nums" />
                <SummaryRow label="As of" value={periodStart || "—"} valueClassName="font-mono tabular-nums" />
                <SummaryRow label="Due date" value={dueDate || "—"} valueClassName="font-mono tabular-nums" />
                <SummaryRow label="Payer" value={payerType ? PAYER_TYPE_LABELS[payerType] : "—"} />
                <SummaryRow label="Payer name" value={payerName.trim() || "—"} />
              </dl>
              <div className="space-y-3 border-t border-border px-4 py-4">
                <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                  Creates one draft invoice. The balance will appear in AR aging and can receive payments and
                  collections activity.
                </div>
                {created ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Draft invoice created. Use the invoice link in the confirmation to review its ledger entry.
                  </p>
                ) : reviewing ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground">Review complete. Confirm to create the draft invoice.</p>
                    <Button type="button" className="w-full" disabled={saving || Boolean(created)} onClick={() => void createOpeningBalance()}>
                      {saving ? <><Loader2 className="size-4 animate-spin" aria-hidden /> Creating…</> : "Create draft invoice"}
                    </Button>
                    <Button type="button" variant="ghost" className="w-full" disabled={saving} onClick={() => setReviewing(false)}>
                      Edit entry
                    </Button>
                  </div>
                ) : (
                  <Button type="submit" className="w-full" disabled={saving || Boolean(created)}>
                    Review opening balance
                  </Button>
                )}
              </div>
            </aside>
          </form>
        )}
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("max-w-[11rem] text-right font-medium text-foreground", valueClassName)}>{value}</dd>
    </div>
  );
}
