/**
 * useAuth — returns the current Supabase user with role metadata.
 * Client-side hook for "use client" components.
 */

"use client";

import { useHavenAuth } from "@/contexts/haven-auth-context";

export function useAuth() {
  const { user } = useHavenAuth();
  return { user };
}
