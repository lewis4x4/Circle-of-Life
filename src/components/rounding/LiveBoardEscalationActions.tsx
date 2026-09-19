"use client";

/**
 * Escalation disposition, on the check it belongs to. Spec 25A defect 9.
 *
 * Escalations were a destination tab. The Quiet Operator constitution rejects a
 * workflow rendered as a destination, and an escalation is not a place: it is a
 * state one check is in. So the board gained an Escalated filter and the
 * acknowledge-and-resolve workflow moved onto the row, which is also where the
 * operator can see the resident, the window and the assigned staff member
 * without navigating.
 *
 * The command is unchanged: `PATCH /api/rounding/escalations/[id]` still gates
 * on the manager roles and still holds the resolution rationale minimum. This
 * component only asks it.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatEscalationTimestamp } from "@/lib/rounding/rounding-timestamps";
import { liveBoardRungLabel } from "@/lib/rounding/live-board-display-copy";
import type { LiveBoardEscalationRow } from "@/lib/rounding/live-board-fetch";

export function LiveBoardEscalationActions({
  escalations,
  onDone,
}: {
  escalations: readonly LiveBoardEscalationRow[];
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  if (escalations.length === 0) return null;

  // The command owns how long a resolution rationale has to be and answers
  // with its own sentence when it is too short. This form only knows that
  // resolving without writing anything is not a thing.
  const noteEmpty = note.trim().length === 0;

  async function run(escalationId: string, action: "start_review" | "resolve") {
    setBusy(`${escalationId}:${action}`);
    setProblem(null);
    try {
      const response = await fetch(`/api/rounding/escalations/${escalationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: note.trim() || undefined }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setProblem(payload?.error ?? "This escalation could not be updated. Try again.");
        return;
      }
      setNote("");
      onDone();
    } catch {
      setProblem("This escalation could not be updated. Check the connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <ul className="space-y-1.5" aria-label="Escalations on this check">
        {escalations.map((escalation) => (
          <li
            key={escalation.id}
            className="flex flex-col gap-2 text-[12px] sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="min-w-0 text-foreground">
              <span className="font-medium">{liveBoardRungLabel(escalation.rung_key)}</span>
              <span aria-hidden className="px-1.5 text-border">
                ·
              </span>
              <span className="text-muted-foreground">
                {escalation.acknowledged_at ? "Acknowledged" : "Waiting on a reviewer"} since{" "}
                {formatEscalationTimestamp(escalation.triggered_at)}
              </span>
            </span>
            <span className="flex shrink-0 gap-2">
              {escalation.acknowledged_at ? null : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void run(escalation.id, "start_review")}
                >
                  {busy === `${escalation.id}:start_review` ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : null}
                  Acknowledge
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null || noteEmpty}
                onClick={() => void run(escalation.id, "resolve")}
              >
                {busy === `${escalation.id}:resolve` ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : null}
                Resolve
              </Button>
            </span>
          </li>
        ))}
      </ul>

      <div>
        <label
          htmlFor={`escalation-note-${escalations[0]?.id ?? "none"}`}
          className="text-[12px] font-medium text-foreground"
        >
          What was done
        </label>
        <Textarea
          id={`escalation-note-${escalations[0]?.id ?? "none"}`}
          value={note}
          rows={2}
          onChange={(event) => setNote(event.target.value)}
          placeholder="One or two lines a surveyor could read."
          className="mt-1 min-h-[56px] text-[13px]"
        />
        <p className="mt-1 text-[12px] text-muted-foreground">
          {noteEmpty
            ? "Resolving needs a line about what was done, long enough to stand as the record."
            : "This line is kept with the escalation as its resolution."}
        </p>
      </div>

      {problem ? (
        <p role="alert" className="text-[12px] text-destructive">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
