import { createHash } from "node:crypto";

// Fixed namespace for Document Intake follow-on request keys (never change it:
// a retry must derive the same key the first attempt used).
const NAMESPACE = Buffer.from("5c1f4f0e2b7a4d8e9a3c6b1d0e7f2a94", "hex");

/**
 * A UUID (v5 layout) derived from a client request key and a step name, so the
 * second RPC of a multi-step request (finalize a split, complete a filing)
 * replays instead of running twice when the whole request is retried.
 */
export function deriveRequestKey(requestKey: string, step: string) {
  const hash = createHash("sha1").update(NAMESPACE).update(`${requestKey.toLowerCase()}:${step}`, "utf8").digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
