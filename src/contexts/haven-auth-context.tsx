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
import { startupMark } from "@/lib/observability/startup-performance";
import type { Database } from "@/types/database";

export type HavenAuthContextValue = {
  user: User | null;
  session: Session | null;
  /** Resolved from migration 326 current actor state; never JWT role metadata. */
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
  // Empty until session/profile hydration resolves — avoids flashing a default
  // role home label (for example Facility Admin) before the real role is known.
  const [appRole, setAppRole] = useState<string>("");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadingRef = useRef(false);
  const loadGenerationRef = useRef(0);

  const load = useCallback(async () => {
    startupMark("auth-start");
    const generation = loadGenerationRef.current;
    setLoading(true);
    try {
      // Derive identity from the locally cached session instead of paying a
      // network round-trip to the auth server (getUser). The auth-lock retry
      // wrapper is preserved for the getSession call.
      const sessionRes = await withSupabaseAuthLockRetry(() => supabase.auth.getSession());
      startupMark("session-ready");
      const session = sessionRes.data.session;
      const user = session?.user ?? null;

      if (generation !== loadGenerationRef.current) return;

      setUser(null);
      setSession(null);
      setAppRole("");

      if (!user) {
        clearClientRoleContext(supabase);
        setAppRole("");
        setOrganizationId(null);
        setOrgName(null);
        setFullName(null);
        setAvatarUrl(null);
        return;
      }

      const { data: actorData, error: actorError } = await supabase.rpc(
        "haven_current_shell_actor" as never,
      );

      if (generation !== loadGenerationRef.current) return;

      startupMark("profile-ready");
      if (actorError) {
        const errObj = actorError as unknown as Record<string, unknown>;
        console.error("[HavenAuth] current actor query failed", {
          message: actorError.message,
          code: errObj.code,
          hint: errObj.hint,
          userId: user.id,
        });
      }
      const actor = actorData as {
        user_id?: unknown;
        organization_id?: unknown;
        app_role?: unknown;
        full_name?: unknown;
        avatar_url?: unknown;
        organization_name?: unknown;
        is_managed?: unknown;
      } | null;
      if (
        actorError ||
        actor?.user_id !== user.id ||
        typeof actor.organization_id !== "string" ||
        typeof actor.app_role !== "string"
      ) {
        clearClientRoleContext(supabase);
        setSession(null);
        setUser(null);
        setAppRole("");
        setOrganizationId(null);
        setOrgName(null);
        setFullName(null);
        setAvatarUrl(null);
        return;
      }

      setUser(user);
      setSession(session ?? null);
      const organizationIdFromProfile = actor.organization_id;
      const resolvedRole = actor.app_role;
      setAppRole(resolvedRole);
      setOrganizationId(organizationIdFromProfile);
      setOrgName(typeof actor.organization_name === "string" ? actor.organization_name : null);
      setFullName(typeof actor.full_name === "string" ? actor.full_name : null);
      setAvatarUrl(typeof actor.avatar_url === "string" ? actor.avatar_url : null);
      if (actor.is_managed !== false) {
        primeClientRoleContext(supabase, {
          userId: user.id,
          organizationId: organizationIdFromProfile,
          appRole: resolvedRole as Database["public"]["Enums"]["app_role"],
        });
      }
    } catch (error) {
      if (generation !== loadGenerationRef.current) return;
      console.error("[HavenAuth] Failed to resolve browser session", error);
      clearClientRoleContext(supabase);
      setSession(null);
      setUser(null);
      setAppRole("");
      setOrganizationId(null);
      setOrgName(null);
      setFullName(null);
      setAvatarUrl(null);
    } finally {
      if (generation === loadGenerationRef.current) {
        startupMark("auth-ready");
        setLoading(false);
      }
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
      startupMark("auth-event");
      loadGenerationRef.current += 1;
      clearClientRoleContext(supabase);
      queueMicrotask(() => {
        void load();
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
