"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { cn } from "@/lib/utils";

export type AlertSeverity = "high" | "medium" | "low";
export type AlertStatus = "new" | "action" | "review";

export type AlertItem = {
  id: string;
  severity: AlertSeverity;
  title: string;
  facilityId: string;
  organizationId: string;
  facilityName: string;
  body: string;
  openedAt: string;
  status: AlertStatus;
  detailsHref?: string;
};

export type PriorityAlertStackProps = {
  items: AlertItem[];
  onAck?: (alert: AlertItem) => Promise<void>;
  ackEndpoint?: string;
  className?: string;
  emptyCopy?: string;
  /** Anchor for relative time formatting. Defaults to time-of-mount (stable). */
  now?: Date;
};

const SEVERITY_TO_DOT: Record<AlertSeverity, string> = {
  high: "bg-danger",
  medium: "bg-warning",
  low: "bg-success",
};

const SEVERITY_TO_LABEL: Record<AlertSeverity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const STATUS_TO_LABEL: Record<AlertStatus, string> = {
  new: "NEW",
  action: "ACTION",
  review: "REVIEW",
};

const STATUS_TO_CLASS: Record<AlertStatus, string> = {
  new: "border-danger text-danger",
  action: "border-warning text-warning",
  review: "border-info text-info",
};

export function PriorityAlertStack({
  items,
  onAck,
  ackEndpoint = "/api/v2/alerts",
  className,
  emptyCopy = "No priority alerts in scope.",
  now,
}: PriorityAlertStackProps) {
  const [localItems, setLocalItems] = useState<AlertItem[]>(items);
  const [inFlightId, setInFlightId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  const nowMs = now ? now.getTime() : null;

  const handleAck = useCallback(
    async (alert: AlertItem) => {
      setErrorId(null);
      setInFlightId(alert.id);
      const previous = localItems;
      setLocalItems((prev) => prev.filter((item) => item.id !== alert.id));

      try {
        if (onAck) {
          await onAck(alert);
        } else {
          const response = await fetch(`${ackEndpoint}/${alert.id}/ack`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              organizationId: alert.organizationId,
              facilityId: alert.facilityId,
            }),
          });
          if (!response.ok) {
            throw new Error(`ACK failed (${response.status})`);
          }
        }
      } catch {
        setLocalItems(previous);
        setErrorId(alert.id);
      } finally {
        setInFlightId(null);
      }
    },
    [ackEndpoint, localItems, onAck],
  );

  if (localItems.length === 0) {
    return <p className={cn("text-xs text-text-muted", className)}>{emptyCopy}</p>;
  }

  return (
    <ul
      aria-label="Priority alerts"
      className={cn("flex flex-col gap-2", className)}
    >
      {localItems.map((alert) => {
        const pending = inFlightId === alert.id;
        const failed = errorId === alert.id;
        return (
          <li
            key={alert.id}
            data-severity={alert.severity}
            className={cn(
              "rounded-md border bg-surface px-3 py-2",
              alert.severity === "high"
                ? "border-danger"
                : alert.severity === "medium"
                  ? "border-warning"
                  : "border-success",
            )}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={cn("mt-1 h-2 w-2 rounded-full", SEVERITY_TO_DOT[alert.severity])}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-text-primary">
                    {alert.title}
                  </h3>
                  <span
                    data-status={alert.status}
                    className={cn(
                      "inline-flex h-5 items-center rounded-sm border px-1.5 text-xs font-semibold",
                      STATUS_TO_CLASS[alert.status],
                    )}
                  >
                    {STATUS_TO_LABEL[alert.status]}
                  </span>
                </div>
                <p className="text-xs text-text-secondary">{alert.body}</p>
                <p className="text-xs text-text-muted">
                  <span>{SEVERITY_TO_LABEL[alert.severity]}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{alert.facilityName}</span>
                  <span aria-hidden="true"> · </span>
                  <time dateTime={alert.openedAt}>{formatOpened(alert.openedAt, nowMs)}</time>
                </p>
                {failed && (
                  <p role="alert" className="text-xs text-danger">
                    Could not acknowledge — try again.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      void handleAck(alert);
                    }}
                    disabled={pending}
                    aria-label={`Acknowledge alert: ${alert.title}`}
                    className="inline-flex h-7 items-center rounded-sm border border-brand-primary bg-surface-elevated px-3 text-xs font-semibold text-text-primary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pending ? "ACK…" : "ACK"}
                  </button>
                  {alert.detailsHref && (
                    <Link
                      href={alert.detailsHref}
                      className="inline-flex h-7 items-center rounded-sm border border-border bg-surface-elevated px-3 text-xs font-medium text-text-secondary hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                    >
                      Details →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function formatOpened(iso: string, nowMs: number | null): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  if (nowMs == null) return new Date(iso).toISOString();
  const seconds = Math.max(0, Math.round((nowMs - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
