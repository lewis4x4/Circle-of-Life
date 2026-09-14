// deno-lint-ignore no-import-prefix -- repository convention pins the Edge runtime import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { handleStandUpHistoryPublisher } from "./handler.ts";
import { SupabaseHistoryStore } from "./rpc.ts";

const required = (name: string): string => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
};

Deno.serve((req) => {
  const environment = {
    cronSecret: required("STAND_UP_HISTORY_PUBLISHER_CRON_SECRET"),
    ingestUrl: required("FRONT_OFFICE_HISTORY_INGEST_URL"),
    ingestKeyId: required("FRONT_OFFICE_HISTORY_INGEST_KEY_ID"),
    ingestSecret: required("FRONT_OFFICE_HISTORY_INGEST_SECRET"),
  };
  return handleStandUpHistoryPublisher(req, environment, () => {
    const client = createClient(
      required("SUPABASE_URL"),
      required("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    return new SupabaseHistoryStore(
      client,
      required("STAND_UP_ORGANIZATION_ID"),
    );
  });
});
