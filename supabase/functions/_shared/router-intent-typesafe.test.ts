import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert";

import {
  INJECTION_THRESHOLD,
  MIXED_THRESHOLD,
  composeIntent,
  buildIntentState,
} from "./router-intent-typesafe.ts";
import { TypeSafeError, evaluateSystemOne, requireScore } from "./typesafe-client.ts";
import { classifyIntent } from "./router-intent.ts";
import type { SystemOneResponse } from "./typesafe-client.ts";

type AnswerSpec = {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
  injection?: number;
  needsData?: number;
  needsKb?: number;
};

function buildResponse(spec: AnswerSpec): SystemOneResponse {
  return {
    model: "jev-latest",
    answers: {
      intent: {
        type: "choice",
        choice: spec.choice,
        probabilities: spec.probabilities,
        confidence: spec.confidence,
      },
      is_prompt_injection: { type: "noul", noul: spec.injection ?? 0.01 },
      needs_operational_data: { type: "noul", noul: spec.needsData ?? 0.05 },
      needs_knowledge_base: { type: "noul", noul: spec.needsKb ?? 0.05 },
    },
  };
}

Deno.test("composeIntent reports the choice and the distribution's own confidence", () => {
  const result = composeIntent(
    buildResponse({
      choice: "metric",
      probabilities: { metric: 0.93, historical: 0.04, directory: 0.03 },
      confidence: 0.91,
      needsData: 0.95,
    }),
  );

  assertEquals(result.intent, "metric");
  // Calibrated, not self-reported: it is the concentration of `probabilities`.
  assertEquals(result.confidence, 0.91);
  assertEquals(result.secondary, undefined);
});

Deno.test("composeIntent promotes a close runner-up to secondary", () => {
  const result = composeIntent(
    buildResponse({
      choice: "policy",
      probabilities: { policy: 0.46, regulatory: 0.38, metric: 0.16 },
      confidence: 0.41,
      needsKb: 0.92,
    }),
  );

  assertEquals(result.intent, "policy");
  assertEquals(result.secondary, "regulatory");
});

Deno.test("composeIntent leaves a distant runner-up alone", () => {
  const result = composeIntent(
    buildResponse({
      choice: "policy",
      probabilities: { policy: 0.80, regulatory: 0.12, metric: 0.08 },
      confidence: 0.78,
      needsKb: 0.9,
    }),
  );

  assertEquals(result.secondary, undefined);
});

Deno.test("composeIntent refuses on injection even when the class looks confident", () => {
  const result = composeIntent(
    buildResponse({
      choice: "policy",
      probabilities: { policy: 0.88, regulatory: 0.12 },
      confidence: 0.86,
      injection: INJECTION_THRESHOLD + 0.05,
      needsKb: 0.8,
    }),
  );

  assertEquals(result.intent, "refuse");
  assertStringIncludes(result.reasoning, "typesafe_injection");
});

Deno.test("composeIntent derives mixed from the two nouls, not from the choice", () => {
  const result = composeIntent(
    buildResponse({
      choice: "metric",
      probabilities: { metric: 0.71, policy: 0.29 },
      confidence: 0.68,
      needsData: 0.88,
      needsKb: 0.74,
    }),
  );

  assertEquals(result.intent, "mixed");
  assertEquals(result.secondary, "metric");
  // As certain as the weaker half, not as the stronger one.
  assertEquals(result.confidence, 0.74);
});

Deno.test("composeIntent does not call a question mixed on one half alone", () => {
  const result = composeIntent(
    buildResponse({
      choice: "metric",
      probabilities: { metric: 0.9, policy: 0.1 },
      confidence: 0.88,
      needsData: 0.97,
      needsKb: MIXED_THRESHOLD - 0.05,
    }),
  );

  assertEquals(result.intent, "metric");
});

Deno.test("composeIntent keeps clinical_record primary so the audit PHI class survives", () => {
  // index.ts derives the audit PHI class from `intent === "clinical_record"`.
  // Relabelling this as `mixed` would file a PHI access as `limited`.
  const result = composeIntent(
    buildResponse({
      choice: "clinical_record",
      probabilities: { clinical_record: 0.66, policy: 0.34 },
      confidence: 0.62,
      needsData: 0.94,
      needsKb: 0.81,
    }),
  );

  assertEquals(result.intent, "clinical_record");
  assertEquals(result.secondary, "policy");
});

Deno.test("composeIntent declines an option key outside its own set", () => {
  const result = composeIntent(
    buildResponse({
      choice: "billing",
      probabilities: { billing: 0.9 },
      confidence: 0.9,
    }),
  );

  assertEquals(result.intent, "refuse");
  assertEquals(result.confidence, 0);
});

Deno.test("composeIntent throws rather than inventing a missing answer", () => {
  const response = buildResponse({
    choice: "metric",
    probabilities: { metric: 0.9 },
    confidence: 0.9,
  });
  delete response.answers.needs_knowledge_base;

  let thrown: unknown;
  try {
    composeIntent(response);
  } catch (err) {
    thrown = err;
  }
  assertEquals(thrown instanceof TypeSafeError, true);
});

Deno.test("buildIntentState omits absent context instead of sending empty fields", () => {
  assertEquals(buildIntentState("Who runs Homewood?", {}), {
    question: "Who runs Homewood?",
  });
  assertEquals(
    buildIntentState("Who runs Homewood?", { userRole: "owner", surfaceContext: "/admin" }),
    { question: "Who runs Homewood?", ui_surface: "/admin", user_role: "owner" },
  );
});

