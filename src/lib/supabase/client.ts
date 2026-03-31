import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'

/** True when real project env is present (not build-time placeholders). */
export function isBrowserSupabaseConfigured(): boolean {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.VITE_SUPABASE_URL?.trim() ||
    "";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.VITE_SUPABASE_ANON_KEY?.trim() ||
    "";
  if (!url || !key) return false;
  if (url.includes("dummy.supabase") || url.includes("YOUR_PROJECT_REF")) return false;
  if (key === "dummy-key" || key.startsWith("your_supabase")) return false;
  return true;
}

export function createClient() {
  // Support both Next.js and legacy Vite Netlify environment variables
  // Fallback to dummy strings for prerendering build passes to prevent instantiation crashes
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://dummy.supabase.co";
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "dummy-key";

  return createBrowserClient<Database>(supabaseUrl, supabaseKey);
}
