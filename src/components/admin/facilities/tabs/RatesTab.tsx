"use client";

import React, { useMemo, useState } from "react";
import { parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { ChevronDown, Plus } from "lucide-react";
import type { FacilityDetailRow } from "@/types/facility";
import type { RateEntry } from "@/hooks/useFacilityRates";
import { RATE_TYPES, RATE_TYPE_LABELS } from "@/lib/admin/facilities/facility-constants";
import {
  compareYmd,
  facilityDateYmdInTimezone,
  isAncillaryRateType,
  isRateCurrentForYmd,
  isRoomBoardRateType,
} from "@/lib/admin/facilities/rate-schedule-metrics";
import {
  formatRatesTabEditorDisplay,
  formatRatesTabLastChangedSuffix,
  formatRatesTabPublishedRateDisplay,
} from "@/lib/facilities/rates-tab-display-copy";
import { labelFirstMonthlyBillingCycle } from "@/lib/admin/facilities/first-billing-cycle-label";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-input";
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
import Link from "next/link";

interface RatesTabProps {
  facility: FacilityDetailRow;
  rates: RateEntry[];
  isLoading: boolean;
  error: string | null;
  isCreating: boolean;
  isConfirming: boolean;
  createRate: (payload: {
    rate_type: string;
    amount_cents: number;
    effective_from: string;
    notes?: string;
    rate_confirmed?: boolean;
  }) => Promise<RateEntry | null>;
  confirmRate: (rateId: string) => Promise<boolean>;
}

const inputCls =
  "w-full px-3 py-2 rounded-[8px] border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring text-sm";

function rateRowStatus(
  effectiveFrom: string,
  effectiveTo: string | null,
  todayYmd: string,
): "Active" | "Scheduled" | "Superseded" {
  if (compareYmd(effectiveFrom, todayYmd) > 0) return "Scheduled";
  if (effectiveTo != null && effectiveTo.trim() !== "" && compareYmd(effectiveTo, todayYmd) < 0) {
    return "Superseded";
  }
  return "Active";
}

function statusBadge(
  status: "Active" | "Scheduled" | "Superseded",
  opts?: { scheduledOnLabel?: string },
) {
  if (status === "Active") {
    return <Badge className="font-normal bg-emerald-600/15 text-emerald-800 dark:text-emerald-200">Active</Badge>;
  }
  if (status === "Scheduled") {
    return (
      <Badge variant="secondary" className="font-normal">
        Scheduled{opts?.scheduledOnLabel ? ` · ${opts.scheduledOnLabel}` : ""}
      </Badge>
    );
  }
  return <Badge variant="outline" className="font-normal text-muted-foreground">Superseded</Badge>;
}

export function RatesTab({
  facility,
  rates,
  isLoading,
  error,
  isCreating,
  isConfirming,
  createRate,
  confirmRate,
}: RatesTabProps) {
  const tz =
    typeof facility.timezone === "string" && facility.timezone.trim().length > 0
      ? facility.timezone.trim()
      : "America/New_York";

  const todayYmd = useMemo(() => facilityDateYmdInTimezone(new Date(), tz), [tz]);

  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleRateType, setScheduleRateType] = useState<string | null>(null);

  const [formData, setFormData] = useState({ rate_type: "", amount: "", effective_from: "" });
  const [scheduleForm, setScheduleForm] = useState({ amount: "", effective_from: "" });
  const [scheduleFutureNote, setScheduleFutureNote] = useState<string | null>(null);

  const pendingActiveRates = useMemo(() => rates.filter((r) => r.effective_to == null && !r.rate_confirmed), [rates]);

  const ratesByType = useMemo(() => {
    return rates.reduce(
      (acc, rate) => {
        if (!acc[rate.rate_type]) acc[rate.rate_type] = [];
        acc[rate.rate_type]!.push(rate);
        return acc;
      },
      {} as Record<string, RateEntry[]>,
    );
  }, [rates]);

  const roomTypesPresent = useMemo(() => {
    const set = new Set(rates.filter((r) => isRoomBoardRateType(r.rate_type)).map((r) => r.rate_type));
    return Array.from(set).sort(
      (a, b) => RATE_TYPES.indexOf(a as (typeof RATE_TYPES)[number]) - RATE_TYPES.indexOf(b as (typeof RATE_TYPES)[number]),
    );
  }, [rates]);

  const ancillaryRows = useMemo(() => rates.filter((r) => isAncillaryRateType(r.rate_type)), [rates]);
  const ancillaryTypesInRates = useMemo(() => {
    const s = new Set(ancillaryRows.map((r) => r.rate_type));
    return Array.from(s);
  }, [ancillaryRows]);

  const handleAddRate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.rate_type || !formData.amount || !formData.effective_from) return;
    const result = await createRate({
      rate_type: formData.rate_type,
      amount_cents: Math.round(parseFloat(formData.amount) * 100),
      effective_from: formData.effective_from,
    });
    if (result) {
      setFormData({ rate_type: "", amount: "", effective_from: "" });
      setAddOpen(false);
    }
  };

  const openSchedule = (rateType: string) => {
    setScheduleRateType(rateType);
    setScheduleForm({ amount: "", effective_from: "" });
    setScheduleFutureNote(null);
    setScheduleOpen(true);
  };

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scheduleRateType || !scheduleForm.amount || !scheduleForm.effective_from) return;
    if (compareYmd(scheduleForm.effective_from, todayYmd) > 0) {
      setScheduleFutureNote(
        "Future effective dates are not applied automatically in this pilot — finance will ship scheduled rollovers next. Track the change offline or add the rate on the effective date.",
      );
      return;
    }
    setScheduleFutureNote(null);
    const result = await createRate({
      rate_type: scheduleRateType,
      amount_cents: Math.round(parseFloat(scheduleForm.amount) * 100),
      effective_from: scheduleForm.effective_from,
    });
    if (result) {
      setScheduleOpen(false);
      setScheduleRateType(null);
    }
  };

  const currentAmountForType = (rateType: string): RateEntry | null => {
    const list = ratesByType[rateType];
    if (!list?.length) return null;
    const currents = list.filter((r) => isRateCurrentForYmd(r.effective_from, r.effective_to, todayYmd));
    if (currents.length === 0) return null;
    return currents.sort((a, b) => compareYmd(b.effective_from, a.effective_from))[0] ?? null;
  };

  const lastTouchForType = (rateType: string): { at: string; by: string } | null => {
    const list = ratesByType[rateType];
    if (!list?.length) return null;
    let bestAt = "";
    let bestBy: string | null = null;
    for (const r of list) {
      const at = typeof r.updated_at === "string" ? r.updated_at : r.created_at;
      if (at > bestAt) {
        bestAt = at;
        bestBy = r.created_by ?? null;
      }
    }
    if (!bestAt) return null;
    return { at: bestAt, by: formatRatesTabEditorDisplay(bestBy) };
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">Loading rates…</div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[8px] border border-destructive/30 bg-destructive/10 px-4 py-3">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  const schedulePreview =
    scheduleForm.effective_from.trim() !== ""
      ? labelFirstMonthlyBillingCycle(scheduleForm.effective_from.trim())
      : null;

  return (
    <div className="space-y-10" id="facility-rate-schedule">
      {pendingActiveRates.length > 0 ? (
        <div
          role="status"
          className="rounded-[8px] border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning"
        >
          <strong className="font-semibold">Rate pending client confirmation.</strong> One or more active rate
          lines are not marked as confirmed — confirm with the responsible party before invoicing.
        </div>
      ) : null}

      <section aria-labelledby="facility-rates-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <h2 id="facility-rates-heading" className="text-base font-semibold text-foreground">
            Rate schedule
          </h2>
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" aria-hidden />
            Add rate
          </Button>
        </div>

        {roomTypesPresent.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No room &amp; board rates yet. Add a private or semi-private monthly rate to publish the posted
            schedule.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {roomTypesPresent.map((roomType) => {
              const typeRates = (ratesByType[roomType] ?? []).slice().sort((a, b) => compareYmd(b.effective_from, a.effective_from));
              const current = currentAmountForType(roomType);
              const exp = expandedType === roomType;
              const touch = lastTouchForType(roomType);

              return (
                <div key={roomType} className="overflow-hidden rounded-[8px] border border-border">
                  <button
                    type="button"
                    onClick={() => setExpandedType(exp ? null : roomType)}
                    className="hover:bg-muted/30 flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition-colors"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        {RATE_TYPE_LABELS[roomType as keyof typeof RATE_TYPE_LABELS] ?? roomType}{" "}
                        <span className="text-muted-foreground"> · </span>
                        <span className="tabular-nums text-muted-foreground">— rooms</span>
                        <span className="text-muted-foreground"> · </span>
                        <span className="tabular-nums text-muted-foreground">— occupied</span>
                        <span className="text-muted-foreground"> · </span>
                        <span className="font-semibold tabular-nums text-foreground">
                          {formatRatesTabPublishedRateDisplay(
                            roomType,
                            current?.amount_cents ?? null,
                          )}
                        </span>
                      </p>
                      {current ? (
                        <p className="text-[13px] text-muted-foreground">
                          Current rate · in effect since{" "}
                          <span className="tabular-nums">
                            {formatInTimeZone(`${current.effective_from}T12:00:00.000Z`, tz, "MMM d, yyyy")}
                          </span>
                          {rateRowStatus(current.effective_from, current.effective_to, todayYmd) === "Active" ? (
                            <Badge className="ml-2 align-middle font-normal bg-emerald-600/15 text-emerald-800 dark:text-emerald-200">
                              Active
                            </Badge>
                          ) : null}
                        </p>
                      ) : (
                        <p className="text-[13px] text-muted-foreground">No current row for this category.</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <ChevronDown
                        className={cn("size-4 text-muted-foreground transition-transform", exp && "rotate-180")}
                        aria-hidden
                      />
                    </div>
                  </button>

                  {exp ? (
                    <div className="space-y-4 border-t border-border bg-muted/5 px-5 py-4">
                      <div className="overflow-x-auto rounded-[8px] border border-border bg-card">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Effective range</TableHead>
                              <TableHead className="text-right">Rate</TableHead>
                              <TableHead>Status</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {typeRates.map((rate) => {
                              const status = rateRowStatus(rate.effective_from, rate.effective_to, todayYmd);
                              const end =
                                rate.effective_to == null || rate.effective_to === ""
                                  ? "Open-ended"
                                  : formatInTimeZone(`${rate.effective_to}T12:00:00.000Z`, tz, "MMM d, yyyy");
                              const start = formatInTimeZone(`${rate.effective_from}T12:00:00.000Z`, tz, "MMM d, yyyy");
                              return (
                                <TableRow key={rate.id}>
                                  <TableCell className="align-top text-sm text-foreground">
                                    <span className="tabular-nums">{start}</span>
                                    <span className="text-muted-foreground"> — </span>
                                    <span className="tabular-nums text-muted-foreground">{end}</span>
                                  </TableCell>
                                  <TableCell className="text-right font-medium tabular-nums">
                                    {formatRatesTabPublishedRateDisplay(rate.rate_type, rate.amount_cents)}
                                  </TableCell>
                                  <TableCell>
                                    {statusBadge(status, {
                                      scheduledOnLabel:
                                        status === "Scheduled"
                                          ? formatInTimeZone(`${rate.effective_from}T12:00:00.000Z`, tz, "MMM d, yyyy")
                                          : undefined,
                                    })}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => openSchedule(roomType)}
                          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "px-0 text-primary")}
                        >
                          Schedule next rate change →
                        </button>
                        {typeRates.some((r) => r.effective_to == null && !r.rate_confirmed) ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isConfirming}
                            onClick={() => {
                              const unconfirmed = typeRates.find((r) => r.effective_to == null && !r.rate_confirmed);
                              if (unconfirmed) void confirmRate(unconfirmed.id);
                            }}
                          >
                            Mark confirmed
                          </Button>
                        ) : null}
                      </div>

                      <p className="text-[12px] text-muted-foreground border-t border-border pt-3">
                        Last changed{" "}
                        {formatRatesTabLastChangedSuffix(
                          touch,
                          touch
                            ? formatInTimeZone(parseISO(touch.at), tz, "MMM d, yyyy · h:mm a")
                            : "",
                        )}
                      </p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="ancillary-fees-heading" className="border-t border-border pt-8">
        <h2 id="ancillary-fees-heading" className="text-base font-semibold text-foreground">
          Ancillary fees
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Community fees, level-of-care add-ons, medication administration, respite, and other published charges.
        </p>

        {ancillaryTypesInRates.length === 0 ? (
          <div className="mt-4 rounded-[8px] border border-border bg-muted/5 px-4 py-6 text-left">
            <p className="text-sm text-muted-foreground">No ancillary fees configured.</p>
            <button
              type="button"
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mt-2 px-0 text-primary")}
              onClick={() => {
                setFormData({ rate_type: "community_fee", amount: "", effective_from: todayYmd });
                setAddOpen(true);
              }}
            >
              Add fee type
            </button>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {ancillaryTypesInRates.map((t) => {
              const cur = currentAmountForType(t);
              return (
                <li key={t} className="flex flex-wrap items-baseline justify-between gap-2 rounded-[8px] border border-border bg-card px-4 py-3">
                  <span className="text-sm font-medium text-foreground">
                    {RATE_TYPE_LABELS[t as keyof typeof RATE_TYPE_LABELS] ?? t}
                  </span>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {formatRatesTabPublishedRateDisplay(t, cur?.amount_cents ?? null)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-[12px] text-muted-foreground">
        Need census-weighted MRR? Wire per–room-type inventory and occupancy in facilities — tracked in backlog for
        finance GA.{" "}
        <Link href="/admin/billing/rates" className="text-primary hover:underline">
          Organization rate tables
        </Link>
      </p>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add rate line</DialogTitle>
            <DialogDescription>Creates a new version for the facility schedule (previous active line closes).</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddRate} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="new-rate-type">Rate type</Label>
              <select
                id="new-rate-type"
                value={formData.rate_type}
                onChange={(e) => setFormData({ ...formData, rate_type: e.target.value })}
                className={inputCls}
              >
                <option value="">Select…</option>
                {RATE_TYPES.map((rateType) => (
                  <option key={rateType} value={rateType}>
                    {RATE_TYPE_LABELS[rateType]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-rate-amt">Amount (USD)</Label>
              <Input
                id="new-rate-amt"
                type="number"
                step="0.01"
                inputMode="decimal"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                placeholder="0.00"
                className={inputCls}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-rate-eff">Effective date</Label>
              <DateInput
                id="new-rate-eff"
                value={formData.effective_from}
                onValueChange={(v) => setFormData({ ...formData, effective_from: v })}
                className={inputCls}
                emptyHint="When this amount first applies (MM/DD/YYYY)"
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isCreating}>
                {isCreating ? "Saving…" : "Save rate"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Schedule next rate change</DialogTitle>
            <DialogDescription>
              {scheduleRateType
                ? RATE_TYPE_LABELS[scheduleRateType as keyof typeof RATE_TYPE_LABELS] ?? scheduleRateType
                : "Rate type"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleScheduleSubmit} className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="sched-amt">New amount (USD)</Label>
              <Input
                id="sched-amt"
                type="number"
                step="0.01"
                inputMode="decimal"
                value={scheduleForm.amount}
                onChange={(e) => setScheduleForm({ ...scheduleForm, amount: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sched-eff">Effective date</Label>
              <DateInput
                id="sched-eff"
                value={scheduleForm.effective_from}
                onValueChange={(v) => {
                  setScheduleForm({ ...scheduleForm, effective_from: v });
                  setScheduleFutureNote(null);
                }}
                emptyHint="When this amount first applies (MM/DD/YYYY)"
              />
            </div>
            {schedulePreview ? (
              <p className="text-sm text-muted-foreground">
                First billing cycle on the new rate: <span className="tabular-nums text-foreground">{schedulePreview}</span>
              </p>
            ) : null}
            <p className="text-[12px] text-muted-foreground">
              Future effective dates are blocked until automated rollovers ship — this form applies when the effective
              date is today or in the past.
            </p>
            {scheduleFutureNote ? <p className="text-sm text-amber-700 dark:text-amber-300">{scheduleFutureNote}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setScheduleOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isCreating}>
                Save change
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
