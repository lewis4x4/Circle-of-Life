/** Private ingress validation only: no receiver, ACK, tenant binding or inbox. */
export const QBO_WEBHOOK_LIMITS = Object.freeze({
  bytes: 1_048_576,
  events: 1_000,
  depth: 32,
  nodes: 100_000,
});
export type QboWebhookError =
  | "invalid_config"
  | "invalid_headers"
  | "unsupported_content_type"
  | "body_too_large"
  | "signature_invalid"
  | "invalid_utf8"
  | "invalid_json"
  | "invalid_schema"
  | "limits_exceeded"
  | "event_id_conflict"
  | "crypto_unavailable";
export type QboWebhookEvent = Readonly<{
  specversion: "1.0";
  id: string;
  source: string;
  type: string;
  intuitaccountid: string;
  intuitentityid: string;
  time: string;
  datacontenttype?: string;
  identity_sha256: string;
  event_bytes_sha256: string;
}>;
export type QboAuthenticatedEvidence = Readonly<
  { body_sha256: string; copyAuthenticatedBody: () => Uint8Array }
>;
export type QboWebhookResult =
  | Readonly<
    {
      ok: false;
      authenticated: false;
      code: QboWebhookError;
      logSummary: Readonly<{ code: QboWebhookError; authenticated: false }>;
    }
  >
  | Readonly<
    {
      ok: false;
      authenticated: true;
      code: QboWebhookError;
      evidence: QboAuthenticatedEvidence;
      logSummary: Readonly<
        { code: QboWebhookError; authenticated: true; body_sha256: string }
      >;
    }
  >
  | Readonly<{
    ok: true;
    authenticated: true;
    /** Provider identifiers can identify sensitive records. Never ordinary-log. */
    privateMetadata: Readonly<
      {
        validation: "signature_and_schema_only";
        events: readonly QboWebhookEvent[];
        eventByteRanges: readonly Readonly<{ start: number; end: number }>[];
      }
    >;
    logSummary: Readonly<
      {
        code: "signature_and_schema_valid";
        authenticated: true;
        body_sha256: string;
        event_count: number;
      }
    >;
    evidence: QboAuthenticatedEvidence;
  }>;
export type QboWebhookInput = {
  body: Uint8Array;
  /** Preserve duplicate header lines; joined comma-valued security headers fail. */
  headers: readonly (readonly [string, string])[];
  verifierToken: string;
};
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
class Invalid extends Error {
  constructor(readonly code: QboWebhookError) {
    super(code);
  }
}
function fail(code: QboWebhookError): never {
  throw new Invalid(code);
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max &&
    !Array.from(value).some((character) =>
      character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127
    ) &&
    decoder.decode(encoder.encode(value)) === value;
}
function jsonContentType(value: string, cloudEvents: boolean): boolean {
  const match = /^\s*([^;\s]+)\s*(?:;\s*charset\s*=\s*(?:"utf-8"|utf-8)\s*)?$/i
    .exec(value);
  return !!match &&
    (match[1].toLowerCase() === "application/json" ||
      (cloudEvents &&
        match[1].toLowerCase() === "application/cloudevents+json"));
}
function signatureHeader(headers: QboWebhookInput["headers"]): string {
  if (!Array.isArray(headers) || headers.length > 128) fail("invalid_headers");
  let signature: string | undefined;
  let contentType: string | undefined;
  for (const pair of headers) {
    if (
      !Array.isArray(pair) || pair.length !== 2 ||
      typeof pair[0] !== "string" || typeof pair[1] !== "string" ||
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(pair[0]) ||
      ["\r", "\n", "\0"].some((character) => pair[1].includes(character))
    ) fail("invalid_headers");
    const name = pair[0].toLowerCase();
    if (name === "intuit-signature") {
      if (signature !== undefined) fail("invalid_headers");
      signature = pair[1];
    }
    if (name === "content-type") {
      if (contentType !== undefined) fail("invalid_headers");
      contentType = pair[1];
    }
  }
  if (contentType === undefined || !jsonContentType(contentType, true)) {
    fail("unsupported_content_type");
  }
  if (signature === undefined || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) {
    fail("signature_invalid");
  }
  let binary: string;
  try {
    binary = atob(signature);
  } catch {
    return fail("signature_invalid");
  }
  if (binary.length !== 32 || btoa(binary) !== signature) {
    fail("signature_invalid");
  }
  return binary;
}

/** JSON grammar scanner retaining byte ranges and rejecting duplicate decoded keys.
 * Numbers are consumed lexically, never rounded or used to regenerate evidence.
 */
