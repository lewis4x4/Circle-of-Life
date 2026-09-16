"use client";

/**
 * The digital Resident Observation Log (spec 07A §6.2, §6.3, §7 Tier 3).
 * One list, grouped by facility-local day, newest first. Explicit data-fetch
 * state machine: idle | loading | error | success-empty | success-populated.
 * Semantic tokens only, so the same component reads correctly on the admin
 * canvas and inside the dark-locked caregiver shell.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TIMELINE_EMPTY_COPY,
  groupTimelineByDay,
  timelineDetailNeedsExpand,
  timelineLinkFor,
  timelineRowKey,
  timelineRowLabel,
  type ResidentTimelineRow,
  type TimelineDayGroup,
  type TimelineWorkspace,
} from "@/lib/care-events/timeline";
import { loadResidentTimeZone, loadResidentTimeline } from "@/lib/care-events/timeline-load";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type TimelineState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success-empty" }
  | { status: "success-populated"; groups: TimelineDayGroup[]; timeZone: string };

type ResidentTimelineProps = {
  residentId: string;
  workspace: TimelineWorkspace;
};

const TIMELINE_ERROR_HINT = "Check your connection, then retry. If it keeps failing, the resident may be outside your facility access.";

function levelBadgeProps(levelWord: string): { variant: "default" | "destructive"; tone: "none" | "warning" | "info" } {
  switch (levelWord) {
    case "Emergency":
      return { variant: "destructive", tone: "none" };
    case "Urgent":
      return { variant: "default", tone: "warning" };
    case "Heads-up":
      return { variant: "default", tone: "info" };
    default:
      return { variant: "default", tone: "none" };
  }
}

export function ResidentTimeline({ residentId, workspace }: ResidentTimelineProps) {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<TimelineState>({ status: "idle" });
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const load = useCallback(() => {
    setState({ status: "loading" });
    Promise.all([loadResidentTimeZone(supabase, residentId), loadResidentTimeline(supabase, residentId)])
      .then(([timeZone, rows]) => {
        if (rows.length === 0) {
          setState({ status: "success-empty" });
          return;
        }
        setState({ status: "success-populated", groups: groupTimelineByDay(rows, timeZone), timeZone });
      })
      .catch((error: unknown) => {
        setState({ status: "error", message: formatLiveDataLoadError(error, "The timeline is unavailable right now.") });
      });
  }, [residentId, supabase]);

  useEffect(() => {
    if (!residentId) return;
    // Defer so the loading transition happens in a callback, not in the effect body.
    queueMicrotask(load);
  }, [load, residentId]);

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  if (state.status === "idle" || state.status === "loading") {
    return (
      <div className="flex flex-col gap-2" role="status" aria-live="polite" aria-label="Loading timeline">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div role="alert" className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
        <p className="text-sm font-semibold text-foreground">Could not load the timeline</p>
        <p className="text-sm text-muted-foreground">{state.message}</p>
        <p className="text-sm text-muted-foreground">{TIMELINE_ERROR_HINT}</p>
        <div>
          <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={load}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (state.status === "success-empty") {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card px-4 py-6">
        <p className="text-sm font-semibold text-foreground">Nothing recorded yet</p>
        <p className="mt-1 text-sm text-muted-foreground">{TIMELINE_EMPTY_COPY}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {state.groups.map((group) => (
        <section key={group.dayKey} aria-label={group.dayLabel} className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">{group.dayLabel}</h3>
          <ol className="divide-y divide-border rounded-lg border border-border bg-card">
            {group.rows.map((row) => (
              <TimelineEntry
                key={timelineRowKey(row)}
                row={row}
                timeZone={state.timeZone}
                workspace={workspace}
                expanded={expanded.has(timelineRowKey(row))}
                onToggle={() => toggleExpanded(timelineRowKey(row))}
              />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

type TimelineEntryProps = {
  row: ResidentTimelineRow;
  timeZone: string;
  workspace: TimelineWorkspace;
  expanded: boolean;
  onToggle: () => void;
};

function TimelineEntry({ row, timeZone, workspace, expanded, onToggle }: TimelineEntryProps) {
  const label = timelineRowLabel(row, timeZone);
  const links = timelineLinkFor(workspace, row);
  const detail = row.detail?.trim() || null;
  const canExpand = timelineDetailNeedsExpand(detail);
  const badge = label.levelWord ? levelBadgeProps(label.levelWord) : null;
  const tapClass = workspace === "caregiver" ? "min-h-11" : "";

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm tabular-nums text-muted-foreground">{label.timeLabel}</span>
        <span className="text-sm font-medium text-foreground">{label.title}</span>
        {label.levelWord && badge ? (
          <Badge variant={badge.variant} tone={badge.tone} aria-label={`Level ${label.levelWord}`}>
            {label.levelWord}
          </Badge>
        ) : null}
        {label.sourceWord !== label.title ? (
          <span className="text-xs text-muted-foreground">{label.sourceWord}</span>
        ) : null}
      </div>
      {detail ? (
        <p className={cn("whitespace-pre-line text-sm text-muted-foreground", !expanded && "line-clamp-2")}>{detail}</p>
      ) : null}
      {canExpand || links.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {canExpand ? (
            <Button type="button" variant="ghost" size="sm" className={tapClass} aria-expanded={expanded} onClick={onToggle}>
              {expanded ? "Show less" : "Show more"}
            </Button>
          ) : null}
          {links.map((link) => (
            <Link
              key={link.href}
              prefetch={false}
              href={link.href}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), tapClass)}
            >
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}
    </li>
  );
}
