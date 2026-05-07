"use client";

import { useEffect, useState } from "react";

import { isDemoMode } from "@/lib/demo-mode";

/**
 * Demo UI flag after hydration. The initial render is always `false` so server
 * HTML matches the first client paint; localStorage can then opt out of an
 * env-enabled demo session without a React hydration mismatch.
 */
export function useClientDemoMode(): boolean {
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    // `isDemoMode()` is false during SSR; env + localStorage apply after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration sync; demo uses reload on toggle (no store subscription)
    setDemo(isDemoMode());
  }, []);
  return demo;
}
