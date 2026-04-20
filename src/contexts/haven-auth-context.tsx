"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { createClient, withSupabaseAuthLockRetry } from "@/lib/supabase/client";

export type HavenAuthContextValue = {
  user: User | null;
  session: Session | null;
  /** Resolved from `user_profiles.app_role` when available, else JWT metadata */
  appRole: string;
  organizationId: string | null;
  email: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const HavenAuthContext = createContext<HavenAuthContextValue | null>(null);

export function HavenAuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [appRole, setAppRole] = useState<string>("facility_admin");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { session: s },
      } = await withSupabaseAuthLockRetry(() => supabase.auth.getSession());
      setSession(s ?? null);
      const u = s?.user ?? null;
      setUser(u);

      if (!u) {
        setAppRole("facility_admin");
        setOrganizationId(null);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("user_profiles")
        .select("app_role, organization_id")
        .eq("id", u.id)
        .maybeSingle();

      if (profileError) {
        const errObj = profileError as unknown as Record<string, unknown>;
        console.error("[HavenAuth] user_profiles query failed", {
          message: profileError.message,
          code: errObj.code,
          hint: errObj.hint,
          userId: u.id,
        });
      }

      const roleFromMeta = u.app_metadata?.app_role as string | undefined;
      setAppRole((profile?.app_role as string) ?? roleFromMeta ?? "facility_admin");
      setOrganizationId((profile?.organization_id as string) ?? null);
    } catch (error) {
      console.error("[HavenAuth] Failed to resolve browser session", error);
      setSession(null);
      setUser(null);
      setAppRole("facility_admin");
      setOrganizationId(null);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    const safeLoad = async () => {
      await load();
    };

    queueMicrotask(() => {
      void safeLoad();
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      queueMicrotask(() => {
        void safeLoad();
      });
    });
    return () => subscription.unsubscribe();
  }, [load, supabase]);

  const value = useMemo<HavenAuthContextValue>(
    () => ({
      user,
      session,
      appRole,
      organizationId,
      email: user?.email ?? null,
      loading,
      refresh: load,
    }),
    [user, session, appRole, organizationId, loading, load],
  );

  return <HavenAuthContext.Provider value={value}>{children}</HavenAuthContext.Provider>;
}

export function useHavenAuth(): HavenAuthContextValue {
  const ctx = useContext(HavenAuthContext);
  if (!ctx) {
    throw new Error("useHavenAuth must be used within HavenAuthProvider");
  }
  return ctx;
}
