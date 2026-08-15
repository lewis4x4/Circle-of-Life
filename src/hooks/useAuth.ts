/** Compatibility facade for the single admin-shell auth context. */

"use client";

import { useHavenAuth } from "@/contexts/haven-auth-context";

export function useAuth() {
  const { user } = useHavenAuth();
  return { user };
}
