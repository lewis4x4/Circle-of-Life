"use client";

import { useCallback, useMemo, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type FeedbackValue = "positive" | "negative" | null;

type InsightFeedbackProps = {
  messageId?: string;
  /** Deprecated caller shape; ignored so feedback is never written at session scope. */
  sessionId?: string;
};

/**
 * Tri-state thumbs for Haven Insight answers. Feedback is recorded per message;
 * callers must provide the persisted NLQ message id.
 */
export function InsightFeedback({ messageId }: InsightFeedbackProps) {
  const supabase = useMemo(() => createClient(), []);
  const [value, setValue] = useState<FeedbackValue>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (next: Exclude<FeedbackValue, null>) => {
      const newVal = value === next ? null : next;
      setError(null);

      if (!messageId) return;

      const { error: uErr } = await supabase.rpc("set_nlq_message_feedback" as never, {
        p_message_id: messageId,
        p_feedback: newVal,
      } as never);

      if (uErr) {
        setError(uErr.message);
        return;
      }
      setValue(newVal);
    },
    [messageId, supabase, value],
  );

  if (!messageId) return null;

  return (
    <div className="mt-2 flex items-center gap-1 border-t border-border pt-1.5">
      <button
        type="button"
        onClick={() => void submit("positive")}
        className={cn(
          "rounded p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          value === "positive" ? "text-emerald-600" : "text-muted-foreground hover:text-foreground",
        )}
        aria-label="Mark answer helpful"
      >
        <ThumbsUp className="size-3" />
      </button>
      <button
        type="button"
        onClick={() => void submit("negative")}
        className={cn(
          "rounded p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          value === "negative" ? "text-rose-600" : "text-muted-foreground hover:text-foreground",
        )}
        aria-label="Mark answer unhelpful"
      >
        <ThumbsDown className="size-3" />
      </button>
      {error ? <span role="alert" className="text-[12px] text-destructive">{error}</span> : null}
    </div>
  );
}
