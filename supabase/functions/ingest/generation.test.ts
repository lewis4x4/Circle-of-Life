import { commitIngestGeneration, failIngestGeneration } from "./generation.ts";
import { CurrentActorError } from "../_shared/current-actor.ts";

const input = { runId: "run-b", chunks: [{ id: "chunk-b" }], summary: "summary", wordCount: 1 };
Deno.test("complete ingest uses one generation command and its matching count receipt", async () => {
  let calls = 0;
  const count = await commitIngestGeneration({ rpc: async (name, args) => {
    calls++;
    if (name !== "commit_kb_ingest_generation" || args.p_run_id !== "run-b" || args.p_chunks !== input.chunks) throw new Error("Unbound mutation");
    return { data: 1, error: null };
  } }, input);
  if (calls !== 1 || count !== 1) throw new Error("Missing durable receipt");
});
for (const code of ["40001", "42501"]) {
  Deno.test(`generation or authorization loss ${code} cannot become provider fallback success`, async () => {
    try {
      await commitIngestGeneration({ rpc: async () => ({ data: null, error: { code } }) }, input);
      throw new Error("Denied command accepted");
    } catch (error) {
      if (!(error instanceof CurrentActorError) || error.status !== 403) throw error;
    }
  });
}
Deno.test("incomplete receipt and database failure never report indexed success", async () => {
  for (const result of [{ data: 0, error: null }, { data: null, error: { code: "23502" } }]) {
    let failed = false;
    try { await commitIngestGeneration({ rpc: async () => result }, input); }
    catch { failed = true; }
    if (!failed) throw new Error("Incomplete generation accepted");
  }
});

Deno.test("provider and commit failures use the generation-bound terminal receipt", async () => {
  let recorded = false;
  await failIngestGeneration({ rpc: async (name, args) => {
    if (name !== "fail_kb_ingest_generation" || args.p_run_id !== "failed-run") throw new Error("Wrong failure command");
    recorded = true;
    return { data: null, error: null };
  } }, "failed-run");
  if (!recorded) throw new Error("Failure was not recorded");
});
