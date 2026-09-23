"use client";

/**
 * The facility level Monitoring Orders table. Spec 25A section 4.
 *
 * One row per order, and every column is about the order rather than about the
 * resident: interval, reason, who ordered it, how it arrived, and the window it
 * runs for. Decision D5 keeps resident level numbers out of the module, and an
 * order carries no number about the resident to begin with.
 *
 * Rows are 32 to 40 pixels, which is the constitution's table density, and the
 * table is a real `<table>` so a screen reader reads the header with the cell.
 */

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { formatEscalationTimestamp } from "@/lib/rounding/rounding-timestamps";
import {
  intervalLabel,
  orderedByLabel,
  receivedAsLabel,
  reasonLabel,
  remainingWindow,
} from "@/lib/rounding/monitoring-orders";
import {
  MONITORING_ORDER_CANCEL_REASON_PROMPT,
  monitoringOrderEnteredByLabel,
  monitoringOrderResidentName,
  monitoringOrderRoomLabel,
  monitoringOrderStatusLabel,
} from "@/lib/rounding/monitoring-orders-display-copy";
import type {
  MonitoringOrderListRow,
  MonitoringOrderResident,
} from "@/lib/rounding/monitoring-orders-list";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";

export function MonitoringOrdersTable({
  rows,
  residents,
  label,
  cancellable,
  onCancel,
}: {
  rows: readonly MonitoringOrderListRow[];
  residents: Map<string, MonitoringOrderResident>;
  label: string;
  /** In force orders can be stood down; closed ones cannot. */
  cancellable: boolean;
  onCancel?: (orderId: string, reason: string) => Promise<void>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const nowIso = new Date().toISOString();

  async function submitCancel(orderId: string) {
    if (!onCancel || reason.trim().length === 0) return;
    setBusy(true);
    try {
      await onCancel(orderId, reason.trim());
      setOpenId(null);
      setReason("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <HorizontalScroll label="Monitoring orders">
        <table className="w-full min-w-[840px] border-collapse text-[13px]">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th scope="col" className="px-4 py-2 font-medium">
                Resident
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                How often
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Why
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Ordered by
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Window
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                State
              </th>
              {cancellable ? (
                <th scope="col" className="px-4 py-2 font-medium">
                  <span className="sr-only">Stand down</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const resident = residents.get(row.resident_id);
              const window = remainingWindow(
                {
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
                },
                nowIso,
              );

              return (
                <tr key={row.id} className="border-b border-border/60 last:border-b-0 align-top">
                  <td className="px-4 py-2">
                    <Link
                      href={`/admin/residents/${row.resident_id}`}
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {monitoringOrderResidentName(resident)}
                    </Link>
                    <span className="block text-[12px] text-muted-foreground">
                      {monitoringOrderRoomLabel(resident)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-foreground">{intervalLabel(row.interval_minutes)}</td>
                  <td className="px-4 py-2">
                    <span className="text-foreground">{reasonLabel(row.reason_category)}</span>
                    <span className="block text-[12px] text-muted-foreground">{row.reason_note}</span>
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-foreground">{row.ordered_by_name}</span>
                    <span className="block text-[12px] text-muted-foreground">
                      {orderedByLabel(row.ordered_by_type)}
                      <span aria-hidden className="px-1.5 text-border">
                        ·
                      </span>
                      {receivedAsLabel(row.order_received_as)}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-foreground">
                      From {formatEscalationTimestamp(row.starts_at)}
                    </span>
                    <span className="block text-[12px] text-muted-foreground">{window.label}</span>
                  </td>
                  <td className="px-4 py-2">
                    <StatusPill tone={window.reviewOverdue ? "warning" : "muted"}>
                      {monitoringOrderStatusLabel(row.status)}
                    </StatusPill>
                    <span className="mt-1 block text-[12px] text-muted-foreground">
                      {monitoringOrderEnteredByLabel(row.user_profiles?.full_name)}
                    </span>
                    {row.cancel_reason ? (
                      <span className="mt-1 block text-[12px] text-muted-foreground">
                        Stood down: {row.cancel_reason}
                      </span>
                    ) : null}
                  </td>
                  {cancellable ? (
                    <td className="px-4 py-2">
                      {openId === row.id ? (
                        <div className="w-[240px] space-y-2">
                          <Textarea
                            aria-label="Why this order is being stood down"
                            value={reason}
                            rows={2}
                            onChange={(event) => setReason(event.target.value)}
                            placeholder={MONITORING_ORDER_CANCEL_REASON_PROMPT}
                            className="min-h-[56px] text-[13px]"
                          />
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={busy || reason.trim().length === 0}
                              onClick={() => void submitCancel(row.id)}
                            >
                              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                              Stand down
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => {
                                setOpenId(null);
                                setReason("");
                              }}
                            >
                              Keep it
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setOpenId(row.id);
                            setReason("");
                          }}
                        >
                          Stand down
                        </Button>
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </HorizontalScroll>
    </div>
  );
}
