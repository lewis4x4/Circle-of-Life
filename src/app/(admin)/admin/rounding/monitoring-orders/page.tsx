"use client";

/**
 * Monitoring Orders, at facility level. Spec 25A section 4, defect 9.
 *
 * The Watches tab this replaces had a pending-approval queue on it, which
 * decision 5 retired: a Monitoring Order is a clinical instruction with an
 * ordering party behind it, so it takes effect when it is entered and there is
 * nothing to approve. It also embedded `residents.room_number`, a column that
 * does not exist, so it answered `42703` and never loaded at all.
 *
 * Entry is on the resident record, where section 4.5 puts it. This tab answers
 * the question that needs a building-wide view: who is on a different cadence
 * right now, why, and who asked for it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RefreshCw } from "lucide-react";

import { FacilityGateNotice } from "@/components/common/FacilityGate";
import { RoundingHubNav } from "../rounding-hub-nav";
import { MonitoringOrdersTable } from "@/components/rounding/MonitoringOrdersTable";
import { RoundingEmptyNotice, RoundingErrorNotice } from "@/components/rounding/RoundingNotices";
import { PageHeader } from "@/design-system/components/PageHeader";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/ui/metric-card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  MONITORING_ORDERS_EMPTY_ACTIVE,
  MONITORING_ORDERS_EMPTY_CLOSED,
  MONITORING_ORDERS_LOAD_FAILED,
  monitoringOrdersSubtitle,
  resolveRoundingFacilityScope,
} from "@/lib/rounding/monitoring-orders-display-copy";
import {
  cancelMonitoringOrder,
  fetchActiveMonitoringOrders,
  fetchClosedMonitoringOrders,
  fetchMonitoringOrderResidents,
  type MonitoringOrderListRow,
  type MonitoringOrderResident,
} from "@/lib/rounding/monitoring-orders-list";
import {
  logRoundingQueryFailure,
  roundingCommandRefusal,
} from "@/lib/rounding/rounding-query-error";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type LoadState = "idle" | "loading" | "ready" | "error";

export default function MonitoringOrdersPage() {
  const { selectedFacilityId } = useFacilityStore();
  return <ScopedMonitoringOrdersPage key={selectedFacilityId ?? "none"} />;
}

function ScopedMonitoringOrdersPage() {
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const supabase = useMemo(() => createClient() as unknown as SupabaseClient, []);
  const scope = resolveRoundingFacilityScope(
    selectedFacilityId,
    availableFacilities.find((facility) => facility.id === selectedFacilityId)?.name,
  );

  const [active, setActive] = useState<MonitoringOrderListRow[]>([]);
  const [closed, setClosed] = useState<MonitoringOrderListRow[]>([]);
  const [residents, setResidents] = useState<Map<string, MonitoringOrderResident>>(new Map());
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErrorMessage(null);
    if (!selectedFacilityId || !isBrowserSupabaseConfigured()) {
      setActive([]);
      setClosed([]);
      setResidents(new Map());
      setLoadState("ready");
      return;
    }

    setLoadState("loading");
    try {
      const [activeRows, closedRows] = await Promise.all([
        fetchActiveMonitoringOrders(supabase, selectedFacilityId),
        fetchClosedMonitoringOrders(supabase, selectedFacilityId),
      ]);
      const residentRows = await fetchMonitoringOrderResidents(
        supabase,
        selectedFacilityId,
        [...activeRows, ...closedRows].map((row) => row.resident_id),
      );
      setActive(activeRows);
      setClosed(closedRows);
      setResidents(new Map(residentRows.map((row) => [row.id, row])));
      setLoadState("ready");
    } catch (error) {
      setErrorMessage(
        logRoundingQueryFailure(
          "rounding.monitoring_orders.load",
          error,
          MONITORING_ORDERS_LOAD_FAILED,
        ),
      );
      setActive([]);
      setClosed([]);
      setLoadState("error");
    }
  }, [selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const standDown = useCallback(
    async (orderId: string, reason: string) => {
      try {
        await cancelMonitoringOrder(supabase, orderId, reason);
        await load();
      } catch (error) {
        // `cancel_monitoring_order` names its own refusals: the role that
        // cannot cancel, the order that is not active, the missing reason. Its
        // sentence beats anything this page could guess.
        logRoundingQueryFailure("rounding.monitoring_orders.cancel", error, "");
        setErrorMessage(
          roundingCommandRefusal(
            error,
            "That order could not be stood down. Retry, or try again in a moment.",
          ),
        );
      }
    },
    [load, supabase],
  );

  const reviewOverdueCount = active.filter(
    (row) =>
      row.ends_at == null &&
      row.review_due_at != null &&
      new Date(row.review_due_at).getTime() <= Date.now(),
  ).length;

  return (
    <div className="relative w-full space-y-6 pb-12">
      <PageHeader
        title="Monitoring Orders"
        subtitle={monitoringOrdersSubtitle(scope)}
        actions={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => void load()}
            aria-label="Refresh Monitoring Orders"
            title="Refresh"
            disabled={loadState === "loading"}
          >
            <RefreshCw
              className={cn("size-4", loadState === "loading" && "animate-spin")}
              aria-hidden
            />
          </Button>
        }
      />

      <RoundingHubNav />

      {!selectedFacilityId ? (
        <FacilityGateNotice reason="Monitoring orders are in force per building." />
      ) : (
        <>
          {errorMessage ? (
            <RoundingErrorNotice message={errorMessage} onRetry={() => void load()} />
          ) : null}

          <section aria-label="Monitoring Order counts">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MetricCard
                label="Orders in force"
                value={active.length}
                numericValue={active.length}
                thresholds={{ type: "informational" }}
                hint="Residents on a cadence a clinician ordered"
              />
              <MetricCard
                label="Reviews overdue"
                value={reviewOverdueCount}
                numericValue={reviewOverdueCount}
                thresholds={{ type: "critical-count" }}
                hint="Open ended orders past the date somebody agreed to revisit them"
              />
              <MetricCard
                label="Closed recently"
                value={closed.length}
                numericValue={closed.length}
                thresholds={{ type: "informational" }}
                hint="The most recent orders that ended, were cancelled, or expired"
              />
            </div>
          </section>

          <section aria-label="Orders in force" className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">In force</h2>
            {loadState === "loading" && active.length === 0 ? (
              <RoundingEmptyNotice
                label="Loading Monitoring Orders"
                copy={{
                  why: "Loading the orders.",
                  guidance: "The building's orders are on their way.",
                }}
              />
            ) : active.length === 0 ? (
              <RoundingEmptyNotice
                label="No Monitoring Order in force"
                copy={MONITORING_ORDERS_EMPTY_ACTIVE}
              />
            ) : (
              <MonitoringOrdersTable
                rows={active}
                residents={residents}
                label="Monitoring Orders in force at this building"
                cancellable
                onCancel={standDown}
              />
            )}
          </section>

          <section aria-label="Orders that have closed" className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">Closed</h2>
            {closed.length === 0 ? (
              <RoundingEmptyNotice
                label="No closed Monitoring Order"
                copy={MONITORING_ORDERS_EMPTY_CLOSED}
              />
            ) : (
              <MonitoringOrdersTable
                rows={closed}
                residents={residents}
                label="Monitoring Orders that have closed at this building"
                cancellable={false}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
