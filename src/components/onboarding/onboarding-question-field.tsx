"use client";

import type { ConfidenceLevel, OnboardingQuestion } from "@/lib/onboarding/types";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const textAreaClassName =
  "min-h-[120px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base text-slate-100 outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

interface Props {
  question: OnboardingQuestion;
  value: string;
  confidence: ConfidenceLevel;
  enteredByName: string;
  /** Show internal ids / answer types (owner / org_admin only). */
  showAdminMeta?: boolean;
  showConfidence?: boolean;
  onValueChange: (v: string) => void;
  onConfidenceChange: (c: ConfidenceLevel) => void;
  onEnteredByChange: (v: string) => void;
}

const CONFIDENCE: { value: ConfidenceLevel; label: string }[] = [
  { value: "confirmed", label: "Confirmed" },
  { value: "best_known", label: "Best known" },
  { value: "needs_review", label: "Needs review" },
];

export function OnboardingQuestionField({
  question,
  value,
  confidence,
  enteredByName,
  showAdminMeta = false,
  showConfidence = false,
  onValueChange,
  onConfidenceChange,
  onEnteredByChange,
}: Props) {
  const labelId = `q-${question.id}-prompt`;

  const control = (() => {
    switch (question.answerType) {
      case "long_text":
        return (
          <textarea
            id={labelId}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            rows={5}
            className={cn(textAreaClassName, "border-white/15 bg-black/30 placeholder:text-slate-600")}
            placeholder="Type the answer…"
          />
        );
      case "short_text":
        return (
          <Input
            id={labelId}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            className="border-white/15 bg-black/30 text-slate-100"
            placeholder="Short answer…"
          />
        );
      case "number":
        return (
          <Input
            id={labelId}
            type="number"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            className="border-white/15 bg-black/30 text-slate-100"
          />
        );
      case "date":
        return (
          <Input
            id={labelId}
            type="date"
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            className="w-full max-w-xs border-white/15 bg-black/30 text-slate-100"
          />
        );
      case "yes_no":
        return (
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby={labelId}>
            {(["Yes", "No"] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => onValueChange(opt)}
                className={cn(
                  "rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                  value === opt
                    ? "border-teal-400 bg-teal-500/20 text-teal-100"
                    : "border-white/15 bg-white/5 text-slate-300 hover:bg-white/10",
                )}
              >
                {opt}
              </button>
            ))}
          </div>
        );
      case "single_select":
        return (
          <select
            id={labelId}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            className="w-full max-w-md rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm text-slate-100"
          >
            <option value="">Select…</option>
            {(question.options ?? []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
      case "multi_select":
        return (
          <textarea
            id={labelId}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            rows={4}
            className={cn(textAreaClassName, "border-white/15 bg-black/30 placeholder:text-slate-600")}
            placeholder="One option per line (or comma-separated)."
          />
        );
      default:
        return (
          <textarea
            id={labelId}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            rows={4}
            className={cn(textAreaClassName, "border-white/15 bg-black/30")}
          />
        );
    }
  })();

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p id={labelId} className="text-base font-semibold text-slate-100">
            {question.prompt}
          </p>
          {question.assignedTo ? (
            <span className="shrink-0 rounded-md border border-white/20 bg-white/5 px-2 py-0.5 text-xs font-medium text-slate-200">
              Assigned: {question.assignedTo}
            </span>
          ) : null}
        </div>
        {question.helpText ? (
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            <span className="font-medium text-slate-300">Why this matters: </span>
            {question.helpText}
          </p>
        ) : null}
        {showAdminMeta ? (
          <p className="mt-2 text-xs text-slate-500">
            id: <code className="text-slate-400">{question.id}</code> · {question.answerType}
            {question.category ? ` · ${question.category}` : ""}
          </p>
        ) : null}
      </div>

      {control}

      <div className={cn("grid gap-3", showConfidence ? "sm:grid-cols-2" : "sm:grid-cols-1")}>
        {showConfidence ? (
          <label className="block text-xs font-medium text-slate-400">
            Confidence
            <select
              value={confidence}
              onChange={(e) => onConfidenceChange(e.target.value as ConfidenceLevel)}
              className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-2 py-1.5 text-sm text-slate-100"
            >
              {CONFIDENCE.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="block text-xs font-medium text-slate-400">
          Your name (for this answer)
          <Input
            value={enteredByName}
            onChange={(e) => onEnteredByChange(e.target.value)}
            className="mt-1 border-white/15 bg-black/30 text-slate-100"
            placeholder="Name or role"
          />
        </label>
      </div>
    </div>
  );
}
