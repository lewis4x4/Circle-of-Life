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
import {
  clearClientRoleContext,
  primeClientRoleContext,
} from "@/lib/auth/client-role-context";
import { createClient, withSupabaseAuthLockRetry } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

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
      // Derive identity from the locally cached session instead of paying a
      // network round-trip to the auth server (getUser). The auth-lock retry
      // wrapper is preserved for the getSession call.
      const sessionRes = await withSupabaseAuthLockRetry(() => supabase.auth.getSession());
      const session = sessionRes.data.session;
      const user = session?.user ?? null;

      setUser(user);
      setSession(session ?? null);

      if (!user) {
        clearClientRoleContext(supabase);
        setAppRole("facility_admin");
        setOrganizationId(null);
        setOrgName(null);
        setFullName(null);
        setAvatarUrl(null);
        return;
      }

      // Single joined select collapses the previous two serial round-trips
      // (user_profiles -> organizations) into one request; org name is read
      // from the embedded `organizations` relation.
      const { data: profile, error: profileError } = await supabase
        .from("user_profiles")
        .select("app_role, organization_id, full_name, avatar_url, organizations(name)")
        .eq("id", user.id)
        .is("deleted_at", null)
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

      const profileOrganizationId =
        (profile?.organization_id as string | null | undefined) ?? null;
      const organizationIdFromProfile =
        profileOrganizationId ??
        (typeof user.app_metadata?.organization_id === "string"
          ? user.app_metadata.organization_id
          : null);
      // PostgREST returns the embedded relation as an object or array depending
      // on cardinality inference; normalize both shapes before reading `name`.
      const embeddedOrg = (profile as { organizations?: unknown } | null)?.organizations;
      const organizationRecord = (Array.isArray(embeddedOrg) ? embeddedOrg[0] : embeddedOrg) as
        | { name?: string | null }
        | null
        | undefined;
      const organizationName: string | null = organizationRecord?.name ?? null;

      const roleFromMeta = user.app_metadata?.app_role as string | undefined;
      const resolvedRole = (profile?.app_role as string) ?? roleFromMeta ?? "facility_admin";
      setAppRole(resolvedRole);
      setOrganizationId(organizationIdFromProfile);
      setOrgName(organizationName);
      setFullName((profile?.full_name as string | null | undefined) ?? null);
      setAvatarUrl((profile?.avatar_url as string | null | undefined) ?? null);
      if (organizationIdFromProfile) {
        primeClientRoleContext(supabase, {
          userId: user.id,
          organizationId: organizationIdFromProfile,
          appRole: resolvedRole as Database["public"]["Enums"]["app_role"],
        });
      }
    } catch (error) {
      console.error("[HavenAuth] Failed to resolve browser session", error);
      clearClientRoleContext(supabase);
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
      clearClientRoleContext(supabase);
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
