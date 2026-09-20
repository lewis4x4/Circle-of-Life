import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SECRET = "synthetic-webhook-secret";
const RECOVERY_LABEL = "haven-0123456789abcdef0123456789abcdef";

Deno.env.set("SUPABASE_URL", "https://supabase.test");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
Deno.env.set("BOLDSIGN_WEBHOOK_SECRET", SECRET);

const {
  extractBoldSignWebhookEnvelope,
  handleBoldSignWebhook,
} = await import("./boldsign-webhook/handler.ts");

function webhookTest(
  name: string,
  fn: () => void | Promise<void>,
): void {
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });
}

function webhookPayload(overrides: Record<string, unknown> = {}) {
  return {
    event: {
      id: "event-0001",
      created: 1_669_960_054,
      eventType: "Completed",
      environment: "Live",
    },
    data: {
      documentId: "document-0001",
      labels: [RECOVERY_LABEL],
      signerDetails: [{
        id: "recipient-0001",
        emailAddress: "signer@example.test",
        signerName: "Synthetic signer",
      }],
    },
    context: { actor: { id: "recipient-0001", userType: "Signer" } },
    ...overrides,
  };
}

async function signature(rawBody: string, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestamp},s0=${hex}`;
}

async function request(payload: unknown, signatureOverride?: string) {
  const rawBody = JSON.stringify(payload);
  return new Request("https://edge.test/functions/v1/boldsign-webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BoldSign-Signature": signatureOverride ?? await signature(rawBody),
    },
    body: rawBody,
  });
}

webhookTest("extracts BoldSign's canonical nested event identity, time, and recovery label", () => {
  const envelope = extractBoldSignWebhookEnvelope(webhookPayload(), null);
  assertEquals(envelope.eventId, "event-0001");
  assertEquals(envelope.eventType, "Completed");
  assertEquals(envelope.providerCreatedAt, "2022-12-02T05:47:34.000Z");
  assertEquals(envelope.providerDocumentId, "document-0001");
  assertEquals(envelope.recoveryLabel, RECOVERY_LABEL);
  assertEquals(envelope.signerRecipientId, "recipient-0001");
  assertEquals(envelope.signerEmail, "signer@example.test");
});

webhookTest("applies a verified webhook through one atomic database command", async () => {
  const originalFetch = globalThis.fetch;
  let rpcBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname !== "/rest/v1/rpc/apply_boldsign_webhook_event") {
      throw new Error(`Unexpected request ${url}`);
    }
    const body = input instanceof Request
      ? await input.clone().text()
      : String((init as { body?: unknown } | undefined)?.body ?? "{}");
    rpcBody = JSON.parse(body);
    return Response.json({ duplicate: false, matched_contract: true, event_type: "Completed" });
  };
  try {
    const response = await handleBoldSignWebhook(await request(webhookPayload()));
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      ok: true,
      duplicate_event: false,
      matched_contract: true,
      event_type: "Completed",
    });
    assertEquals(rpcBody?.p_provider_event_id, "event-0001");
    assertEquals(rpcBody?.p_provider_environment, "live");
    assertEquals(
      rpcBody?.p_recovery_label,
      RECOVERY_LABEL,
    );
    assertEquals(rpcBody?.p_provider_document_id, "document-0001");
    assertEquals(rpcBody?.p_raw_payload, webhookPayload());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

webhookTest("duplicate webhook acknowledgement is a projection no-op reported by the atomic command", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ duplicate: true, matched_contract: true, event_type: "Completed" });
  try {
    const response = await handleBoldSignWebhook(await request(webhookPayload()));
    assertEquals(response.status, 200);
    assertEquals((await response.json()).duplicate_event, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

webhookTest("semantic duplicate delivery passes parsed JSON for database canonicalization", async () => {
  const originalFetch = globalThis.fetch;
  const payloads: unknown[] = [];
  globalThis.fetch = async (input, init) => {
    const raw = input instanceof Request
      ? await input.clone().text()
      : String((init as { body?: unknown } | undefined)?.body ?? "{}");
    const args = JSON.parse(raw) as { p_raw_payload: unknown };
    payloads.push(args.p_raw_payload);
    return Response.json({ action: "duplicate", matched_contract: true });
  };
  try {
    const first = webhookPayload();
    const second = {
      context: first.context,
      data: first.data,
      event: first.event,
    };
    assertEquals((await handleBoldSignWebhook(await request(first))).status, 200);
    assertEquals((await handleBoldSignWebhook(await request(second))).status, 200);
    assertEquals(payloads.length, 2);
    assertEquals(payloads[0], payloads[1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

webhookTest("missing canonical event identity is rejected before database mutation", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json({});
  };
  try {
    const payload = webhookPayload({ event: { created: 1_669_960_054, eventType: "Completed" } });
    const response = await handleBoldSignWebhook(await request(payload));
    assertEquals(response.status, 400);
    assertEquals(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

webhookTest("atomic projection failure is retryable and never acknowledged as success", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ code: "P0001", message: "synthetic rollback" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  try {
    const response = await handleBoldSignWebhook(await request(webhookPayload()));
    assertEquals(response.status, 500);
    assertEquals(await response.json(), { error: "Failed to apply BoldSign event" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

webhookTest("invalid webhook signature is rejected before database mutation", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json({});
  };
  try {
    const response = await handleBoldSignWebhook(
      await request(webhookPayload(), `t=${Math.floor(Date.now() / 1000)},s0=${"0".repeat(64)}`),
    );
    assertEquals(response.status, 400);
    assertEquals(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

webhookTest("a signed event from the wrong provider environment is rejected before projection", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json({});
  };
  try {
    const payload = webhookPayload({
      event: {
        id: "event-sandbox",
        created: 1_669_960_054,
        eventType: "Completed",
        environment: "Sandbox",
      },
    });
    const response = await handleBoldSignWebhook(await request(payload));
    assertEquals(response.status, 400);
    assertEquals(await response.json(), { error: "BoldSign environment mismatch" });
    assertEquals(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

webhookTest("an oversized chunked body is cancelled before authentication or database work", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return Response.json({});
  };
  try {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700_000));
        controller.enqueue(new Uint8Array(400_000));
        controller.close();
      },
    });
    const req = new Request("https://edge.test/functions/v1/boldsign-webhook", {
      method: "POST",
      body: stream,
      headers: { "Content-Type": "application/json" },
    });
    assertEquals(req.headers.has("content-length"), false);
    const response = await handleBoldSignWebhook(req);
    assertEquals(response.status, 413);
    assertEquals(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
