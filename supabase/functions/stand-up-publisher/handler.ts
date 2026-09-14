import { jsonResponse } from "../_shared/cors.ts";
import {
  PublisherError,
  type PublisherStore,
  runPublisher,
} from "./publisher.ts";

export type PublisherEnvironment = {
  cronSecret: string;
  ingestUrl: string;
  ingestKeyId: string;
  ingestSecret: string;
};

async function requestBody(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 2) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function sameSecret(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let different = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    different |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return different === 0;
}

export async function handleStandUpPublisher(
  req: Request,
  environment: PublisherEnvironment,
  createStore: () => PublisherStore,
): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  if (
    !environment.cronSecret ||
    !sameSecret(req.headers.get("x-cron-secret") ?? "", environment.cronSecret)
  ) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const body = await requestBody(req).catch(() => null);
  if (body !== "" && body !== "{}") {
    return jsonResponse({ error: "Request body is not accepted" }, 400);
  }
  try {
    const result = await runPublisher(createStore(), {
      ingestUrl: environment.ingestUrl,
      ingestKeyId: environment.ingestKeyId,
      ingestSecret: environment.ingestSecret,
    });
    return jsonResponse(result, result.outcome === "busy" ? 202 : 200);
  } catch (error) {
    const code = error instanceof PublisherError
      ? error.code
      : "publisher_failed";
    console.error(JSON.stringify({ event: "stand_up_publish_failed", code }));
    return jsonResponse({ error: "Stand Up publication failed", code }, 502);
  }
}
