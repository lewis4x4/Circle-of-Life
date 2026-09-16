"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Loader2, Mic, Square } from "lucide-react";

import { RECEIPT_TRANSCRIPTION_FAILED_LINE } from "@/lib/care-events/receipt-copy";
import { appendCareEventNote } from "@/lib/care-events/submit";
import { transcribeGraceAudio, useGraceVoiceRecorder } from "@/lib/grace/voice/useGraceVoiceRecorder";
import type { Database } from "@/types/database";

import { TapButton } from "./TapButton";

type Notice = { tone: "ok" | "warn"; text: string } | null;

/**
 * The optional voice note on the receipt (spec 07A §2). Appends to the saved
 * event; not required, and it does not block the receipt.
 *
 * Files live in CareEventAttachments, directly below this on the receipt. This
 * component used to carry a second "Add photo" control of its own, which meant
 * two upload doors on one screen with different rules: that one took images
 * only, recorded no kind, and walked past the ten-file cap. One door.
 */
export function ReportReceiptActions({
  supabase,
  careEventId,
}: {
  supabase: SupabaseClient<Database>;
  careEventId: string | null;
}) {
  const recorder = useGraceVoiceRecorder();
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const pending = careEventId === null;

  async function handleVoice() {
    if (!careEventId) return;
    setNotice(null);
    if (!recorder.recording) {
      const started = await recorder.start();
      if (!started) setNotice({ tone: "warn", text: "The microphone is not available on this device." });
      return;
    }
    setVoiceBusy(true);
    try {
      const audio = await recorder.stop();
      if (!audio || audio.size === 0) {
        setNotice({ tone: "warn", text: "Nothing was recorded. Try again and speak after tapping." });
        return;
      }
      const text = (await transcribeGraceAudio(audio)).trim();
      if (!text) {
        setNotice({ tone: "warn", text: RECEIPT_TRANSCRIPTION_FAILED_LINE });
        return;
      }
      await appendCareEventNote(supabase, { careEventId, note: text });
      setNotice({ tone: "ok", text: "Voice note added to the event." });
    } catch {
      setNotice({ tone: "warn", text: RECEIPT_TRANSCRIPTION_FAILED_LINE });
    } finally {
      setVoiceBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <TapButton
        className="justify-start gap-3"
        tone={recorder.recording ? "selected" : "neutral"}
        aria-pressed={recorder.recording}
        disabled={pending || voiceBusy || !recorder.supported}
        onClick={() => void handleVoice()}
      >
        {voiceBusy ? (
          <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : recorder.recording ? (
          <Square className="size-5" aria-hidden />
        ) : (
          <Mic className="size-5" aria-hidden />
        )}
        <span>{voiceBusy ? "Saving voice note" : recorder.recording ? "Stop and save voice note" : "Add voice note"}</span>
      </TapButton>
      {pending ? (
        <p className="text-sm text-muted-foreground">The voice note opens once the event has been sent.</p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className={
            notice.tone === "ok"
              ? "text-sm text-success"
              : "rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground"
          }
        >
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
