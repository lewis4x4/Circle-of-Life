"use client";

import { useCallback, useId, useState } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";

import type { CheckVerdict, CheckVerdicts } from "@/lib/document-intake/contracts";
import { cn } from "@/lib/utils";

import { CHECK_VERDICT_OPTIONS } from "./model";

/**
 * Right / Wrong / Can't tell for one flagged Jev check (migration 559).
 * Starts empty: a verdict is the reviewer's, never pre-selected. Arrow keys
 * move between options (radio group semantics); the group is named by the
 * visible question plus the check it grades.
 */
export function JevVerdictControl({
  checkLabel,
  value,
  onChange,
  disabled = false,
}: {
  checkLabel: string;
  value: CheckVerdict | null;
  onChange: (verdict: CheckVerdict) => void;
  disabled?: boolean;
}) {
  const questionId = useId();
  const checkId = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span id={questionId} className="text-xs font-semibold text-muted-foreground">
        Was Jev right?
      </span>
      <span id={checkId} className="sr-only">
        {checkLabel}
      </span>
      <RadioGroup<CheckVerdict | null>
        value={value}
        onValueChange={(next) => {
          if (next) onChange(next);
        }}
        disabled={disabled}
        aria-labelledby={`${questionId} ${checkId}`}
        className="inline-flex gap-1 rounded-lg bg-muted/40 p-1"
      >
        {CHECK_VERDICT_OPTIONS.map((option) => (
          <Radio.Root
            key={option.value}
            value={option.value}
            className={cn(
              "inline-flex min-h-11 min-w-20 cursor-pointer select-none items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground",
              "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "data-[checked]:bg-card data-[checked]:text-foreground data-[checked]:shadow-sm data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60",
            )}
          >
            {option.label}
          </Radio.Root>
        ))}
      </RadioGroup>
    </div>
  );
}

/** Verdicts belong to one proposal: a new suggestion starts them empty again. */
export function useCheckVerdicts(proposalId: string | null): [CheckVerdicts, (code: string, verdict: CheckVerdict) => void] {
  const [state, setState] = useState<{ proposalId: string | null; values: CheckVerdicts }>({ proposalId: null, values: {} });
  const setVerdict = useCallback(
    (code: string, verdict: CheckVerdict) =>
      setState((prior) => ({ proposalId, values: { ...(prior.proposalId === proposalId ? prior.values : {}), [code]: verdict } })),
    [proposalId],
  );
  return [state.proposalId === proposalId ? state.values : {}, setVerdict];
}
