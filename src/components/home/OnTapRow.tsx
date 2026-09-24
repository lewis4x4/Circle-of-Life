"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import type { HomeRowAction, HomeRowView } from "@/lib/home/on-tap-model";
import { cn } from "@/lib/utils";

import { RANK_BADGE_CLASS, TAG_CLASS } from "./home-styles";

export type OnTapRowProps = {
  row: HomeRowView;
  position: number;
  currentUserId: string | null;
  busy: boolean;
  onClaim: (instanceId: string, claim: boolean) => void;
  /** Called with the row's clear target: a task instance id, or `census:<month>`. */
  onClear: (clearTarget: string, action: HomeRowAction, note: string) => void;
  /** Uncovered-shift rows (COL-596) open the cover screen. */
  onCover?: (assignmentId: string) => void;
  /** Owner preview (COL-707): only navigation shows; no claim or clearance control. */
  readOnly?: boolean;
};

/**
 * One On-tap row: rank badge · title + meta · actions. The clearance action is
 * always on the row (COL-593 rule 5); a negative outcome asks for its note in
 * place rather than in a dialog, so a phone can finish it in three taps.
 */
export function OnTapRow({ row, position, currentUserId, busy, onClaim, onClear, onCover, readOnly = false }: OnTapRowProps) {
  const [noteFor, setNoteFor] = useState<HomeRowAction | null>(null);
  const [note, setNote] = useState("");
  const noteId = useId();
  const claimedByMe = row.owner?.kind === "user" && row.owner.userId === currentUserId;
  const claimable = row.instanceId !== null && row.owner !== null;

  return (
    <li className="grid grid-cols-[auto_1fr] items-start gap-3 border-b border-border/60 px-4 py-3 last:border-b-0 md:grid-cols-[auto_1fr_auto] md:items-center" data-testid={`on-tap-row-${row.id}`}>
      <span className={cn("grid size-[26px] place-items-center rounded-full border text-[11px] font-semibold", RANK_BADGE_CLASS[row.bucket])} aria-hidden>
        {position}
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium leading-snug text-foreground">
          {row.instanceId && row.href ? (
            <Link href={row.href} className="underline-offset-4 hover:underline focus-visible:underline" aria-label={`${row.title}: open this task in Operations`}>
              {row.title}
            </Link>
          ) : (
            row.title
          )}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
          {row.tags.map((tag) => (
            <span key={tag.label} className={cn("inline-flex h-[18px] items-center rounded border px-1.5 text-[10px] font-semibold uppercase tracking-wide", TAG_CLASS[tag.tone])}>
              {tag.label}
            </span>
          ))}
          {row.meta.map((item) => (
            <span key={item} className="tabular-nums">{item}</span>
          ))}
        </p>
        {noteFor ? (
          <form
            className="mt-2 flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!row.clearTarget || note.trim().length === 0) return;
              onClear(row.clearTarget, noteFor, note.trim());
              setNoteFor(null);
              setNote("");
            }}
          >
            <label htmlFor={noteId} className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              What happened? A note is required.
            </label>
            <textarea
              id={noteId}
              className="min-h-16 rounded-md border border-border bg-background px-2.5 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={noteFor.key === "census_flag" ? "Counts only, no names: two move-outs not yet entered." : "No sound at the scheduled time. Vendor called."}
              required
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => { setNoteFor(null); setNote(""); }}>Cancel</Button>
              <Button type="submit" variant="destructive" size="sm" disabled={busy || note.trim().length === 0}>
                Record “{noteFor.label}”
              </Button>
            </div>
          </form>
        ) : null}
      </div>
      <div className="col-span-2 flex flex-wrap items-center justify-end gap-1.5 md:col-span-1">
        {claimable && !readOnly ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => row.instanceId && onClaim(row.instanceId, !(row.owner?.kind === "user"))}
          >
            {row.owner?.kind === "user" ? (claimedByMe ? "Release" : "Take over") : "Claim"}
          </Button>
        ) : null}
        {row.disabledReason ? (
          <Button type="button" variant="ghost" size="sm" disabled title={row.disabledReason}>
            {row.disabledReason}
          </Button>
        ) : null}
        {row.actions.filter((action) => !readOnly || (action.key === "open" && action.href)).map((action) =>
          action.key === "open" && action.href ? (
            <Link
              key={action.key}
              href={action.href}
              className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {action.label} →
            </Link>
          ) : (
            <Button
              key={action.key}
              type="button"
              size="sm"
              variant={action.tone === "primary" ? "default" : action.tone === "danger" ? "outline" : "ghost"}
              className={cn(action.tone === "danger" && "border-destructive/40 text-destructive hover:bg-destructive/10")}
              disabled={busy || noteFor !== null}
              onClick={() => {
                if (action.key === "cover") {
                  if (action.targetId) onCover?.(action.targetId);
                  return;
                }
                if (!row.clearTarget) return;
                if (action.requiresNote) {
                  setNoteFor(action);
                  return;
                }
                onClear(row.clearTarget, action, "");
              }}
            >
              {action.label}
            </Button>
          ),
        )}
      </div>
    </li>
  );
}

export function ClearedRow({ title, meta }: { title: string; meta: string[] }) {
  return (
    <li className="grid grid-cols-[auto_1fr] items-center gap-3 border-b border-border/60 bg-success/5 px-4 py-3 last:border-b-0">
      <span className={cn("grid size-[26px] place-items-center rounded-full border text-[11px] font-semibold", RANK_BADGE_CLASS.cleared)} aria-hidden>
        ✓
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium leading-snug text-muted-foreground line-through">{title}</p>
        <p className="mt-0.5 flex flex-wrap gap-x-2.5 text-xs text-muted-foreground">
          {meta.map((item) => <span key={item}>{item}</span>)}
        </p>
      </div>
    </li>
  );
}
