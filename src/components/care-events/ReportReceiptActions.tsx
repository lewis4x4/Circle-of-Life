"use client";

import { useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Camera, Loader2, Mic, Square } from "lucide-react";

import { RECEIPT_PHOTO_FAILED_LINE, RECEIPT_TRANSCRIPTION_FAILED_LINE } from "@/lib/care-events/receipt-copy";
import { uploadCareEventPhoto } from "@/lib/care-events/report-data";
import { appendCareEventNote } from "@/lib/care-events/submit";
import { transcribeGraceAudio, useGraceVoiceRecorder } from "@/lib/grace/voice/useGraceVoiceRecorder";
import type { Database } from "@/types/database";

import { TapButton } from "./TapButton";

type Notice = { tone: "ok" | "warn"; text: string } | null;

/**
 * Optional photo and voice note on the receipt (spec 07A §2). Both append to
 * the saved event; neither is required and neither blocks the receipt.
 */
export function ReportReceiptActions({
  supabase,
  careEventId,
  organizationId,
  facilityId,
}: {
  supabase: SupabaseClient<Database>;
  careEventId: string | null;
  organizationId: string;
  facilityId: string;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recorder = useGraceVoiceRecorder();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const pending = careEventId === null;

  async function handlePhoto(file: File | undefined) {
    if (!file || !careEventId) return;
    setPhotoBusy(true);
    setNotice(null);
    try {
      const path = await uploadCareEventPhoto(supabase, { organizationId, facilityId, careEventId, file });
      await appendCareEventNote(supabase, { careEventId, photoPath: path });
      setNotice({ tone: "ok", text: "Photo added to the event." });
    } catch {
      setNotice({ tone: "warn", text: RECEIPT_PHOTO_FAILED_LINE });
    } finally {
      setPhotoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

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
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Choose a photo"
        tabIndex={-1}
        onChange={(event) => void handlePhoto(event.target.files?.[0])}
      />
      <TapButton
        className="justify-start gap-3"
        disabled={pending || photoBusy}
        onClick={() => fileInputRef.current?.click()}
      >
        {photoBusy ? <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Camera className="size-5" aria-hidden />}
        <span>{photoBusy ? "Uploading photo" : "Add photo"}</span>
      </TapButton>
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
        <p className="text-sm text-muted-foreground">Photo and voice note open once the event has been sent.</p>
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
