"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  hasPendingPasswordChange,
  isChangePasswordExemptPath,
} from "@/lib/auth/must-change-password";

/**
 * Client-side half of the forced-change gate.
 *
 * Reads the Supabase session directly rather than `useHavenAuth`, so it can mount in
 * every route group. The previous version depended on HavenAuthProvider, which
 * (med-tech), (dietary), (family) and (onboarding) never mount — those four shells
 * were unguarded (COL-362). `src/proxy.ts` is the authoritative check; this exists so
 * a client-side navigation does not render a shell for a beat before the server
 * redirect lands.
 */
export function MustChangePasswordGate({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const pathname = usePathname();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let active = true;

    const read = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setPending(Boolean(data.session?.user) && hasPendingPasswordChange(data.session!.user));
      setResolved(true);
    };

    void read();

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setPending(Boolean(session?.user) && hasPendingPasswordChange(session!.user));
      setResolved(true);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [supabase]);

  const blocked = resolved && pending && !isChangePasswordExemptPath(pathname);

  useEffect(() => {
    if (blocked) {
      router.replace("/change-password");
    }
  }, [blocked, router]);

  if (blocked) {
    return null;
  }

  return children;
}
