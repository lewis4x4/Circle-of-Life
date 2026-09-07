import { createClient } from "@supabase/supabase-js";
import { drainUserAuthSyncJobs } from "../../src/lib/admin/user-auth-sync";
import type { Database } from "../../src/types/database";

export default async function () {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("User Auth sync environment is not configured");
  const invocationDeadline = AbortSignal.timeout(25000);
  const admin = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([invocationDeadline, AbortSignal.timeout(3000)]) }) },
  });
  const counts = await drainUserAuthSyncJobs(admin, 1);
  console.info("user-auth-sync", counts);
}

export const config = { schedule: "*/5 * * * *" };
