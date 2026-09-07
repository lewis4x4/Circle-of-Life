import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CurrentActorError } from "../_shared/current-actor.ts";
import { emitAuthorizedKnowledgeResult } from "./index.ts";

Deno.test("mid-loop revocation emits zero answer and source chunks", async () => {
  const chunks: Uint8Array[] = [];
  await assertRejects(
    () =>
      emitAuthorizedKnowledgeResult({
        controller: {
          enqueue: (chunk) => {
            if (chunk) chunks.push(chunk);
          },
        },
        encoder: new TextEncoder(),
        revalidate: () =>
          Promise.reject(new CurrentActorError(403, "Forbidden")),
        result: {
          text: "secret resident answer",
          sources: [{
            title: "secret source",
            excerpt: "secret excerpt",
            confidence: 1,
            section_title: null,
            anchor: {
              document_id: "00000000-0000-0000-0000-000000000401",
              chunk_id: "00000000-0000-0000-0000-000000000402",
            },
          }],
          toolsUsed: ["semantic_kb_search"],
          tokensIn: 10,
          tokensOut: 20,
          model: "test-model",
          kbSearchMiss: false,
          deterministic: false,
          clarification_needed: null,
        } as never,
        traceId: "trace-secret",
        conversationId: "conversation-secret",
        kbEmpty: false,
      }),
    CurrentActorError,
  );
  assertEquals(chunks.length, 0);
});
