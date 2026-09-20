"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, X, AlertTriangle } from "lucide-react";
import { ObservationCapture } from "./ObservationCapture";

import { logRoundingQueryFailure } from "@/lib/rounding/rounding-query-error";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { CompletionPayload } from "@/lib/rounding/types";

export type QuickCheckTask = {
  id: string;
  organizationId: string;
  facilityId: string;
  residentName: string;
  roomLabel: string | null;
  dueAt: string;
  status: string;
};

type QuickCheckDrawerProps = {
  task: QuickCheckTask | null;
  open: boolean;
  onClose: () => void;
  onCompleted: (taskId: string) => void;
  queuePosition?: { current: number; total: number } | null;
  onNextTask?: () => void;
  /** When false, completion is simulated locally (for dry runs). @default true */
  persistCompletion?: boolean;
};

type RetryOwner = NonNullable<CompletionPayload["retryOwner"]>;
type PendingCheck = { payload: CompletionPayload; busy: boolean; reasonRequired: boolean; error: string | null };
// Clinical details stay in this tab's memory, never in browser storage. Records
// survive drawer unmounts and remain isolated by the original signed session.
const pendingChecks = new Map<string, PendingCheck>();
const acknowledgedChecks = new Set<string>();
const pendingListeners = new Set<() => void>();
function updatePending(key: string, pending: PendingCheck | null) {
  if (pending) pendingChecks.set(key, pending);
  else pendingChecks.delete(key);
  pendingListeners.forEach((listener) => listener());
}
function subscribePending(listener: () => void) {
  pendingListeners.add(listener);
  return () => { pendingListeners.delete(listener); };
}
function ownerKey(owner: RetryOwner) {
  return JSON.stringify([owner.userId, owner.sessionId, owner.organizationId, owner.facilityId]);
}
async function currentOwner(task: QuickCheckTask): Promise<RetryOwner> {
  const { data, error } = await createClient().rpc("haven_current_edge_actor" as never);
  const actor = data as { user_id?: string; session_id?: string; organization_id?: string } | null;
  if (error || !actor?.user_id || !actor.session_id || actor.organization_id !== task.organizationId || !task.facilityId) {
    throw new Error("Current account authorization is unavailable. Reopen this check after signing in.");
  }
  return { userId: actor.user_id, sessionId: actor.session_id, organizationId: actor.organization_id, facilityId: task.facilityId };
}

