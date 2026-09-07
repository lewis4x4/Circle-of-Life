import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  type CurrentActorAuthorization,
  currentActorOrProviderErrorResponse,
  currentActorErrorResponse,
  requireCurrentActor,
  withCurrentActorRevalidation,
} from "../_shared/current-actor.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const MAX_TTS_CHARACTERS = 4000;
const ALLOWED_VOICES = new Set(["alloy", "verse", "aria", "sage", "coral"]);

type HandlerOptions = {
  authorizeActor?: (req: Request) => Promise<CurrentActorAuthorization>;
  fetcher?: typeof fetch;
};

export async function handleGraceTts(
  req: Request,
  options: HandlerOptions = {},
): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, origin);
  }

  let actorAuth;
  try {
    actorAuth = await (options.authorizeActor ?? requireCurrentActor)(req);
  } catch (error) {
    return currentActorErrorResponse(error, getCorsHeaders(origin));
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

  let openAiRes: Response;
  try {
    openAiRes = await withCurrentActorRevalidation(actorAuth, () =>
      (options.fetcher ?? fetch)("https://api.openai.com/v1/audio/speech", {
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
      }));
  } catch (error) {
    return currentActorOrProviderErrorResponse(error, {
      status: 502,
      message: "TTS failed",
      headers: getCorsHeaders(origin),
    });
  }

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
}

if (import.meta.main) Deno.serve((req) => handleGraceTts(req));
