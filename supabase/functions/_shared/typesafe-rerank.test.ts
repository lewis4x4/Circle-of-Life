import { assertEquals } from "jsr:@std/assert";

import { rerankWithTypeSafe } from "./typesafe-rerank.ts";
import { rerankEvidence, resolveRerankEngine } from "./kb-rerank.ts";

type Row = { excerpt: string; source_title: string; id: string };

function rows(...ids: string[]): Row[] {
  return ids.map((id) => ({ id, excerpt: `passage ${id}`, source_title: `doc ${id}` }));
}

/** Answers each pair with the score keyed by the passage text it was sent. */
function fakeTypeSafe(scoreById: Record<string, number | "fail">): typeof fetch {
  return (_input, init) => {
    const body = JSON.parse(String((init as RequestInit).body));
    const id = String(body.state.candidate_passage.text).replace("passage ", "");
    const score = scoreById[id];
    if (score === "fail") return Promise.resolve(new Response("x", { status: 500 }));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          model: "jev-latest",
          answers: { answers_the_question: { type: "noul", noul: score } },
        }),
        { status: 200 },
      ),
    );
  };
}

Deno.test("rerankWithTypeSafe orders by probability, not by arrival", async () => {
  const result = await rerankWithTypeSafe("q", rows("a", "b", "c"), {
    typeSafeApiKey: "k",
    fetcher: fakeTypeSafe({ a: 0.11, b: 0.97, c: 0.42 }),
  });

  assertEquals(result?.map((r) => r.id), ["b", "c", "a"]);
});

Deno.test("rerankWithTypeSafe breaks ties on incoming RRF order", async () => {
  const result = await rerankWithTypeSafe("q", rows("a", "b", "c"), {
    typeSafeApiKey: "k",
    fetcher: fakeTypeSafe({ a: 0.5, b: 0.5, c: 0.5 }),
  });

  assertEquals(result?.map((r) => r.id), ["a", "b", "c"]);
});

Deno.test("rerankWithTypeSafe honours topN", async () => {
  const result = await rerankWithTypeSafe("q", rows("a", "b", "c", "d"), {
    typeSafeApiKey: "k",
    topN: 2,
    fetcher: fakeTypeSafe({ a: 0.1, b: 0.2, c: 0.9, d: 0.8 }),
  });

  assertEquals(result?.map((r) => r.id), ["c", "d"]);
});

Deno.test("a few failed pairs sink below every scored one, keeping their order", async () => {
  // 1 of 8 fails — inside tolerance, so the rerank still stands.
  const result = await rerankWithTypeSafe(
    "q",
    rows("a", "b", "c", "d", "e", "f", "g", "h"),
    {
      typeSafeApiKey: "k",
      fetcher: fakeTypeSafe({
        a: 0.1, b: "fail", c: 0.9, d: 0.2, e: 0.3, f: 0.4, g: 0.5, h: 0.6,
      }),
    },
  );

  assertEquals(result?.map((r) => r.id), ["c", "h", "g", "f", "e", "d", "a", "b"]);
});

Deno.test("too many failed pairs abandon the rerank rather than ship a partial one", async () => {
  const warnings: string[] = [];
  const result = await rerankWithTypeSafe("q", rows("a", "b", "c", "d"), {
    typeSafeApiKey: "k",
    onWarn: (msg) => warnings.push(msg),
    fetcher: fakeTypeSafe({ a: 0.9, b: "fail", c: "fail", d: 0.1 }),
  });

  assertEquals(result, null);
  assertEquals(warnings.includes("typesafe_rerank_abandoned"), true);
});

Deno.test("phiSuspected sends nothing at all", async () => {
  let called = false;
  const result = await rerankWithTypeSafe("what does policy say about John Smith", rows("a", "b"), {
    typeSafeApiKey: "k",
    phiSuspected: true,
    fetcher: () => {
      called = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  });

  assertEquals(result, null);
  assertEquals(called, false);
});

Deno.test("no API key declines instead of erroring", async () => {
  Deno.env.delete("TYPESAFE_API_KEY");
  const result = await rerankWithTypeSafe("q", rows("a", "b"), {
    fetcher: () => Promise.reject(new Error("must not be called")),
  });
  assertEquals(result, null);
});

Deno.test("warned failures never carry the upstream body", async () => {
  const metas: Record<string, unknown>[] = [];
  await rerankWithTypeSafe("q", rows("a", "b", "c", "d"), {
    typeSafeApiKey: "k",
    onWarn: (_msg, meta) => {
      if (meta) metas.push(meta);
    },
    fetcher: () =>
      Promise.resolve(new Response("resident Jane Doe in an error body", { status: 500 })),
  });

  assertEquals(metas.length > 0, true);
  for (const meta of metas) {
    assertEquals(JSON.stringify(meta).includes("Jane Doe"), false);
  }
});

// --- Engine selection -------------------------------------------------------

Deno.test("cohere is the default engine", () => {
  Deno.env.delete("KB_RERANK_ENGINE");
  assertEquals(resolveRerankEngine(), "cohere");
  Deno.env.set("KB_RERANK_ENGINE", "typesafe");
  assertEquals(resolveRerankEngine(), "typesafe");
  assertEquals(resolveRerankEngine("cohere"), "cohere");
  Deno.env.delete("KB_RERANK_ENGINE");
});

Deno.test("rerankEvidence falls through to Cohere when TypeSafe declines", async () => {
  Deno.env.delete("TYPESAFE_API_KEY");
  Deno.env.delete("COHERE_API_KEY");
  const warnings: string[] = [];

  // No TypeSafe key -> declines; no Cohere key -> Cohere no-ops to input order.
  const result = await rerankEvidence("q", rows("a", "b", "c"), {
    engine: "typesafe",
    onWarn: (msg) => warnings.push(msg),
  });

  assertEquals(result.map((r) => r.id), ["a", "b", "c"]);
  assertEquals(warnings.includes("kb_rerank_engine_fallback"), true);
});

Deno.test("rerankEvidence does not call TypeSafe when the engine is cohere", async () => {
  Deno.env.delete("COHERE_API_KEY");
  let called = false;
  const result = await rerankEvidence("q", rows("a", "b"), {
    engine: "cohere",
    typeSafeApiKey: "k",
    fetcher: () => {
      called = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  });

  assertEquals(called, false);
  assertEquals(result.map((r) => r.id), ["a", "b"]);
});