class JsonBytes {
  private index = 0;
  private nodes = 0;
  readonly events: { start: number; end: number }[] = [];
  private rootArray = false;
  constructor(private readonly bytes: Uint8Array) {}
  scan() {
    this.space();
    this.rootArray = this.bytes[this.index] === 91;
    this.value(0);
    this.space();
    if (this.index !== this.bytes.length) fail("invalid_json");
    if (!this.rootArray || this.events.length === 0) fail("invalid_schema");
    return this.events;
  }
  private space() {
    while ([32, 9, 10, 13].includes(this.bytes[this.index])) this.index++;
  }
  private take(byte: number) {
    if (this.bytes[this.index++] !== byte) fail("invalid_json");
  }
  private string(): string {
    const start = this.index;
    this.take(34);
    while (this.index < this.bytes.length) {
      const byte = this.bytes[this.index++];
      if (byte === 34) {
        try {
          return JSON.parse(
            decoder.decode(this.bytes.subarray(start, this.index)),
          );
        } catch {
          return fail("invalid_json");
        }
      }
      if (byte < 32) fail("invalid_json");
      if (byte === 92) {
        const escaped = this.bytes[this.index++];
        if (escaped === 117) {
          for (let i = 0; i < 4; i++) {
            const hex = this.bytes[this.index++];
            if (
              !((hex >= 48 && hex <= 57) || (hex >= 65 && hex <= 70) ||
                (hex >= 97 && hex <= 102))
            ) fail("invalid_json");
          }
        } else if (![34, 92, 47, 98, 102, 110, 114, 116].includes(escaped)) {
          fail("invalid_json");
        }
      }
    }
    return fail("invalid_json");
  }
  private value(depth: number): void {
    if (
      depth > QBO_WEBHOOK_LIMITS.depth ||
      ++this.nodes > QBO_WEBHOOK_LIMITS.nodes
    ) fail("limits_exceeded");
    this.space();
    const byte = this.bytes[this.index];
    if (byte === 34) {
      this.string();
      return;
    }
    if (byte === 123) {
      this.index++;
      this.space();
      const keys = new Set<string>();
      if (this.bytes[this.index] === 125) {
        this.index++;
        return;
      }
      for (;;) {
        this.space();
        const key = this.string();
        if (keys.has(key)) fail("invalid_json");
        keys.add(key);
        this.space();
        this.take(58);
        this.value(depth + 1);
        this.space();
        if (this.bytes[this.index] === 125) {
          this.index++;
          return;
        }
        this.take(44);
      }
    }
    if (byte === 91) {
      this.index++;
      this.space();
      if (this.bytes[this.index] === 93) {
        this.index++;
        return;
      }
      for (;;) {
        this.space();
        const start = this.index;
        this.value(depth + 1);
        if (depth === 0) {
          if (this.events.length >= QBO_WEBHOOK_LIMITS.events) {
            fail("limits_exceeded");
          }
          this.events.push({ start, end: this.index });
        }
        this.space();
        if (this.bytes[this.index] === 93) {
          this.index++;
          return;
        }
        this.take(44);
      }
    }
    for (const literal of ["true", "false", "null"]) {
      if (byte === literal.charCodeAt(0)) {
        for (const character of literal) this.take(character.charCodeAt(0));
        return;
      }
    }
    const start = this.index;
    if (this.bytes[this.index] === 45) this.index++;
    if (this.bytes[this.index] === 48) this.index++;
    else {
      if (!(this.bytes[this.index] >= 49 && this.bytes[this.index] <= 57)) {
        fail("invalid_json");
      }
      this.digits();
    }
    if (this.bytes[this.index] === 46) {
      this.index++;
      this.digits(true);
    }
    if ([101, 69].includes(this.bytes[this.index])) {
      this.index++;
      if ([43, 45].includes(this.bytes[this.index])) this.index++;
      this.digits(true);
    }
    if (this.index === start) fail("invalid_json");
  }
  private digits(required = false) {
    const start = this.index;
    while (this.bytes[this.index] >= 48 && this.bytes[this.index] <= 57) {
      this.index++;
    }
    if (required && start === this.index) fail("invalid_json");
  }
}
function providerTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[Tt]([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,9})?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/
      .exec(value);
  if (!match) return false;
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return month >= 1 && month <= 12 && day >= 1 &&
    day <=
      [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function eventFields(
  value: unknown,
): Omit<QboWebhookEvent, "identity_sha256" | "event_bytes_sha256"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid_schema");
  }
  const row = value as Record<string, unknown>;
  const required = [
    "specversion",
    "id",
    "source",
    "type",
    "time",
    "intuitentityid",
    "intuitaccountid",
    "data",
  ];
  if (
    required.some((key) => !Object.hasOwn(row, key)) ||
    Object.keys(row).some((key) =>
      !required.includes(key) && key !== "datacontenttype"
    )
  ) fail("invalid_schema");
  if (
    row.specversion !== "1.0" || !text(row.id, 512) ||
    !text(row.source, 2048) || !text(row.type, 256) ||
    !/^qbo\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.v[1-9]\d*$/.test(row.type) ||
    !providerTime(row.time)
  ) fail("invalid_schema");
  if (!text(row.intuitaccountid, 512) || !text(row.intuitentityid, 512)) {
    fail("invalid_schema");
  }
  if (!row.data || typeof row.data !== "object" || Array.isArray(row.data)) {
    fail("invalid_schema");
  }
  if (
    Object.hasOwn(row, "datacontenttype") &&
    (typeof row.datacontenttype !== "string" ||
      !jsonContentType(row.datacontenttype, false))
  ) fail("invalid_schema");
  return {
    specversion: "1.0",
    id: row.id,
    source: row.source,
    type: row.type,
    intuitaccountid: row.intuitaccountid,
    intuitentityid: row.intuitentityid,
    time: row.time,
    ...(typeof row.datacontenttype === "string"
      ? { datacontenttype: row.datacontenttype }
      : {}),
  };
}
async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
export async function validateQboWebhook(
  input: QboWebhookInput,
): Promise<QboWebhookResult> {
  let evidence: QboAuthenticatedEvidence | undefined;
  try {
    if (
      !input || typeof input.verifierToken !== "string" ||
      !text(input.verifierToken, 4096)
    ) fail("invalid_config");
    if (!(input.body instanceof Uint8Array)) fail("invalid_schema");
    if (input.body.byteLength > QBO_WEBHOOK_LIMITS.bytes) {
      fail("body_too_large");
    }
    // Own the bytes before the first await; callers cannot swap data after HMAC.
    const body = new Uint8Array(input.body);
    const keyBytes = encoder.encode(input.verifierToken);
    const signature = Uint8Array.from(
      signatureHeader(input.headers),
      (character) => character.charCodeAt(0),
    );
    const bodyHash = await sha256(body);
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    if (!await crypto.subtle.verify("HMAC", key, signature, body)) {
      fail("signature_invalid");
    }
    evidence = Object.freeze({
      body_sha256: bodyHash,
      copyAuthenticatedBody: () => body.slice(),
    });
    try {
      decoder.decode(body);
    } catch {
      fail("invalid_utf8");
    }
    const ranges = new JsonBytes(body).scan();
    const events: QboWebhookEvent[] = [];
    const fingerprints = new Map<string, string>();
    for (const range of ranges) {
      const bytes = body.slice(range.start, range.end);
      const fields = eventFields(JSON.parse(decoder.decode(bytes)));
      const identity = await sha256(
        encoder.encode(
          JSON.stringify([
            "qbo-cloudevent-identity-v1",
            fields.source,
            fields.id,
          ]),
        ),
      );
      const fingerprint = await sha256(bytes);
      const previous = fingerprints.get(identity);
      if (previous !== undefined && previous !== fingerprint) {
        fail("event_id_conflict");
      }
      fingerprints.set(identity, fingerprint);
      events.push(
        Object.freeze({
          ...fields,
          identity_sha256: identity,
          event_bytes_sha256: fingerprint,
        }),
      );
    }
    return Object.freeze({
      ok: true,
      authenticated: true,
      privateMetadata: Object.freeze({
        validation: "signature_and_schema_only",
        events: Object.freeze(events),
        eventByteRanges: Object.freeze(
          ranges.map((range) => Object.freeze(range)),
        ),
      }),
      evidence,
      logSummary: Object.freeze({
        code: "signature_and_schema_valid",
        authenticated: true,
        body_sha256: bodyHash,
        event_count: events.length,
      }),
    });
  } catch (error) {
    const code = error instanceof Invalid ? error.code : "crypto_unavailable";
    return evidence
      ? Object.freeze({
        ok: false,
        authenticated: true,
        code,
        evidence,
        logSummary: Object.freeze({
          code,
          authenticated: true,
          body_sha256: evidence.body_sha256,
        }),
      })
      : Object.freeze({
        ok: false,
        authenticated: false,
        code,
        logSummary: Object.freeze({ code, authenticated: false }),
      });
  }
}
