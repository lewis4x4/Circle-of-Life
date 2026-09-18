"use client";

/**
 * One check on the Live board.
 *
 * Nothing on this row is a number about the resident. Spec decision D5: no
 * score, no percentage, no index on a resident row anywhere in the module. The
 * numbers on this surface are facility level and they live in the strip above.
 *
 * The room label comes from the bed-to-room join the roster read resolves, not
 * from a `residents.room_number` column, because that column does not exist and
 * asking for it is what took the board down.
 */

import { AlertTriangle, CheckCircle2, Clock, Clock3, Eye } from "lucide-react";

import { LiveBoardEscalationActions } from "@/components/rounding/LiveBoardEscalationActions";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  LIVE_BOARD_UNASSIGNED_COPY,
  liveBoardRoomLabel,
  liveBoardShiftLabel,
  liveBoardStatusCopy,
  liveBoardWindowLabel,
  type LiveBoardTone,
} from "@/lib/rounding/live-board-display-copy";
import { formatLiveRoundingDueLabel } from "@/lib/rounding/live-rounding-display-copy";
import type {
  LiveBoardEscalationRow,
  LiveBoardShiftRow,
  LiveBoardTaskRow as TaskRow,
  LiveBoardWindowRow,
} from "@/lib/rounding/live-board-fetch";
import { cn } from "@/lib/utils";

const STATUS_ICONS: Record<LiveBoardTone, typeof Eye> = {
  danger: AlertTriangle,
  warning: Clock3,
  default: Eye,
};

function personLabel(person: TaskRow["staff"]): string {
  const first = (person?.preferred_name ?? person?.first_name)?.trim() ?? "";
  const last = person?.last_name?.trim() ?? "";
  const combined = `${first} ${last}`.trim();
  return combined || LIVE_BOARD_UNASSIGNED_COPY;
}

function completionIcon(group: string, tone: LiveBoardTone) {
  if (group === "completed") return CheckCircle2;
  if (group === "late") return Clock;
  if (group === "pending" && tone === "default") return Eye;
  return STATUS_ICONS[tone];
}

export function LiveBoardTaskRow({
  task,
  residentName,
  roomNumber,
  shifts,
  windows,
  escalations,
  onOpen,
  onEscalationHandled,
}: {
  task: TaskRow;
  residentName: string;
  roomNumber: string | null;
  shifts: readonly LiveBoardShiftRow[];
  windows: readonly LiveBoardWindowRow[];
  escalations: readonly LiveBoardEscalationRow[];
  onOpen: (task: TaskRow) => void;
  onEscalationHandled: () => void;
}) {
  const status = liveBoardStatusCopy(task.status);
  const Icon = completionIcon(status.group, status.tone);
  const windowLabel = liveBoardWindowLabel(task.window_key, task.monitoring_order_id, windows);
  const shiftKey = windows.find((window) => window.window_key === task.window_key)?.shift_key ?? null;

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div
        className={cn(
          "group flex min-h-[40px] flex-col gap-3 md:flex-row md:items-center md:gap-4",
          status.actionable && "cursor-pointer",
        )}
        onClick={status.actionable ? () => onOpen(task) : undefined}
        role={status.actionable ? "button" : undefined}
        tabIndex={status.actionable ? 0 : undefined}
        onKeyDown={
          status.actionable
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(task);
                }
              }
            : undefined
        }
        aria-label={status.actionable ? `Record a check for ${residentName}` : undefined}
      >
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md border",
            status.tone === "danger" && "border-destructive/40 bg-destructive/10 text-destructive",
            status.tone === "warning" && "border-warning/40 bg-warning/10 text-warning",
            status.tone === "default" && "border-border bg-muted text-muted-foreground",
          )}
          aria-hidden
        >
          <Icon className="size-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="truncate text-[15px] font-semibold text-foreground">
              {residentName}
            </span>
            <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
              {liveBoardRoomLabel(roomNumber)}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {windowLabel}
            <span aria-hidden className="px-1.5 text-border">
              ·
            </span>
            {liveBoardShiftLabel(shiftKey, shifts)}
            <span aria-hidden className="px-1.5 text-border">
              ·
            </span>
            {personLabel(task.staff)}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 md:justify-end">
          <div className="text-left md:text-right">
            <p
              className={cn(
                "text-[12px] font-semibold tabular-nums",
                status.tone === "danger" && "text-destructive",
                status.tone === "warning" && "text-warning",
                status.tone === "default" && "text-foreground",
              )}
            >
              {formatLiveRoundingDueLabel(task.due_at)}
            </p>
            <Badge
              variant="outline"
              className={cn(
                "mt-0.5 text-[11px] font-medium",
                status.tone === "danger" && "border-destructive/40 text-destructive",
                status.tone === "warning" && "border-warning/40 text-warning",
              )}
            >
              {status.label}
            </Badge>
          </div>
          {status.actionable ? (
            <span
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "pointer-events-none shrink-0 group-hover:bg-muted",
              )}
              aria-hidden
            >
              Check in
            </span>
          ) : null}
        </div>
      </div>

      <LiveBoardEscalationActions escalations={escalations} onDone={onEscalationHandled} />
    </div>
  );
}
