"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authorizedEdgeFetch } from "@/lib/supabase/edge-auth";
import { pushGracePresence } from "../presence";

export interface GraceVoiceRecorderApi {
  supported: boolean;
  recording: boolean;
  error: string | null;
  start: () => Promise<boolean>;
  stop: () => Promise<Blob | null>;
}

function parseJsonSafely<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function useGraceVoiceRecorder(): GraceVoiceRecorderApi {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const releasePresenceRef = useRef<(() => void) | null>(null);

  const cleanup = useCallback(() => {
    mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    streamRef.current?.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = null;
    streamRef.current = null;
    if (releasePresenceRef.current) {
      releasePresenceRef.current();
      releasePresenceRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      mediaRecorder.start();
      setRecording(true);
      releasePresenceRef.current = pushGracePresence("grace-voice", "listening");
      return true;
    } catch (recorderError) {
      setError(recorderError instanceof Error ? recorderError.message : "Microphone access failed");
      cleanup();
      return false;
    }
  }, [cleanup]);

  const stop = useCallback(async () => {
    const mediaRecorder = mediaRecorderRef.current;
    if (!mediaRecorder) return null;

    return await new Promise<Blob | null>((resolve) => {
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType || "audio/webm" });
        setRecording(false);
        cleanup();
        resolve(blob);
      };
      mediaRecorder.stop();
    });
  }, [cleanup]);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return {
    supported: typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
    recording,
    error,
    start,
    stop,
  };
}

export async function transcribeGraceAudio(audio: Blob): Promise<string> {
  const form = new FormData();
  form.append("audio", audio, "grace-input.webm");
  const res = await authorizedEdgeFetch(
    "grace-transcribe",
    {
      method: "POST",
      body: form,
    },
    "Grace Voice Recorder Auth Debug",
  );
  const payloadText = await res.text();
  const payload = parseJsonSafely<{ ok?: boolean; error?: string; text?: string }>(payloadText);
  if (!res.ok || !payload?.ok) {
    throw new Error(payload?.error ?? (payloadText || "Grace transcription failed"));
  }
  return String(payload.text ?? "");
}
