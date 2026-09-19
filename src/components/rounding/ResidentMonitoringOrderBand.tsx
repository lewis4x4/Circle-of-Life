"use client";

import { useCallback, useEffect, useState } from "react";

import { StatusPill } from "@/components/ui/status-pill";
import { formatFacilityTimestampEt } from "@/lib/facility-wall-clock";
import {
  orderSummaryLine,
  receivedAsLabel,
  remainingWindow,
  type ActiveMonitoringOrder,
} from "@/lib/rounding/monitoring-orders";
import { createClient } from "@/lib/supabase/client";

type OrderRow = {
  id: string;
  interval_minutes: number;
  starts_at: string;
  ends_at: string | null;
  review_due_at: string | null;
  ordered_by_type: string;
  ordered_by_name: string;
  order_received_as: string;
  reason_category: string;
  reason_note: string;
};

function toOrder(row: OrderRow): ActiveMonitoringOrder {
  return {
    id: row.id,
    intervalMinutes: row.interval_minutes,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    reviewDueAt: row.review_due_at,
    orderedByType: row.ordered_by_type,
    orderedByName: row.ordered_by_name,
    orderReceivedAs: row.order_received_as,
    reasonCategory: row.reason_category,
    reasonNote: row.reason_note,
  };
}

/**
 * The persistent band on the resident record while an order is in force.
 *
 * It is a Monitoring Order, never a watch. It announces itself with
 * role="status" because a caregiver opening the record needs to know the
 * resident is on a different cadence before they do anything else.
 *
 * Renders nothing when there is no active order: an absent band is the honest
 * empty state for a resident on the standard cadence.
 */
export function ResidentMonitoringOrderBand({
  residentId,
  reloadToken,
}: {
  residentId: string;
  reloadToken?: number;
}) {
  const [order, setOrder] = useState<ActiveMonitoringOrder | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("resident_monitoring_orders")
      .select(
        "id, interval_minutes, starts_at, ends_at, review_due_at, ordered_by_type, ordered_by_name, order_received_as, reason_category, reason_note",
      )
      .eq("resident_id", residentId)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("starts_at", { ascending: false })
      .limit(1);

    if (error) {
      setUnavailable(true);
      setOrder(null);
      return;
    }
    setUnavailable(false);
    const row = (data ?? [])[0] as OrderRow | undefined;
    setOrder(row ? toOrder(row) : null);
  }, [residentId]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  if (unavailable) {
    return (
      <section aria-label="Monitoring Order" className="rounded-xl border border-border bg-card p-4 text-sm">
        <p className="font-medium text-foreground">Monitoring Orders are not loading right now</p>
        <p className="text-muted-foreground">
          An order in force would show its interval, reason and remaining window here.
        </p>
      </section>
    );
  }

  if (!order) return null;

  const remaining = remainingWindow(order, new Date().toISOString());

  return (
    <section
      role="status"
      aria-label="Monitoring Order in force"
      className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)] ring-1 ring-border/60"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="info">Monitoring Order</StatusPill>
            <p className="text-[15px] font-semibold text-foreground">{orderSummaryLine(order)}</p>
          </div>
          <p className="text-[13px] text-muted-foreground">
            {order.orderedByName} · {receivedAsLabel(order.orderReceivedAs)} · started{" "}
            {formatFacilityTimestampEt(order.startsAt)}
          </p>
          <p className="text-[13px] text-foreground">{order.reasonNote}</p>
        </div>
        <div className="shrink-0 text-right">
          {remaining.reviewOverdue ? (
            <StatusPill tone="warning">{remaining.label}</StatusPill>
          ) : (
            <p className="text-[13px] text-muted-foreground">{remaining.label}</p>
          )}
        </div>
      </div>
    </section>
  );
}

export default ResidentMonitoringOrderBand;
