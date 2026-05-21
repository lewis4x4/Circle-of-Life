"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Loader2, ArrowRight } from "lucide-react";
import type { User } from "@supabase/supabase-js";

import { getAppRoleFromClaims, isAdminEligibleAppRole, isOnboardingAppRole, isMedTechRole, isDietaryRole } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { loginSchema, type LoginFormData } from "@/lib/validation/auth";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

const SIGN_IN_UNAVAILABLE_MESSAGE =
  "Sign-in is temporarily unavailable. Contact your facility administrator or support.";
const SESSION_VERIFICATION_ERROR_MESSAGE =
  "Could not verify your session. Check your connection, then refresh this page.";

function readSafeNextDestination(): string | null {
  if (typeof window === "undefined") return null;
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  if (next === "/login" || next.startsWith("/login?")) return null;
  return next;
}

function LoginForbiddenNotice() {
  const searchParams = useSearchParams();
  if (searchParams.get("reason") !== "forbidden") return null;
  return (
    <div className="rounded-lg border border-amber-600/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
      You don&apos;t have access to the operations dashboard with this account. Use the family or caregiver
      portal if applicable, or ask an administrator to assign your role.
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [resetNotice, setResetNotice] = useState<string | null>(null);
  const [resetRequesting, setResetRequesting] = useState(false);
  const [sessionProbeError, setSessionProbeError] = useState<string | null>(null);

  const resolveRouteFromRole = useCallback(async (candidateUser?: Pick<User, "app_metadata" | "user_metadata"> | null) => {
    const mapRoleToRoute = (role: ReturnType<typeof getAppRoleFromClaims>) => {
      if (isOnboardingAppRole(role)) return "/onboarding";
      if (role === "nurse") return getDashboardRouteForRole(role);
      if (isMedTechRole(role)) return "/med-tech";
      if (isDietaryRole(role)) return "/dietary";
      if (role === "caregiver" || role === "housekeeper") return getDashboardRouteForRole(role);
      if (role === "family") return "/family";
      if (isAdminEligibleAppRole(role)) return getDashboardRouteForRole(role);
      return null;
    };

    if (candidateUser) {
      const candidateRoute = mapRoleToRoute(getAppRoleFromClaims(candidateUser));
      if (candidateRoute) return candidateRoute;
    }

    let userResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;
    try {
      userResult = await supabase.auth.getUser();
    } catch {
      throw new Error("AUTH_NETWORK");
    }

    const {
      data: { user },
      error: userError,
    } = userResult;

    if (userError) {
      const hint = `${userError.message ?? ""} ${"name" in userError ? String(userError.name) : ""}`.toLowerCase();
      if (
        hint.includes("fetch") ||
        hint.includes("network") ||
        hint.includes("load failed") ||
        hint.includes("failed to send")
      ) {
        throw new Error("AUTH_NETWORK");
      }
      return null;
    }
    if (!user) return null;
    return mapRoleToRoute(getAppRoleFromClaims(user));
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;

    const routeIfAuthenticated = async () => {
      if (!isBrowserSupabaseConfigured()) {
        if (!cancelled) {
          setSessionProbeError(SIGN_IN_UNAVAILABLE_MESSAGE);
        }
        return;
      }

      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        if (cancelled) return;

        if (sessionError) {
          const hint = `${sessionError.message ?? ""} ${"name" in sessionError ? String(sessionError.name) : ""}`.toLowerCase();
          if (
            hint.includes("fetch") ||
            hint.includes("network") ||
            hint.includes("load failed") ||
            hint.includes("failed to send")
          ) {
            throw new Error("AUTH_NETWORK");
          }
          return;
        }

        if (!session?.user) return;

        const destination = await resolveRouteFromRole(session.user);
        if (cancelled || !destination) return;
        router.replace(readSafeNextDestination() ?? destination);
      } catch (e) {
        if (cancelled) return;
        setSessionProbeError(
          e instanceof Error && e.message === "AUTH_NETWORK"
            ? SIGN_IN_UNAVAILABLE_MESSAGE
            : SESSION_VERIFICATION_ERROR_MESSAGE,
        );
      }
    };

    void routeIfAuthenticated();
    return () => {
      cancelled = true;
    };
  }, [resolveRouteFromRole, router, supabase]);
  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(data: LoginFormData) {
    setGlobalError(null);
    setResetNotice(null);
    if (!isBrowserSupabaseConfigured()) {
      setGlobalError(SIGN_IN_UNAVAILABLE_MESSAGE);
      return;
    }
    try {
      // Execute strict Supabase SSR logic
      const {
        data: signInData,
        error,
      } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (error) {
        setGlobalError(error.message);
        return;
      }

      const destination = await resolveRouteFromRole(signInData.user ?? signInData.session?.user ?? null);
      if (!destination) {
        setGlobalError(
          "Your account does not have an operations role assigned in Haven, or your role cannot open the staff dashboard. Contact your administrator.",
        );
        return;
      }
      router.push(readSafeNextDestination() ?? destination);
    } catch {
      setGlobalError(SIGN_IN_UNAVAILABLE_MESSAGE);
    }
  }

  async function requestPasswordReset() {
    setGlobalError(null);
    setResetNotice(null);

    const email = form.getValues("email").trim();
    if (!email) {
      form.setError("email", {
        type: "manual",
        message: "Enter your work email before requesting a reset link.",
      });
      return;
    }

    if (!isBrowserSupabaseConfigured()) {
      setGlobalError(SIGN_IN_UNAVAILABLE_MESSAGE);
      return;
    }

    setResetRequesting(true);
    try {
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login`,
      });
      setResetNotice("If that account exists, a password reset link has been sent.");
    } catch {
      setGlobalError("Unable to request a reset link right now. Contact your facility administrator.");
    } finally {
      setResetRequesting(false);
    }
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#050914] font-sans text-slate-100">
      {/* Full-bleed photographic background */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/login-bg.png')" }}
      />
      {/* Readability overlays */}
      <div className="absolute inset-0 bg-slate-950/55" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#050914]/70 via-[#050914]/55 to-[#050914]/85" />
      {/* Subtle grid texture */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:2.8rem_2.8rem]" />

      {/* Top brand bar */}
      <header className="relative z-10 flex items-center justify-between px-6 pt-8 sm:px-10 lg:px-16">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/95 text-slate-900 shadow-lg">
            <div className="h-4 w-4 rounded-sm bg-[#0a192f]" />
          </div>
          <span className="font-serif text-2xl tracking-tight text-white drop-shadow-md">Haven</span>
        </div>
        <p className="hidden text-xs uppercase tracking-[0.22em] text-slate-300 sm:block">
          Operations Platform
        </p>
      </header>

      {/* Centered hero + form */}
      <main className="relative z-10 flex min-h-[calc(100vh-7rem)] items-center justify-center px-6 py-16 sm:px-10">
        <div className="w-full max-w-lg space-y-10">
          <div className="space-y-4 text-center">
            <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight text-white drop-shadow-sm sm:text-6xl">
              Elevating <span className="text-emerald-400">Human Care.</span>
            </h1>
            <p className="mx-auto max-w-md text-base leading-relaxed text-slate-300">
              The unified platform for assisted living operators — clinical, compliance, and family engagement on one secure layer.
            </p>
          </div>

          <Suspense fallback={null}>
            <LoginForbiddenNotice />
          </Suspense>

          {sessionProbeError ? (
            <div className="rounded-lg border border-amber-600/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
              {sessionProbeError}
            </div>
          ) : null}

          <Card className="border border-white/10 bg-slate-900/70 shadow-2xl backdrop-blur-md">
            <CardContent className="p-7 sm:p-9">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-medium text-slate-200">Work Email</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="name@organization.com"
                            type="email"
                            disabled={form.formState.isSubmitting}
                            className="h-12 border-slate-700 bg-slate-950/60 text-slate-100 placeholder:text-slate-500"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage className="text-xs text-red-300" />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between">
                          <FormLabel className="font-medium text-slate-200">Password</FormLabel>
                          <button
                            type="button"
                            onClick={() => void requestPasswordReset()}
                            disabled={form.formState.isSubmitting || resetRequesting}
                            className="tap-responsive text-xs font-medium text-amber-400 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {resetRequesting ? "Sending..." : "Forgot password?"}
                          </button>
                        </div>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="Enter your password"
                            disabled={form.formState.isSubmitting}
                            className="h-12 border-slate-700 bg-slate-950/60 text-slate-100 placeholder:text-slate-500"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage className="text-xs text-red-300" />
                      </FormItem>
                    )}
                  />

                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input className="h-4 w-4 rounded border-slate-600 bg-slate-950/70" type="checkbox" />
                    Remember me
                  </label>

                  {resetNotice && (
                    <div className="animate-in fade-in slide-in-from-top-1 rounded-md border border-emerald-700/60 bg-emerald-900/25 p-3">
                      <p className="text-center text-sm font-medium text-emerald-100">
                        {resetNotice}
                      </p>
                    </div>
                  )}

                  {globalError && (
                    <div className="animate-in fade-in slide-in-from-top-1 rounded-md border border-red-700/60 bg-red-900/25 p-3">
                      <p className="text-center text-sm font-medium text-red-200">
                        {globalError}
                      </p>
                    </div>
                  )}

                  <Button
                    type="submit"
                    className="h-12 w-full tap-responsive bg-amber-500 font-semibold text-slate-950 hover:bg-amber-400"
                    disabled={form.formState.isSubmitting || !isBrowserSupabaseConfigured()}
                  >
                    {form.formState.isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying credentials...
                      </>
                    ) : (
                      <>
                        Sign In
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          <p className="text-center text-sm text-slate-300">
            Need access? Contact your facility administrator.
          </p>
        </div>
      </main>
    </div>
  );
}
