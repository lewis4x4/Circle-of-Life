import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { isSupabaseEnvConfigured } from "@/lib/supabase/env";

export function isBrowserSupabaseConfigured(): boolean {
  return isSupabaseEnvConfigured();
}

export function createClient() {
  // Support both Next.js and legacy Vite Netlify environment variables
  // Fallback to dummy strings for prerendering build passes to prevent instantiation crashes
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://dummy.supabase.co";
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "dummy-key";

  return createBrowserClient<Database>(supabaseUrl, supabaseKey);
}
