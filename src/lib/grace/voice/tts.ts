"use client";

import { authorizedEdgeFetch } from "@/lib/supabase/edge-auth";
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
  const res = await authorizedEdgeFetch(
    "grace-tts",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, voice }),
    },
    "Grace TTS Auth Debug",
  );
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
