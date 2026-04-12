"use client";

import { createClient } from "@/lib/supabase/client";
import { pushGracePresence } from "../presence";

let activeAudio: HTMLAudioElement | null = null;
let activePresenceRelease: (() => void) | null = null;

function parseJsonSafely<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function requireAccessToken(): Promise<string> {
  const supabase = createClient();
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  // Debug logging
  console.log("[Grace TTS Auth Debug]", {
    hasError: !!error,
    errorMessage: error?.message,
    hasSession: !!session,
    hasAccessToken: !!session?.access_token,
    expiresAt: session?.expires_at,
    nowSeconds: Math.floor(Date.now() / 1000),
    userId: session?.user?.id,
  });

  if (error) {
    throw new Error(`Grace TTS auth: ${error.message}`);
  }
  if (!session?.access_token) {
    throw new Error("Grace: not signed in. Please reload the page and sign in again.");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = session.expires_at ?? 0;

  // Refresh if token is expiring within 60 seconds OR if expiresAt is missing/invalid
  if (!expiresAt || expiresAt < nowSeconds + 60) {
    console.log("[Grace TTS Auth Debug] Attempting token refresh...", { expiresAt, nowSeconds });
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    console.log("[Grace TTS Auth Debug] Refresh result", {
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

  console.log("[Grace TTS Auth Debug] Returning valid token", { userId: session.user.id });
  return session.access_token;
}

export function cancelGraceSpeech() {
  activeAudio?.pause();
  activeAudio = null;
  if (activePresenceRelease) {
    activePresenceRelease();
    activePresenceRelease = null;
  }
}

export async function graceSpeak(text: string, voice = "alloy"): Promise<void> {
  if (!text.trim()) return;
  cancelGraceSpeech();
  const accessToken = await requireAccessToken();
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ?? "";
  const res = await fetch(`${base}/functions/v1/grace-tts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, voice }),
  });
  const payloadText = await res.text();
  const payload = parseJsonSafely<{ ok?: boolean; error?: string; mime_type?: string; audio_base64?: string }>(payloadText);
  if (!res.ok || !payload?.ok) {
    throw new Error(payload?.error ?? (payloadText || "Grace TTS failed"));
  }

  const audio = new Audio(`data:${payload.mime_type};base64,${payload.audio_base64}`);
  activeAudio = audio;
  activePresenceRelease = pushGracePresence("grace-tts", "speaking");
  audio.onended = () => cancelGraceSpeech();
  audio.onerror = () => cancelGraceSpeech();
  try {
    await audio.play();
  } catch (error) {
    cancelGraceSpeech();
    throw error instanceof Error ? error : new Error("Grace narration could not start");
  }
}
