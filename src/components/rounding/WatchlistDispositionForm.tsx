"use client";

/**
 * Move a Watchlist signal forward and write one line about what was done.
 *
 * The most valuable thing on the page. The ledger row this produces is the
 * survey artifact: the facility identified the risk on a date, a named person
 * reviewed it, this is what was done. Which is why the line is required here,
 * required in the command, and required by a CHECK on the ledger itself. A
 * reviewer who has nothing to write has not finished reviewing.
 *
 * Forward only, and the choices offered are exactly the ones the command will
 * accept, so the form never puts up an option the database refuses.
 */

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { dispositionWatchlistSignal } from "@/lib/rounding/watchlist-fetch";
import {
  nextDispositions,
  signalStatusLabel,
} from "@/lib/rounding/watchlist-display-copy";

const REFUSED = "You are not able to disposition signals at this building.";
const UNAVAILABLE = "The disposition could not be recorded. Try again in a moment.";

export function WatchlistDispositionForm({
  supabase,
  signalInstanceId,
  currentStatus,
  onRecorded,
}: {
  supabase: SupabaseClient;
  signalInstanceId: string;
  currentStatus: string;
  onRecorded: () => void;
}) {
  const choices = nextDispositions(currentStatus);
  const [toStatus, setToStatus] = useState<string>(choices[0] ?? "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (choices.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        This signal is cleared. Its record stays in the ledger below.
      </p>
    );
  }

  const trimmed = note.trim();
  const disabled = saving || trimmed.length === 0 || toStatus.length === 0;

  async function submit() {
    setSaving(true);
    setMessage(null);
    try {
      await dispositionWatchlistSignal(supabase, {
        signalInstanceId,
        toStatus,
        note: trimmed,
      });
      setNote("");
      onRecorded();
    } catch (caught) {
      const code = (caught as { code?: string } | null)?.code;
      setMessage(code === "42501" ? REFUSED : UNAVAILABLE);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) void submit();
      }}
    >
      <div className="space-y-1.5">
        <label
          htmlFor={`disposition-status-${signalInstanceId}`}
          className="text-[13px] font-medium text-foreground"
        >
          Move this signal to
        </label>
        <Select value={toStatus} onValueChange={setToStatus}>
          <SelectTrigger id={`disposition-status-${signalInstanceId}`} className="h-9 max-w-xs">
            <SelectValue placeholder="Choose a disposition" />
          </SelectTrigger>
          <SelectContent>
            {choices.map((choice) => (
              <SelectItem key={choice} value={choice}>
                {signalStatusLabel(choice)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor={`disposition-note-${signalInstanceId}`}
          className="text-[13px] font-medium text-foreground"
        >
          What was done
        </label>
        <Textarea
          id={`disposition-note-${signalInstanceId}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="One line. Who was told, what changed, what happens next."
          className="max-w-2xl"
        />
        <p className="text-[12px] text-muted-foreground">
          This line goes in the disposition ledger and is what a surveyor reads.
        </p>
      </div>

      {message ? (
        <p role="alert" className="text-[13px] text-danger">
          {message}
        </p>
      ) : null}

      <Button type="submit" size="sm" disabled={disabled}>
        {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
        Record disposition
      </Button>
    </form>
  );
}