export function QuickCheckDrawer(props: QuickCheckDrawerProps) {
  const { task, open, persistCompletion = true } = props;
  const [owner, setOwner] = useState<RetryOwner | null>(null);
  const [authorityError, setAuthorityError] = useState<string | null>(null);
  const scope = task ? JSON.stringify([task.organizationId, task.facilityId, task.id]) : "";
  useEffect(() => {
    if (!persistCompletion || !open || !task) return;
    let generation = 0;
    let active = true;
    function resolveOwner() {
      const attempt = ++generation;
      setOwner(null);
      setAuthorityError(null);
      // Defer out of Supabase's auth callback before invoking another auth-backed RPC.
      void Promise.resolve().then(() => currentOwner(task!)).then((next) => {
        if (active && attempt === generation) setOwner(next);
      }).catch((error: unknown) => {
        if (active && attempt === generation) {
          setAuthorityError(
            logRoundingQueryFailure(
              "rounding.quick_check.authority",
              error,
              "Your session could not be confirmed. Sign in again to record a check.",
            ),
          );
        }
      });
    }
    resolveOwner();
    const { data: { subscription } } = createClient().auth.onAuthStateChange((event) => {
      if (event !== "TOKEN_REFRESHED" && event !== "INITIAL_SESSION") resolveOwner();
    });
    return () => { active = false; subscription.unsubscribe(); };
    // Task object refreshes must not reset an observation or its form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope, persistCompletion]);
  if (!open || !task) return null;
  if (persistCompletion && (!owner || owner.organizationId !== task.organizationId || owner.facilityId !== task.facilityId)) {
    return <div role="status">{authorityError ?? "Checking account authorization…"} <button onClick={props.onClose}>Close</button></div>;
  }
  return <ScopedQuickCheckDrawer {...props} key={`${owner ? ownerKey(owner) : "preview"}:${task.id}`} owner={owner} />;
}

function ScopedQuickCheckDrawer({
  task,
  open,
  onClose,
  onCompleted,
  queuePosition,
  onNextTask,
  persistCompletion = true,
  owner,
}: QuickCheckDrawerProps & { owner: RetryOwner | null }) {
  const key = `${owner ? ownerKey(owner) : "preview"}:${task!.id}`;
  const pending = useSyncExternalStore(subscribePending, () => pendingChecks.get(key), () => undefined);
  const acknowledged = useSyncExternalStore(subscribePending, () => acknowledgedChecks.has(key), () => false);
  const activeRef = useRef(true);
  useEffect(() => { activeRef.current = true; return () => { activeRef.current = false; }; }, []);
  const reasonRequired = pending?.reasonRequired ?? false;
  const submitting = pending?.busy ?? false;
  const [previewCompleted, setPreviewCompleted] = useState(false);
  const justCompleted = previewCompleted || acknowledged;
  const completionNotified = useRef(false);
  const completionAdvance = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (justCompleted && task && !completionNotified.current) {
      completionNotified.current = true;
      // onCompleted can remove this task from the parent's queue immediately.
      // Preserve that queue's next resident before notifying the board.
      completionAdvance.current = onNextTask && queuePosition && queuePosition.current < queuePosition.total ? onNextTask : null;
      onCompleted(task.id);
    }
  }, [justCompleted, task, onCompleted, onNextTask, queuePosition]);
  useEffect(() => {
    if (!justCompleted || !completionAdvance.current) return;
    const advance = completionAdvance.current;
    const timer = setTimeout(() => { if (activeRef.current) advance(); }, 800);
    return () => clearTimeout(timer);
  }, [justCompleted]);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = "qc-drawer-title";
  useEffect(() => {
    if (open) requestAnimationFrame(() => panelRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);

  /** Portal + scroll lock: fixed inside admin `main` can pick up the wrong containing block and clip content. */
  useLayoutEffect(() => {
    if (!open || typeof document === "undefined") return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  async function submitCheck(capture: CompletionPayload) {
    if (!task || submitting) return;
    setError(null);
    const previous = pendingChecks.get(key);
    if (previous?.busy) return;
    const payload: CompletionPayload = previous ? {
      ...previous.payload,
      // Only the server's explicit unsaved late-reason rejection allows amendment.
      ...(previous.reasonRequired ? { lateReason: capture.lateReason ?? null } : {}),
    } : {
      requestId: crypto.randomUUID(),
      observedAt: new Date().toISOString(),
      ...(owner ? { retryOwner: owner } : {}),
      ...capture,
    };

    const completeLocally = !persistCompletion;
    let reasonMayChange = false;

    try {
      if (completeLocally) {
        setPreviewCompleted(true);
        return;
      }

      updatePending(key, { payload, busy: true, reasonRequired: false, error: null });
      if (!owner || ownerKey(await currentOwner(task)) !== ownerKey(owner)) {
        throw new Error("The account or session changed. Sign in as the original operator to retry this observation.");
      }
      if (!activeRef.current) {
        throw new Error("Observation retained. Reopen this check to retry.");
      }
      const res = await fetch(`/api/rounding/tasks/${task.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { error?: string; ok?: boolean; reasonRequired?: boolean };
      if (!res.ok) {
        reasonMayChange = res.status === 400 && json.reasonRequired === true;
        throw new Error(json.error ?? "Could not complete check");
      }

      if (json.ok !== true) throw new Error("Save acknowledgment was incomplete. Retry the original observation.");
      // Keep only the acknowledgment identity after discarding clinical details.
      // A remounted drawer consumes this success instead of creating a new UUID.
      acknowledgedChecks.add(key);
      updatePending(key, null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save. Try again.";
      if (persistCompletion) updatePending(key, { payload, busy: false, reasonRequired: reasonMayChange, error: message });
      else setError(message);
    }
  }


  if (!open) return null;

  if (typeof document === "undefined") return null;

  const portal = (
    <>
      <div
        className="fixed inset-0 z-[100] bg-foreground/60  transition-opacity"
        onClick={onClose}
        aria-hidden
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "fixed bottom-0 left-0 right-0 z-[110] box-border max-h-[92vh] w-full min-w-0 overflow-y-auto overflow-x-hidden rounded-t-2xl border-t border-border bg-background",
          "shadow-2xl",
          "pb-[env(safe-area-inset-bottom,0px)] animate-in slide-in-from-bottom-8 duration-300",
        )}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex min-w-0 items-center justify-between gap-3 border-b border-border bg-background  px-3 py-4 sm:px-5">
          <div className="min-w-0 flex-1">
            {task && (
              <>
                <div className="flex items-center gap-2">
                  <h2 id={titleId} className="text-lg font-semibold text-foreground truncate">{task.residentName}</h2>
                  {task.roomLabel && (
                    <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                      {task.roomLabel}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Due {Number.isNaN(new Date(task.dueAt).getTime()) ? "time unavailable" : new Date(task.dueAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {queuePosition && (
                    <span className="ml-2 text-foreground">{queuePosition.current} of {queuePosition.total}</span>
                  )}
                </p>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {task && !persistCompletion && !justCompleted && (
          <div className="border-b border-border bg-muted px-3 py-2 text-center text-[11px] text-muted-foreground sm:px-5">
            Preview mode — checks are not saved to the database.
          </div>
        )}

        {justCompleted ? (
          <div className="flex flex-col items-center justify-center gap-4 px-4 py-16 sm:px-6">
            <div className="rounded-full bg-muted p-4">
              <CheckCircle2 className="h-12 w-12 text-foreground" />
            </div>
            <p className="text-lg font-semibold text-foreground">
              {persistCompletion ? "Check complete" : "Preview complete — not saved"}
            </p>
            {onNextTask && queuePosition && queuePosition.current < queuePosition.total && (
              <p className="text-sm text-muted-foreground">Advancing to next resident...</p>
            )}
            {(!onNextTask || !queuePosition || queuePosition.current >= queuePosition.total) && (
              <div className="flex gap-3 mt-2">
                <button
                  onClick={onClose}
                  className="rounded-xl bg-secondary px-6 py-3 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-colors"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="min-w-0 space-y-5 px-3 py-4 sm:px-5">
            {(pending?.error || error) && (
              <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {pending?.error || error}
              </div>
            )}

            <ObservationCapture
              residentName={task!.residentName}
              dueLabel={`Due ${new Date(task!.dueAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
              facilityId={task!.facilityId}
              submitting={submitting}
              pendingPayload={pending?.payload}
              reasonRequired={reasonRequired}
              onSubmit={submitCheck}
            />

            {/* Spacer for safe area on mobile */}
            <div className="h-4" />
          </div>
        )}
      </div>
    </>
  );

  return createPortal(portal, document.body);
}
