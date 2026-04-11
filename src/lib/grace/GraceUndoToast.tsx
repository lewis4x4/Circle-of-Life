"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { graceUndoFlowRun } from "./api";
import { useGraceStore } from "./store";

export function GraceUndoToast() {
  const { state, dismissUndoToast, setError } = useGraceStore();
  const toast = state.undoToast;
  const [undoing, setUndoing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [toast]);

  useEffect(() => {
    if (toast && now >= toast.expires_at) {
      dismissUndoToast();
    }
  }, [dismissUndoToast, now, toast]);

  useEffect(() => {
    setLocalError(null);
  }, [toast]);

  const secondsLeft = useMemo(() => {
    if (!toast) return 0;
    return Math.max(0, Math.ceil((toast.expires_at - now) / 1000));
  }, [now, toast]);

  if (!toast) return null;

  return (
    <div className="fixed bottom-6 left-1/2 z-[9996] w-[min(92vw,560px)] -translate-x-1/2 rounded-2xl border border-border bg-background/95 p-4 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold">{toast.flow_label} completed</div>
          <div className="text-xs text-muted-foreground">
            Undo available for {secondsLeft}s.
          </div>
          {localError ? <div className="mt-2 text-xs text-rose-600 dark:text-rose-300">{localError}</div> : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={dismissUndoToast}>
            Dismiss
          </Button>
          <Button
            disabled={undoing || secondsLeft === 0}
            onClick={async () => {
              setUndoing(true);
              try {
                await graceUndoFlowRun({ run_id: toast.run_id });
                dismissUndoToast();
              } catch (error) {
                const message = error instanceof Error ? error.message : "Grace undo failed";
                setLocalError(message);
                setError(message);
              } finally {
                setUndoing(false);
              }
            }}
          >
            {undoing ? "Undoing..." : "Undo"}
          </Button>
        </div>
      </div>
    </div>
  );
}
