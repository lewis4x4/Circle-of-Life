import { CurrentActorError } from "../_shared/current-actor.ts";

type GenerationClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown; error: { code?: string } | null;
  }>;
};

/** One durable generation command owns replacement and its audit receipt. */
export async function commitIngestGeneration(
  admin: GenerationClient,
  input: { runId: string; chunks: unknown[]; summary: string | null; wordCount: number; markdown?: Record<string, string> },
): Promise<number> {
  const { data, error } = await admin.rpc("commit_kb_ingest_generation", {
    p_run_id: input.runId,
    p_chunks: input.chunks,
    p_summary: input.summary,
    p_word_count: input.wordCount,
    p_markdown: input.markdown ?? null,
  });
  if (error) {
    if (error.code === "40001" || error.code === "42501") throw new CurrentActorError(403, "Forbidden");
    throw new Error("Could not commit the complete document index");
  }
  if (typeof data !== "number" || data !== input.chunks.length) {
    throw new Error("Document index receipt does not match the complete chunk count");
  }
  return data;
}

export async function failIngestGeneration(admin: GenerationClient, runId: string): Promise<void> {
  const { error } = await admin.rpc("fail_kb_ingest_generation", {
    p_run_id: runId, p_error: "ingest_processing_failed",
  });
  if (error) throw new Error("Could not record ingest failure");
}
