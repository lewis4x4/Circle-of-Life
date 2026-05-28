"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  orgName: string | null;
  fullName: string | null;
  avatarUrl: string | null;
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
  const [orgName, setOrgName] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [userRes, sessionRes] = await Promise.all([
        withSupabaseAuthLockRetry(() => supabase.auth.getUser()),
        withSupabaseAuthLockRetry(() => supabase.auth.getSession()),
      ]);
      const user = userRes.data.user;
      const session = sessionRes.data.session;

      setUser(user ?? null);
      setSession(session ?? null);

      if (!user) {
        setAppRole("facility_admin");
        setOrganizationId(null);
        setOrgName(null);
        setFullName(null);
        setAvatarUrl(null);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("user_profiles")
        .select("app_role, organization_id, full_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) {
        const errObj = profileError as unknown as Record<string, unknown>;
        console.error("[HavenAuth] user_profiles query failed", {
          message: profileError.message,
          code: errObj.code,
          hint: errObj.hint,
          userId: user.id,
        });
      }

      const organizationIdFromProfile = (profile?.organization_id as string | null | undefined) ?? null;
      let organizationName: string | null = null;

      if (organizationIdFromProfile) {
        const { data: organization, error: organizationError } = await supabase
          .from("organizations")
          .select("name")
          .eq("id", organizationIdFromProfile)
          .maybeSingle();

        if (organizationError) {
          const errObj = organizationError as unknown as Record<string, unknown>;
          console.error("[HavenAuth] organizations query failed", {
            message: organizationError.message,
            code: errObj.code,
            hint: errObj.hint,
            organizationId: organizationIdFromProfile,
          });
        } else {
          organizationName = (organization?.name as string | null | undefined) ?? null;
        }
      }

      const roleFromMeta = user.app_metadata?.app_role as string | undefined;
      setAppRole((profile?.app_role as string) ?? roleFromMeta ?? "facility_admin");
      setOrganizationId(organizationIdFromProfile);
      setOrgName(organizationName);
      setFullName((profile?.full_name as string | null | undefined) ?? null);
      setAvatarUrl((profile?.avatar_url as string | null | undefined) ?? null);
    } catch (error) {
      console.error("[HavenAuth] Failed to resolve browser session", error);
      setSession(null);
      setUser(null);
      setAppRole("facility_admin");
      setOrganizationId(null);
      setOrgName(null);
      setFullName(null);
      setAvatarUrl(null);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    const safeLoad = async () => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      try {
        await load();
      } finally {
        loadingRef.current = false;
      }
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
      orgName,
      fullName,
      avatarUrl,
      email: user?.email ?? null,
      loading,
      refresh: load,
    }),
    [user, session, appRole, organizationId, orgName, fullName, avatarUrl, loading, load],
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
