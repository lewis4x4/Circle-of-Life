import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  type CurrentActorAuthorization,
  currentActorOrProviderErrorResponse,
  currentActorErrorResponse,
  requireCurrentActor,
  withCurrentActorRevalidation,
} from "../_shared/current-actor.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

type HandlerOptions = {
  authorizeActor?: (req: Request) => Promise<CurrentActorAuthorization>;
  fetcher?: typeof fetch;
};

export async function handleGraceTranscribe(
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

  let openAiRes: Response;
  try {
    openAiRes = await withCurrentActorRevalidation(actorAuth, () =>
      (options.fetcher ?? fetch)("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: openAiForm,
      }));
  } catch (error) {
    return currentActorOrProviderErrorResponse(error, {
      status: 502,
      message: "Transcription failed",
      headers: getCorsHeaders(origin),
    });
  }

  if (!openAiRes.ok) {
    return jsonResponse({ error: `Transcription failed (${openAiRes.status})` }, 502, origin);
  }

  const payload = await openAiRes.json();
  return jsonResponse({ ok: true, text: String(payload.text ?? "") }, 200, origin);
}

if (import.meta.main) Deno.serve((req) => handleGraceTranscribe(req));
