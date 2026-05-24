"use client";

import { useCallback, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * KB-NEXT-10: tri-state thumbs writing to exec_nlq_sessions.feedback. Only
 * render for assistant messages whose id is the session UUID (returned by
 * haven-ai-router as `session_id`). Locally generated errors / streaming
 * stubs get string ids like "e-…", "a-…", so callers can use the UUID-length
 * heuristic to filter them out without a separate flag.
 */
export function InsightFeedback({ sessionId }: { sessionId: string }) {
  const [value, setValue] = useState<"positive" | "negative" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (next: "positive" | "negative") => {
      const supabase = createClient();
      const newVal = value === next ? null : next;
      setError(null);
      const { error: uErr } = await supabase
        .from("exec_nlq_sessions" as never)
        .update({ feedback: newVal, feedback_at: new Date().toISOString() } as never)
        .eq("id" as never, sessionId as never);
      if (uErr) {
        setError(uErr.message);
        return;
      }
      setValue(newVal);
    },
    [sessionId, value],
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
