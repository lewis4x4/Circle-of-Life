/**
 * Document Intake processor (COL-771, DI-04). Cron: every minute.
 *
 * Claims queued runs and turns each into a proposal: authorized reader
 * (Claude) → code-ranked destinations → Jev where allowed → code checks.
 * Everything that decides lives in `handler.ts`; this file wires the
 * service-role client, env and clock.
 *
 * Auth: `x-cron-secret` must equal env `DOCUMENT_INTAKE_PROCESSOR_SECRET`.
 * Env: ANTHROPIC_API_KEY, TYPESAFE_API_KEY, DOCUMENT_INTAKE_READER_MODEL (optional).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { withTiming } from "../_shared/structured-log.ts";
import { handleProcessorRequest, type ProcessorDb } from "./handler.ts";

Deno.serve(async (req) => {
  const t = withTiming("document-intake-processor");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const db: ProcessorDb = {
    async rpc(fn, args) {
      const { data, error } = await admin.rpc(fn, args);
      return { data, error: error ? { code: error.code, message: error.message } : null };
    },
    async download(bucket, path) {
      const { data, error } = await admin.storage.from(bucket).download(path);
      if (error || !data) return { data: null, error: { message: "download failed" } };
      return { data: new Uint8Array(await data.arrayBuffer()), error: null };
    },
  };
  return await handleProcessorRequest(req, {
    db,
    env: (name) => Deno.env.get(name),
    fetch: (input, init) => fetch(input, init),
    now: () => new Date(),
    log: t.log,
    workerId: `document-intake-processor:${crypto.randomUUID()}`,
  });
});
