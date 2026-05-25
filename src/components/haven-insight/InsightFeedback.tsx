"use client";

import { useCallback, useMemo, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type FeedbackValue = "positive" | "negative" | null;

type InsightFeedbackProps =
  | { messageId: string; sessionId?: never }
  | { messageId?: never; sessionId: string };

/**
 * Tri-state thumbs for Haven Insight answers. Threaded NLQ messages write
 * per-message feedback through `set_nlq_message_feedback`; the legacy
 * one-shot panel may still pass a session id until it emits message ids.
 */
export function InsightFeedback({ messageId, sessionId }: InsightFeedbackProps) {
  const supabase = useMemo(() => createClient(), []);
  const [value, setValue] = useState<FeedbackValue>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (next: Exclude<FeedbackValue, null>) => {
      const newVal = value === next ? null : next;
      setError(null);

      const { error: uErr } = messageId
        ? await supabase.rpc("set_nlq_message_feedback" as never, {
          p_message_id: messageId,
          p_feedback: newVal,
        } as never)
        : await supabase
          .from("exec_nlq_sessions" as never)
          .update({ feedback: newVal, feedback_at: new Date().toISOString() } as never)
          .eq("id" as never, sessionId as never);

      if (uErr) {
        setError(uErr.message);
        return;
      }
      setValue(newVal);
    },
    [messageId, sessionId, supabase, value],
  );

  return (
    <div className="mt-2 flex items-center gap-1 border-t border-border pt-1.5">
      <button
        type="button"
        onClick={() => void submit("positive")}
        className={cn(
          "rounded p-1 transition-colors",
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
          "rounded p-1 transition-colors",
          value === "negative" ? "text-rose-600" : "text-muted-foreground hover:text-foreground",
        )}
        aria-label="Mark answer unhelpful"
      >
        <ThumbsDown className="size-3" />
      </button>
      {error ? <span className="text-[9px] text-amber-600">{error}</span> : null}
    </div>
  );
}