Deno.test("evaluateSystemOne maps status codes to kinds and never echoes the body", async () => {
  const cases: Array<[number, string]> = [
    [401, "unauthorized"],
    [422, "malformed_request"],
    [429, "rate_limited"],
    [529, "overloaded"],
    [503, "http_error"],
  ];

  for (const [status, kind] of cases) {
    const error = await assertRejects(
      () =>
        evaluateSystemOne({
          apiKey: "k",
          state: { question: "What meds is John Smith on?" },
          questions: {
            q: { type: "noul", instructions: "x", criteria: { true: "y", false: "n" } },
          },
          fetcher: () =>
            Promise.resolve(
              new Response("resident John Smith leaked into an error body", { status }),
            ),
        }),
      TypeSafeError,
    );
    assertEquals(error.kind, kind);
    assertEquals(error.message.includes("John Smith"), false);
  }
});

Deno.test("requireScore returns the weighted position, not a level index", () => {
  const response: SystemOneResponse = {
    model: "jev-latest",
    answers: {
      completeness: {
        type: "score",
        score: 1.4,
        probabilities: { "0": 0.1, "1": 0.4, "2": 0.5 },
        confidence: 0.52,
      },
    },
  };

  assertEquals(requireScore(response, "completeness").score, 1.4);
  assertEquals(requireScore(response, "completeness").confidence, 0.52);
});

Deno.test("requireScore throws on a missing or wrong-typed answer", () => {
  const response: SystemOneResponse = {
    model: "jev-latest",
    answers: { completeness: { type: "noul", noul: 0.9 } },
  };

  for (const id of ["completeness", "absent"]) {
    let thrown: unknown;
    try {
      requireScore(response, id);
    } catch (err) {
      thrown = err;
    }
    assertEquals(thrown instanceof TypeSafeError, true);
  }
});

Deno.test("evaluateSystemOne rejects a 200 that is not the documented shape", async () => {
  const error = await assertRejects(
    () =>
      evaluateSystemOne({
        apiKey: "k",
        state: "x",
        questions: {
          q: { type: "noul", instructions: "x", criteria: { true: "y", false: "n" } },
        },
        fetcher: () =>
          Promise.resolve(
            new Response(JSON.stringify({ model: "jev-latest" }), { status: 200 }),
          ),
      }),
    TypeSafeError,
  );
  assertEquals(error.kind, "malformed_response");
});

// --- Engine selection -------------------------------------------------------

function anthropicOk(intent: string): Response {
  return new Response(
    JSON.stringify({
      content: [
        {
          type: "text",
          text: JSON.stringify({ intent, confidence: 0.8, reasoning: "haiku" }),
        },
      ],
    }),
    { status: 200 },
  );
}

Deno.test("classifyIntent falls back to Anthropic when the TypeSafe key is absent", async () => {
  Deno.env.set("ANTHROPIC_API_KEY", "test-anthropic");
  Deno.env.delete("TYPESAFE_API_KEY");
  const events: Record<string, unknown>[] = [];
  const seen: string[] = [];

  const result = await classifyIntent("What's our occupancy?", {
    engine: "typesafe",
    onEvent: (e) => events.push(e),
    fetcher: (input) => {
      seen.push(String(input));
      return Promise.resolve(anthropicOk("metric"));
    },
  });

  assertEquals(result.intent, "metric");
  assertEquals(seen.some((u) => u.includes("typesafe.ai")), false);
  assertEquals(events[0], {
    event: "intent_engine_fallback",
    reason: "typesafe_key_missing",
  });
});

Deno.test("classifyIntent falls back to Anthropic when TypeSafe errors", async () => {
  Deno.env.set("ANTHROPIC_API_KEY", "test-anthropic");
  Deno.env.set("TYPESAFE_API_KEY", "test-typesafe");
  const events: Record<string, unknown>[] = [];

  const result = await classifyIntent("What's our occupancy?", {
    engine: "typesafe",
    onEvent: (e) => events.push(e),
    fetcher: (input) => {
      const url = String(input);
      if (url.includes("typesafe.ai")) {
        return Promise.resolve(new Response("nope", { status: 529 }));
      }
      return Promise.resolve(anthropicOk("metric"));
    },
  });

  assertEquals(result.intent, "metric");
  assertEquals(events[0].event, "intent_engine_fallback");
  assertEquals(events[0].reason, "overloaded");

  Deno.env.delete("TYPESAFE_API_KEY");
});

Deno.test("classifyIntent uses TypeSafe when configured and it answers", async () => {
  Deno.env.set("TYPESAFE_API_KEY", "test-typesafe");

  const result = await classifyIntent("Who is the administrator at Homewood?", {
    engine: "typesafe",
    fetcher: (input) => {
      assertStringIncludes(String(input), "api.typesafe.ai");
      return Promise.resolve(
        new Response(
          JSON.stringify(
            buildResponse({
              choice: "directory",
              probabilities: { directory: 0.95, metric: 0.05 },
              confidence: 0.94,
            }),
          ),
          { status: 200 },
        ),
      );
    },
  });

  assertEquals(result.intent, "directory");
  assertEquals(result.confidence, 0.94);

  Deno.env.delete("TYPESAFE_API_KEY");
});

Deno.test("classifyIntent leaves the Anthropic path as the default engine", async () => {
  Deno.env.set("ANTHROPIC_API_KEY", "test-anthropic");
  Deno.env.delete("ROUTER_INTENT_ENGINE");

  const seen: string[] = [];
  const result = await classifyIntent("Hi", {
    fetcher: (input) => {
      seen.push(String(input));
      return Promise.resolve(anthropicOk("chitchat"));
    },
  });

  assertEquals(result.intent, "chitchat");
  assertEquals(seen.some((u) => u.includes("typesafe.ai")), false);
});
