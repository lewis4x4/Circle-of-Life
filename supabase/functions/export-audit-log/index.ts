/** Materialize and retrieve a current-authorized immutable audit CSV snapshot. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { handleAuditExport } from "./handler.ts";

Deno.serve((req) => handleAuditExport(req, (authorization) => createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_ANON_KEY")!,
  { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } },
)));
