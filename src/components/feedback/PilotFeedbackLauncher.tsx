"use client";

import { useMemo, useState } from "react";
import { Flag, Loader2, MessageSquareWarning, Send } from "lucide-react";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type FeedbackCategory = "bug" | "confusion" | "request" | "friction" | "praise";
type FeedbackSeverity = "low" | "medium" | "high" | "critical";

type PilotFeedbackLauncherProps = {
  shellKind: "admin" | "caregiver" | "family" | "med-tech";
  facilityId?: string | null;
  compact?: boolean;
};

const CATEGORY_OPTIONS: Array<{ value: FeedbackCategory; label: string }> = [
  { value: "bug", label: "Bug" },
  { value: "confusion", label: "Confusing" },
  { value: "friction", label: "Too much friction" },
  { value: "request", label: "Feature request" },
  { value: "praise", label: "What works well" },
];

const SEVERITY_OPTIONS: Array<{ value: FeedbackSeverity; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];

export function PilotFeedbackLauncher({
  shellKind,
  facilityId = null,
  compact = false,
}: PilotFeedbackLauncherProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("friction");
  const [severity, setSeverity] = useState<FeedbackSeverity>("medium");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const defaultTitle = useMemo(() => {
    return shellKind === "family"
      ? "Family experience feedback"
      : shellKind === "caregiver"
        ? "Caregiver workflow feedback"
        : shellKind === "med-tech"
          ? "Med-tech workflow feedback"
          : "Admin workflow feedback";
  }, [shellKind]);

  const reset = () => {
    setCategory("friction");
    setSeverity("medium");
    setTitle("");
    setDetail("");
    setError(null);
  };

  const submit = async () => {
    const finalTitle = title.trim() || defaultTitle;
    if (!detail.trim()) {
      setError("Describe what happened or what should change.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/pilot-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facilityId,
          shellKind,
          route: pathname,
          category,
          severity,
          title: finalTitle,
          detail: detail.trim(),
        }),
        credentials: "same-origin",
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? `Request failed (${res.status})`);
      }
      setSuccess("Feedback submitted. It is now in the pilot review inbox.");
      reset();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not submit feedback");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={compact ? "ghost" : "outline"}
        size={compact ? "icon-sm" : "sm"}
        className={compact ? "" : "rounded-xl"}
        onClick={() => setOpen(true)}
      >
        {compact ? <Flag className="h-4 w-4" /> : <><MessageSquareWarning className="mr-2 h-4 w-4" />Feedback</>}
      </Button>

      <Dialog open={open} onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setSuccess(null);
        }
      }}>
        <DialogContent className="max-w-xl rounded-[1.5rem] border border-slate-200 dark:border-white/10 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle>Pilot Feedback</DialogTitle>
            <DialogDescription>
              Capture what is confusing, broken, missing, or working well on this exact screen.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700 dark:text-zinc-200">Category</span>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value as FeedbackCategory)}
                  className="h-11 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/30 px-3 text-sm"
                >
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-sm">
                <span className="font-medium text-slate-700 dark:text-zinc-200">Severity</span>
                <select
                  value={severity}
                  onChange={(event) => setSeverity(event.target.value as FeedbackSeverity)}
                  className="h-11 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/30 px-3 text-sm"
                >
                  {SEVERITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-zinc-200">Short title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={defaultTitle}
                className="h-11 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/30 px-3 text-sm"
              />
            </label>

            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700 dark:text-zinc-200">What happened or what should change?</span>
              <textarea
                rows={5}
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
                placeholder="Be specific. Mention what you expected, what actually happened, and why it matters."
                className="min-h-32 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/30 px-3 py-3 text-sm"
              />
            </label>

            <div className="rounded-xl border border-slate-200/80 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] px-4 py-3 text-xs text-slate-500 dark:text-zinc-400">
              <div>Route: <span className="font-mono">{pathname}</span></div>
              <div>Shell: <span className="font-mono">{shellKind}</span></div>
              <div>Facility: <span className="font-mono">{facilityId ?? "none selected"}</span></div>
            </div>

            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </div>
            ) : null}

            {success ? (
              <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
                {success}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              Close
            </Button>
            <Button type="button" onClick={() => void submit()} disabled={submitting}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Submit feedback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
