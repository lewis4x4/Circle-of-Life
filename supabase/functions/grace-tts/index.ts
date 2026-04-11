import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const MAX_TTS_CHARACTERS = 4000;
const ALLOWED_VOICES = new Set(["alloy", "verse", "aria", "sage", "coral"]);

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

  let body: { text?: string; voice?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, origin);
  }

  const text = String(body.text ?? "").trim();
  if (!text) {
    return jsonResponse({ error: "text is required" }, 400, origin);
  }
  if (text.length > MAX_TTS_CHARACTERS) {
    return jsonResponse({ error: "text exceeds Grace narration limits" }, 413, origin);
  }
  const voice = String(body.voice ?? "alloy");
  if (!ALLOWED_VOICES.has(voice)) {
    return jsonResponse({ error: "voice is not supported" }, 400, origin);
  }

  const openAiRes = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice,
      input: text,
      format: "mp3",
    }),
  });

  if (!openAiRes.ok) {
    return jsonResponse({ error: `TTS failed (${openAiRes.status})` }, 502, origin);
  }

  const bytes = new Uint8Array(await openAiRes.arrayBuffer());
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  const audioBase64 = btoa(binary);

  return jsonResponse(
    {
      ok: true,
      audio_base64: audioBase64,
      mime_type: "audio/mpeg",
    },
    200,
    origin,
  );
});
