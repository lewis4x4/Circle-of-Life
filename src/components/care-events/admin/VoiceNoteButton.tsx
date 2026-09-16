"use client";

import { Loader2, Mic, Square } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { transcribeGraceAudio, useGraceVoiceRecorder } from "@/lib/grace/voice/useGraceVoiceRecorder";

export type VoiceNoteButtonProps = {
  /** Button text while idle, e.g. "Add voice note for orders". */
  label: string;
  onTranscript: (text: string) => void;
  disabled?: boolean;
};

/**
 * Record, stop, transcribe, hand the text back. Says plainly when the device
 * has no microphone or the transcription did not come back.
 */
export function VoiceNoteButton({ label, onTranscript, disabled }: VoiceNoteButtonProps) {
  const recorder = useGraceVoiceRecorder();
  const [transcribing, setTranscribing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (!recorder.supported) {
    return <p className="text-xs text-muted-foreground">Voice notes need a microphone on this device.</p>;
  }

  async function toggle() {
    setNotice(null);
    if (recorder.recording) {
      const blob = await recorder.stop();
      if (!blob) return;
      setTranscribing(true);
      try {
        const text = (await transcribeGraceAudio(blob)).trim();
        if (text) {
          onTranscript(text);
          setNotice("Voice note added.");
        } else {
          setNotice("Nothing was heard. Try again closer to the phone.");
        }
      } catch {
        setNotice("The voice note could not be transcribed. Type it instead or try again.");
      } finally {
        setTranscribing(false);
      }
      return;
    }
    const started = await recorder.start();
    if (!started) setNotice(recorder.error ?? "Microphone access failed.");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant={recorder.recording ? "destructive" : "outline"}
        size="sm"
        disabled={disabled || transcribing}
        aria-pressed={recorder.recording}
        onClick={() => void toggle()}
      >
        {transcribing ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : recorder.recording ? (
          <Square className="size-4" aria-hidden />
        ) : (
          <Mic className="size-4" aria-hidden />
        )}
        {transcribing ? "Transcribing" : recorder.recording ? "Stop and transcribe" : label}
      </Button>
      {notice ? (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
