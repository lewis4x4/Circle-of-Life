import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isSupabaseEnvConfigured } from "@/lib/supabase/env";

let browserClient: SupabaseClient<Database> | null = null;

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

  if (typeof window === "undefined") {
    return createBrowserClient<Database>(supabaseUrl, supabaseKey, { isSingleton: false });
  }

  browserClient ??= createBrowserClient<Database>(supabaseUrl, supabaseKey, { isSingleton: true });
  return browserClient;
}

export function isSupabaseAuthLockStealError(error: unknown): error is Error {
  return error instanceof Error && error.message.includes("was released because another request stole it");
}

export async function withSupabaseAuthLockRetry<T>(
  operation: () => Promise<T>,
  {
    retries = 1,
    delayMs = 150,
  }: {
    retries?: number;
    delayMs?: number;
  } = {},
): Promise<T> {
  let attempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isSupabaseAuthLockStealError(error) || attempt >= retries) {
        throw error;
      }
      attempt += 1;
      await new Promise((resolve) => {
        window.setTimeout(resolve, delayMs * attempt);
      });
    }
  }
}
