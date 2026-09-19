"use client";

import { useState } from "react";
import { Loader2, Mic } from "lucide-react";

import { fetchCareEventPrefill } from "@/lib/care-events/prefill-client";
import type { CareEventKind } from "@/lib/care-events/level-engine";
import { transcribeGraceAudio, useGraceVoiceRecorder } from "@/lib/grace/voice/useGraceVoiceRecorder";

import { TapButton } from "./TapButton";

type Notice = { tone: "ok" | "warn"; text: string } | null;

/**
 * "Say what happened" on the How bad screen.
 *
 * Tap, speak, tap again. The recording is transcribed and read for the answers
 * to the questions already on this screen, and the chips it is sure about come
 * back highlighted. The caregiver reads them, changes what is wrong, and taps
 * send — the send button is untouched by this component, and so is the level.
 *
 * The chips visibly change in front of the caregiver rather than arriving
 * pre-set from a previous screen. That is deliberate: a person who watched the
 * chip move knows there is something to check.
 *
 * Every failure is quiet and non-blocking. The button is absent entirely where
 * the device has no microphone.
 */
export function VoicePrefillButton({
  kind,
  onPrefill,
}: {
  kind: CareEventKind;
  onPrefill: (prefill: Record<string, string>, questionsVersion: string | null) => void;
}) {
  const recorder = useGraceVoiceRecorder();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  if (!recorder.supported) return null;

  async function handleVoice() {
    setNotice(null);
    if (!recorder.recording) {
      const started = await recorder.start();
      if (!started) setNotice({ tone: "warn", text: "The microphone is not available on this device." });
      return;
    }
    setBusy(true);
    try {
      const audio = await recorder.stop();
      if (!audio || audio.size === 0) {
        setNotice({ tone: "warn", text: "Nothing was recorded. Tap the answers below." });
        return;
      }
      const text = (await transcribeGraceAudio(audio)).trim();
      if (!text) {
        setNotice({ tone: "warn", text: "That could not be turned into words. Tap the answers below." });
        return;
      }
      const { prefill, questionsVersion } = await fetchCareEventPrefill(kind, text);
      const count = Object.keys(prefill).length;
      if (count === 0) {
        setNotice({ tone: "warn", text: "Nothing could be filled in from that. Tap the answers below." });
        return;
      }
      onPrefill(prefill, questionsVersion);
      setNotice({
        tone: "ok",
        text:
          count === 1
            ? "One answer filled in below. Check it, change anything wrong, then send."
            : `${count} answers filled in below. Check them, change anything wrong, then send.`,
      });
    } catch {
      setNotice({ tone: "warn", text: "That could not be turned into words. Tap the answers below." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <TapButton
        className="justify-start gap-3"
        tone={recorder.recording ? "selected" : "neutral"}
        aria-pressed={recorder.recording}
        disabled={busy}
        onClick={() => void handleVoice()}
      >
        {busy ? (
          <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <Mic className="size-5" aria-hidden />
        )}
        <span>
          {busy
            ? "Reading what you said"
            : recorder.recording
              ? "Tap when you are done"
              : "Say what happened instead"}
        </span>
      </TapButton>
      {notice ? (
        <p
          role="status"
          className={
            notice.tone === "ok"
              ? "text-sm text-muted-foreground"
              : "text-sm font-medium text-foreground"
          }
        >
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
