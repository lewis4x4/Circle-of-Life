import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, origin);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: authError,
  } = await admin.auth.getUser(token);
  if (authError || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401, origin);
  }

  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof File)) {
    return jsonResponse({ error: "audio file is required" }, 400, origin);
  }
  if (audio.size <= 0 || audio.size > MAX_AUDIO_BYTES) {
    return jsonResponse({ error: "audio file exceeds Grace transcription limits" }, 413, origin);
  }

  const openAiForm = new FormData();
  openAiForm.append("file", audio, audio.name || "grace-input.webm");
  openAiForm.append("model", "whisper-1");

  const openAiRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: openAiForm,
  });

  if (!openAiRes.ok) {
    return jsonResponse({ error: `Transcription failed (${openAiRes.status})` }, 502, origin);
  }

  const payload = await openAiRes.json();
  return jsonResponse({ ok: true, text: String(payload.text ?? "") }, 200, origin);
});
