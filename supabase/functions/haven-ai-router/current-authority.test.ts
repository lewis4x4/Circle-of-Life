import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CurrentActorError } from "../_shared/current-actor.ts";
import { dispatch } from "../_shared/router-dispatch.ts";
import { classifyIntent } from "../_shared/router-intent.ts";
import { streamResponse } from "./index.ts";

function withAnthropicKey<T>(operation: () => Promise<T>): Promise<T> {
  const previous = Deno.env.get("ANTHROPIC_API_KEY");
  Deno.env.set("ANTHROPIC_API_KEY", "test-key");
  return operation().finally(() => {
    if (previous === undefined) Deno.env.delete("ANTHROPIC_API_KEY");
    else Deno.env.set("ANTHROPIC_API_KEY", previous);
  });
}

function jsonProvider(answer: string): Response {
  return Response.json({
    content: [{ type: "text", text: answer }],
    usage: { input_tokens: 3, output_tokens: 4 },
  });
}

Deno.test("classifier authorization denial never calls the provider or returns fallback intent", async () => {
  await withAnthropicKey(async () => {
    let providerCalled = false;
    await assertRejects(
      () =>
        classifyIntent("hello", {
          revalidate: () =>
            Promise.reject(new CurrentActorError(403, "Forbidden")),
          fetcher: async () => {
            providerCalled = true;
            return jsonProvider("unused");
          },
        }),
      CurrentActorError,
    );
    assertEquals(providerCalled, false);
  });
});

Deno.test("dispatch discards a provider answer when authority is revoked before return", async () => {
  await withAnthropicKey(async () => {
    let checks = 0;
    await assertRejects(
      () =>
        dispatch({
          admin: {} as never,
          intent: { intent: "chitchat", confidence: 1, reasoning: "test" },
          question: "hello",
          organizationId: "00000000-0000-0000-0000-000000000201",
          userRole: "owner",
          userId: "00000000-0000-0000-0000-000000000101",
          selectedFacilityId: null,
          moduleContext: null,
          facilityIds: [],
          revalidate: async () => {
            checks += 1;
            if (checks > 1) throw new CurrentActorError(403, "Forbidden");
          },
          fetcher: async () => jsonProvider("secret answer"),
        }),
      CurrentActorError,
    );
    assertEquals(checks, 2);
  });
});

Deno.test("SSE revocation emits no provider answer, citation, or token metadata", async () => {
  await withAnthropicKey(async () => {
    const providerBody = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":3}}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"secret streamed answer"}}',
      'data: {"type":"message_delta","usage":{"output_tokens":4}}',
      "data: [DONE]",
      "",
    ].join("\n");
    let checks = 0;
    const response = streamResponse({
      origin: null,
      admin: {} as never,
      t: { log: () => undefined },
      bodySessionId: null,
      organizationId: "00000000-0000-0000-0000-000000000201",
      userId: "00000000-0000-0000-0000-000000000101",
      question: "hello",
      routeContext: null,
      moduleContext: null,
      intent: { intent: "chitchat", confidence: 1, reasoning: "test" },
      dispatchResult: {
        answer: "fallback secret",
        citations: [{ kind: "data_table", title: "secret citation" }],
        tokensUsed: 7,
        tokensIn: 3,
        tokensOut: 4,
        toolsUsed: ["test"],
      },
      conversationContext: {
        priorTurns: [],
        rollingSummary: null,
        messageCount: 0,
      },
      primaryIntentOnlyWhenSpeculative: true,
      revalidate: async () => {
        checks += 1;
        if (checks > 1) throw new CurrentActorError(403, "Forbidden");
      },
      fetcher: async () =>
        new Response(providerBody, {
          headers: { "Content-Type": "text/event-stream" },
        }),
    });

    const text = await response.text();
    assert(text.includes("Authorization changed"));
    assert(!text.includes("secret streamed answer"));
    assert(!text.includes("fallback secret"));
    assert(!text.includes("secret citation"));
    assert(!text.includes('"type":"token"'));
    assert(!text.includes("tokens_used"));
  });
});
