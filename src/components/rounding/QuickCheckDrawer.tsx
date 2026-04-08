"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  ChevronRight,
  Loader2,
  X,
  AlertTriangle,
  Droplets,
  ShieldAlert,
  Bath,
  RotateCw,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { CompletionPayload, ObservationQuickStatus, ObservationExceptionType } from "@/lib/rounding/types";

export type QuickCheckTask = {
  id: string;
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
};

const QUICK_STATUSES: { value: ObservationQuickStatus; label: string; emoji: string; color: string }[] = [
  { value: "awake", label: "Awake", emoji: "👁", color: "border-emerald-500 bg-emerald-950/50 text-emerald-200" },
  { value: "asleep", label: "Asleep", emoji: "😴", color: "border-blue-500 bg-blue-950/50 text-blue-200" },
  { value: "calm", label: "Calm", emoji: "✓", color: "border-emerald-500 bg-emerald-950/50 text-emerald-200" },
  { value: "agitated", label: "Agitated", emoji: "⚠", color: "border-amber-500 bg-amber-950/50 text-amber-200" },
  { value: "confused", label: "Confused", emoji: "?", color: "border-amber-500 bg-amber-950/50 text-amber-200" },
  { value: "distressed", label: "Distressed", emoji: "!", color: "border-rose-500 bg-rose-950/50 text-rose-200" },
  { value: "not_found", label: "Not found", emoji: "✕", color: "border-rose-500 bg-rose-950/50 text-rose-200" },
  { value: "refused", label: "Refused", emoji: "—", color: "border-rose-500 bg-rose-950/50 text-rose-200" },
];

const LOCATIONS = ["in room", "common area", "out of room", "off unit", "appointment"] as const;
const POSITIONS = ["in bed", "in chair", "ambulating", "with staff"] as const;

const EXCEPTION_OPTIONS: { value: ObservationExceptionType; label: string }[] = [
  { value: "resident_not_found", label: "Resident not found" },
  { value: "resident_declined_interaction", label: "Declined interaction" },
  { value: "resident_appears_ill", label: "Appears ill" },
  { value: "resident_appears_injured", label: "Appears injured" },
  { value: "environmental_hazard_present", label: "Environmental hazard" },
  { value: "family_concern_reported", label: "Family concern" },
  { value: "other", label: "Other" },
];

function isAbnormal(status: ObservationQuickStatus) {
  return status === "agitated" || status === "confused" || status === "distressed" || status === "not_found" || status === "refused";
}

