/**
 * useAuth — returns the current Supabase user with role metadata.
 * Client-side hook for "use client" components.
 */

"use client";

import { useMemo, useState, useEffect } from "react";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export function useAuth() {
  const supabase = useMemo(() => (isBrowserSupabaseConfigured() ? createClient() : null), []);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  return { user };
}
