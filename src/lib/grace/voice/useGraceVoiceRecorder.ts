"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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

async function requireAccessToken(): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  // Debug logging
  console.log("[Grace Voice Recorder Auth Debug]", {
    hasError: !!error,
    errorMessage: error?.message,
    hasSession: !!session,
    hasAccessToken: !!session?.access_token,
    expiresAt: session?.expires_at,
    nowSeconds: Math.floor(Date.now() / 1000),
    userId: session?.user?.id,
  });

  if (error) {
    throw new Error(`Grace transcription auth: ${error.message}`);
  }
  if (!session?.access_token) {
    throw new Error("Grace: not signed in. Please reload the page and sign in again.");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = session.expires_at ?? 0;

  // Refresh if token is expiring within 60 seconds OR if expiresAt is missing/invalid
  if (!expiresAt || expiresAt < nowSeconds + 60) {
    console.log("[Grace Voice Recorder Auth Debug] Attempting token refresh...", { expiresAt, nowSeconds });
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    console.log("[Grace Voice Recorder Auth Debug] Refresh result", {
      hasError: !!refreshError,
      errorMessage: refreshError?.message,
      hasNewSession: !!refreshed.session,
      hasNewToken: !!refreshed.session?.access_token,
    });
    if (refreshError || !refreshed.session?.access_token) {
      throw new Error("Grace: session expired and refresh failed. Please sign in again.");
    }
    return refreshed.session.access_token;
  }

  console.log("[Grace Voice Recorder Auth Debug] Returning valid token", { userId: session.user.id });
  return session.access_token;
}

export async function transcribeGraceAudio(audio: Blob): Promise<string> {
  const accessToken = await requireAccessToken();
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const form = new FormData();
  form.append("audio", audio, "grace-input.webm");
  const res = await fetch(`${base}/functions/v1/grace-transcribe`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: form,
  });
  const payloadText = await res.text();
  const payload = parseJsonSafely<{ ok?: boolean; error?: string; text?: string }>(payloadText);
  if (!res.ok || !payload?.ok) {
    throw new Error(payload?.error ?? (payloadText || "Grace transcription failed"));
  }
  return String(payload.text ?? "");
}
