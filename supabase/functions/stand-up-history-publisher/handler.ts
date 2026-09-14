import { jsonResponse } from "../_shared/cors.ts";
import { PublisherError } from "../stand-up-publisher/publisher.ts";
import { type HistoryStore, runHistoryPublisher } from "./history.ts";

export type HistoryEnvironment = {
  cronSecret: string;
  ingestUrl: string;
  ingestKeyId: string;
  ingestSecret: string;
};

function sameSecret(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let different = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    different |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return different === 0;
}

async function emptyCronBody(req: Request): Promise<boolean> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 2) return false;
  if (!req.body) return true;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2) {
      await reader.cancel();
      return false;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return body === "" || body === "{}";
}

export async function handleStandUpHistoryPublisher(
  req: Request,
  environment: HistoryEnvironment,
  createStore: () => HistoryStore,
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
  if (!await emptyCronBody(req).catch(() => false)) {
    return jsonResponse({ error: "Request body is not accepted" }, 400);
  }
  try {
    const result = await runHistoryPublisher(createStore(), {
      ingestUrl: environment.ingestUrl,
      ingestKeyId: environment.ingestKeyId,
      ingestSecret: environment.ingestSecret,
    });
    return jsonResponse(result, result.outcome === "busy" ? 202 : 200);
  } catch (error) {
    const code = error instanceof PublisherError
      ? error.code
      : "history_publisher_failed";
    console.error(
      JSON.stringify({ event: "stand_up_history_publish_failed", code }),
    );
    return jsonResponse(
      { error: "Stand Up history publication failed", code },
      502,
    );
  }
}
