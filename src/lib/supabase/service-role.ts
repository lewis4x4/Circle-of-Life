import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

let cachedServiceRoleClient: SupabaseClient<Database> | null = null;

/**
 * Server-only Supabase client with the service role key.
 * Use only in Route Handlers / Server Actions — never import from client components.
 */
export function createServiceRoleClient(): SupabaseClient<Database> {
  if (cachedServiceRoleClient) {
    return cachedServiceRoleClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (server-only)",
    );
  }

  cachedServiceRoleClient = createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedServiceRoleClient;
}

/** Test-only: reset memoized client between cases. */
export function resetServiceRoleClientForTests(): void {
  cachedServiceRoleClient = null;
}