export function QuickCheckDrawer({ task, open, onClose, onCompleted, queuePosition, onNextTask }: QuickCheckDrawerProps) {
  const [quickStatus, setQuickStatus] = useState<ObservationQuickStatus>("awake");
  const [location, setLocation] = useState<string>("in room");
  const [position, setPosition] = useState<string>("in bed");
  const [hydration, setHydration] = useState(false);
  const [toileting, setToileting] = useState(false);
  const [repositioned, setRepositioned] = useState(false);
  const [fallHazard, setFallHazard] = useState(false);
  const [exceptionType, setExceptionType] = useState<ObservationExceptionType | "">("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = "qc-drawer-title";

  const resetForm = useCallback(() => {
    setQuickStatus("awake");
    setLocation("in room");
    setPosition("in bed");
    setHydration(false);
    setToileting(false);
    setRepositioned(false);
    setFallHazard(false);
    setExceptionType("");
    setNote("");
    setError(null);
    setJustCompleted(false);
  }, []);

  useEffect(() => {
    if (open && task) {
      resetForm();
      requestAnimationFrame(() => panelRef.current?.focus());
    }
  }, [open, task, resetForm]);

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

  async function submitCheck() {
    if (!task) return;
    setSubmitting(true);
    setError(null);

    const payload: CompletionPayload = {
      quickStatus,
      residentLocation: location,
      residentPosition: position,
      hydrationOffered: hydration,
      toiletingAssisted: toileting,
      repositioned,
      fallHazardObserved: fallHazard,
      distressPresent: quickStatus === "distressed",
      refusedAssistance: quickStatus === "refused",
      exceptionType: exceptionType || null,
      note: note.trim() || null,
    };

    try {
      const res = await fetch(`/api/rounding/tasks/${task.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok) throw new Error(json.error ?? "Could not complete check");

      setJustCompleted(true);
      onCompleted(task.id);

      if (onNextTask && queuePosition && queuePosition.current < queuePosition.total) {
        setTimeout(() => {
          onNextTask();
        }, 800);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const showDetails = isAbnormal(quickStatus) || fallHazard || !!exceptionType;

  if (!open) return null;

  if (typeof document === "undefined") return null;

  const portal = (
    <>
      <div
        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm transition-opacity"
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
          "fixed bottom-0 left-0 right-0 z-[110] box-border max-h-[92vh] w-full min-w-0 overflow-y-auto overflow-x-hidden rounded-t-2xl border-t border-slate-700/50",
          "bg-gradient-to-b from-slate-900 to-slate-950 shadow-2xl shadow-black/50",
          "pb-[env(safe-area-inset-bottom,0px)] animate-in slide-in-from-bottom-8 duration-300",
        )}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex min-w-0 items-center justify-between gap-3 border-b border-white/5 bg-slate-900/95 backdrop-blur-md px-3 py-4 sm:px-5">
          <div className="min-w-0 flex-1">
            {task && (
              <>
                <div className="flex items-center gap-2">
                  <h2 id={titleId} className="text-lg font-display font-semibold text-slate-100 truncate">{task.residentName}</h2>
                  {task.roomLabel && (
                    <span className="text-[10px] font-mono tracking-wider text-slate-500 bg-slate-800/50 px-1.5 py-0.5 rounded shrink-0">
                      {task.roomLabel}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Due {Number.isNaN(new Date(task.dueAt).getTime()) ? "time unavailable" : new Date(task.dueAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {queuePosition && (
                    <span className="ml-2 text-cyan-400">{queuePosition.current} of {queuePosition.total}</span>
                  )}
                </p>
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {justCompleted ? (
          <div className="flex flex-col items-center justify-center gap-4 px-4 py-16 sm:px-6">
            <div className="rounded-full bg-emerald-500/20 p-4">
              <CheckCircle2 className="h-12 w-12 text-emerald-400" />
            </div>
            <p className="text-lg font-display font-semibold text-emerald-300">Check complete</p>
            {onNextTask && queuePosition && queuePosition.current < queuePosition.total && (
              <p className="text-sm text-slate-400">Advancing to next resident...</p>
            )}
            {(!onNextTask || !queuePosition || queuePosition.current >= queuePosition.total) && (
              <div className="flex gap-3 mt-2">
                <button
                  onClick={onClose}
                  className="rounded-xl bg-slate-800 px-6 py-3 text-sm font-medium text-slate-200 hover:bg-slate-700 transition-colors"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="min-w-0 space-y-5 px-3 py-4 sm:px-5">
            {error && (
              <div role="alert" className="flex items-center gap-2 rounded-lg border border-rose-700/50 bg-rose-950/30 px-3 py-2 text-sm text-rose-200">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {/* Step 1: Quick Status — the most important tap */}
            <div className="min-w-0">
              <label className="mb-2 block text-[10px] font-mono uppercase tracking-widest text-slate-500">Status</label>
              <div
                role="radiogroup"
                aria-label="Quick status"
                className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 [&>*]:min-w-0"
              >
                {QUICK_STATUSES.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={quickStatus === opt.value}
                    onClick={() => setQuickStatus(opt.value)}
                    className={cn(
                      "flex min-w-0 flex-col items-center gap-1 rounded-xl border px-1.5 py-2.5 text-[11px] font-medium transition-all duration-150 sm:px-2 sm:py-3 sm:text-xs",
                      quickStatus === opt.value
                        ? opt.color
                        : "border-slate-700/50 bg-slate-900/50 text-slate-400 hover:bg-slate-800/50 hover:text-slate-200",
                    )}
                  >
                    <span className="text-base leading-none">{opt.emoji}</span>
                    <span className="text-center leading-tight break-words">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Step 2: Location + Position — two taps */}
            <div className="grid min-w-0 grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-3">
              <div className="min-w-0">
                <label className="mb-2 block text-[10px] font-mono uppercase tracking-widest text-slate-500">Location</label>
                <div className="flex min-w-0 flex-wrap gap-1.5">
                  {LOCATIONS.map((loc) => (
                    <button
                      key={loc}
                      type="button"
                      onClick={() => setLocation(loc)}
                      className={cn(
                        "max-w-full shrink-0 rounded-lg border px-2 py-1.5 text-left text-xs font-medium transition-all sm:px-2.5",
                        location === loc
                          ? "border-cyan-500 bg-cyan-950/50 text-cyan-200"
                          : "border-slate-700/50 bg-slate-900/50 text-slate-400 hover:text-slate-200",
                      )}
                    >
                      {loc}
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-w-0">
                <label className="mb-2 block text-[10px] font-mono uppercase tracking-widest text-slate-500">Position</label>
                <div className="flex min-w-0 flex-wrap gap-1.5">
                  {POSITIONS.map((pos) => (
                    <button
                      key={pos}
                      type="button"
                      onClick={() => setPosition(pos)}
                      className={cn(
                        "max-w-full shrink-0 rounded-lg border px-2 py-1.5 text-left text-xs font-medium transition-all sm:px-2.5",
                        position === pos
                          ? "border-cyan-500 bg-cyan-950/50 text-cyan-200"
                          : "border-slate-700/50 bg-slate-900/50 text-slate-400 hover:text-slate-200",
                      )}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick intervention toggles — always visible */}
            <div className="min-w-0">
              <label className="mb-2 block text-[10px] font-mono uppercase tracking-widest text-slate-500">Interventions</label>
              <div className="grid min-w-0 grid-cols-1 gap-2 min-[400px]:grid-cols-2">
                <InterventionToggle icon={<Droplets className="h-3.5 w-3.5" />} label="Hydration offered" checked={hydration} onChange={setHydration} />
                <InterventionToggle icon={<Bath className="h-3.5 w-3.5" />} label="Toileting assisted" checked={toileting} onChange={setToileting} />
                <InterventionToggle icon={<RotateCw className="h-3.5 w-3.5" />} label="Repositioned" checked={repositioned} onChange={setRepositioned} />
                <InterventionToggle icon={<ShieldAlert className="h-3.5 w-3.5" />} label="Fall hazard" checked={fallHazard} onChange={setFallHazard} activeColor="rose" />
              </div>
            </div>

            {/* Expanded detail section — only when abnormal */}
            {showDetails && (
              <div className="min-w-0 space-y-3 rounded-xl border border-amber-700/30 bg-amber-950/10 p-3 sm:p-4">
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Requires detail
                </div>

                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1.5 block">Exception type</label>
                  <div className="flex min-w-0 flex-wrap gap-1.5">
                    {EXCEPTION_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setExceptionType(exceptionType === opt.value ? "" : opt.value)}
                        className={cn(
                          "max-w-full rounded-lg border px-2 py-1.5 text-left text-xs font-medium transition-all sm:px-2.5",
                          exceptionType === opt.value
                            ? "border-amber-500 bg-amber-950/50 text-amber-200"
                            : "border-slate-700/50 bg-slate-900/50 text-slate-400 hover:text-slate-200",
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1.5 block">Note</label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
                    placeholder="Describe the situation..."
                  />
                </div>
              </div>
            )}

            {/* SUBMIT — the big green button */}
            <button
              type="button"
              onClick={() => void submitCheck()}
              disabled={submitting}
              className={cn(
                "w-full rounded-xl py-4 text-base font-semibold transition-all duration-200",
                "bg-gradient-to-r from-emerald-600 to-emerald-500 text-white",
                "hover:from-emerald-500 hover:to-emerald-400 active:scale-[0.98]",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "shadow-lg shadow-emerald-900/30",
              )}
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Saving...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <CheckCircle2 className="h-5 w-5" />
                  Complete Check
                  {onNextTask && queuePosition && queuePosition.current < queuePosition.total && (
                    <ChevronRight className="h-4 w-4 ml-1 opacity-60" />
                  )}
                </span>
              )}
            </button>

            {/* Spacer for safe area on mobile */}
            <div className="h-4" />
          </div>
        )}
      </div>
    </>
  );

  return createPortal(portal, document.body);
}

function InterventionToggle({
  icon,
  label,
  checked,
  onChange,
  activeColor = "emerald",
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  activeColor?: "emerald" | "rose";
}) {
  const activeClass = activeColor === "rose"
    ? "border-rose-500 bg-rose-950/50 text-rose-200"
    : "border-emerald-500 bg-emerald-950/50 text-emerald-200";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex min-h-[2.75rem] min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2.5 text-left text-xs font-medium transition-all sm:px-3",
        checked ? activeClass : "border-slate-700/50 bg-slate-900/50 text-slate-400 hover:text-slate-200",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
