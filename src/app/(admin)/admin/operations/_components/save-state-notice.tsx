"use client";

import { cn } from "@/lib/utils";
import type { SaveState } from "@/lib/operations/recovery-client";

/**
 * COL-146 save-state notice for a recording surface on a shared device. It
 * says exactly what the server has and has not confirmed: saving, saved,
 * not saved, retry offered, offline, uploading and expired each carry
 * distinct visible text, the region is polite-live so the answer is read
 * out when it changes, the actions are ordinary buttons reachable from the
 * keyboard, and the current person is always shown. Design-system tokens
 * only; wiring into the staff workspace is COL-148.
 */

export type NoticeTone = "neutral" | "busy" | "success" | "warning" | "danger";

export type NoticeView = {
  tone: NoticeTone;
  title: string;
  detail: string;
  actions: { retry?: boolean; discard?: boolean; check?: boolean };
};

/** The words for every machine state; the notice renders these and nothing else. */
export function describeSaveState(state: SaveState, uploading = false): NoticeView {
  switch (state.kind) {
    case "idle":
      return uploading
        ? { tone: "busy", title: "Uploading evidence", detail: "Files are still moving. Keep this page open until the upload finishes.", actions: {} }
        : { tone: "neutral", title: "Ready to record", detail: "Nothing is waiting to be saved.", actions: {} };
    case "saving_draft":
      return { tone: "busy", title: "Saving", detail: "Storing the request with the server before sending it.", actions: {} };
    case "submitting":
      return { tone: "busy", title: "Saving", detail: "Waiting for the server to confirm.", actions: {} };
    case "saved":
      return { tone: "success", title: "Saved", detail: state.record.replayed ? "The server confirmed this record; it had already been saved earlier." : "The server confirmed this record.", actions: {} };
    case "rejected":
      return { tone: "danger", title: "Not saved", detail: state.message, actions: {} };
    case "uncertain":
      return { tone: "warning", title: "Not confirmed", detail: state.message ?? "The server has not answered whether this save landed.", actions: { check: true, discard: true } };
    case "reconciling":
      return { tone: "busy", title: "Checking", detail: "Asking the server whether this save landed.", actions: {} };
    case "unsaved":
      return {
        tone: "warning",
        title: "Not saved yet",
        detail: "The server has no record of this. Retry the same save: the server resumes what was entered, and nothing edited since is sent.",
        actions: { retry: true, discard: true },
      };
    case "resuming":
      return { tone: "busy", title: "Retrying", detail: "The server is resuming the same save.", actions: {} };
    case "offline":
      return { tone: "danger", title: "Offline. Not saved", detail: state.message, actions: {} };
    case "expired":
      return { tone: "warning", title: "Earlier save expired", detail: "That request can no longer be resumed. Start a fresh save.", actions: {} };
    case "discarded":
      return { tone: "neutral", title: "Draft discarded", detail: "Nothing was recorded from it.", actions: {} };
  }
}

const TONE_TEXT: Record<NoticeTone, string> = {
  neutral: "text-muted-foreground",
  busy: "text-info",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
};

const TONE_DOT: Record<NoticeTone, string> = {
  neutral: "bg-muted-foreground",
  busy: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

const BUTTON = "rounded-sm border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export type SaveStateNoticeProps = {
  state: SaveState;
  /** The current person, from the auth context; shown on every notice so a shared device never hides who is recording. */
  actorName: string | null | undefined;
  /** Evidence bytes still in flight (COL-143 in-flight rows); shown beside the save state. */
  uploading?: boolean;
  onRetry?: () => void;
  onDiscard?: () => void;
  onCheckAgain?: () => void;
  className?: string;
};

export function SaveStateNotice({ state, actorName, uploading = false, onRetry, onDiscard, onCheckAgain, className }: SaveStateNoticeProps) {
  const view = describeSaveState(state, uploading);
  const showUploading = uploading && state.kind !== "idle";
  return (
    <section
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-save-state={state.kind}
      className={cn("flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground", className)}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", TONE_DOT[view.tone])} />
        <div className="flex min-w-0 flex-col gap-1">
          <p className={cn("font-semibold", TONE_TEXT[view.tone])}>{view.title}</p>
          <p className="text-muted-foreground">{view.detail}</p>
          {showUploading ? <p className="text-info">Evidence upload in progress. Keep this page open.</p> : null}
        </div>
      </div>
      {view.actions.retry || view.actions.discard || view.actions.check ? (
        <div className="flex flex-wrap gap-2">
          {view.actions.retry ? (
            <button type="button" className={BUTTON} onClick={onRetry}>
              Retry the same save
            </button>
          ) : null}
          {view.actions.check ? (
            <button type="button" className={BUTTON} onClick={onCheckAgain}>
              Check again
            </button>
          ) : null}
          {view.actions.discard ? (
            <button type="button" className={BUTTON} onClick={onDiscard}>
              Discard
            </button>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground" data-testid="current-person">
        Current person: <span className="font-medium text-foreground">{actorName?.trim() ? actorName : "not signed in"}</span>
      </p>
    </section>
  );
}
