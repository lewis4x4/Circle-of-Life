"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Loader2, ArrowRight } from "lucide-react";

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

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [sessionProbeError, setSessionProbeError] = useState<string | null>(null);

  const resolveRouteFromRole = useCallback(async () => {
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

    const roleFromAppMetadata = user.app_metadata?.app_role;
    const roleFromUserMetadata = user.user_metadata?.app_role;
    const role = (roleFromAppMetadata ?? roleFromUserMetadata ?? "") as string;

    if (role === "caregiver") return "/caregiver";
    if (role === "family") return "/family";
    return "/admin";
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;

    const routeIfAuthenticated = async () => {
      if (!isBrowserSupabaseConfigured()) {
        if (!cancelled) {
          setSessionProbeError(
            "Sign-in is not configured. Copy .env.example to .env.local, set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY from your Supabase project (Settings → API), then restart `npm run dev`.",
          );
          setCheckingSession(false);
        }
        return;
      }

      try {
        const destination = await resolveRouteFromRole();
        if (cancelled) return;
        if (!destination) {
          setCheckingSession(false);
          return;
        }
        router.replace(destination);
        router.refresh();
      } catch (e) {
        if (cancelled) return;
        const message =
          e instanceof Error && e.message === "AUTH_NETWORK"
            ? "Cannot reach Supabase (network or URL). Confirm the project is running, NEXT_PUBLIC_SUPABASE_URL is correct, and nothing is blocking the browser. Then restart the dev server."
            : "Could not verify your session. Check your connection and Supabase settings, then refresh this page.";
        setSessionProbeError(message);
        setCheckingSession(false);
      }
    };

    void routeIfAuthenticated();
    return () => {
      cancelled = true;
    };
  }, [resolveRouteFromRole, router]);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(data: LoginFormData) {
    setGlobalError(null);
    if (!isBrowserSupabaseConfigured()) {
      setGlobalError("Supabase environment variables are missing. Configure .env.local and restart the dev server.");
      return;
    }
    try {
      // Execute strict Supabase SSR logic
      const { error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (error) {
        setGlobalError(error.message);
        return;
      }

      const destination = (await resolveRouteFromRole()) ?? "/admin";
      router.push(destination);
      router.refresh();
    } catch {
      setGlobalError(
        "Sign-in request failed to complete. This is usually a network issue or an invalid Supabase URL. Check .env.local and your Supabase project status.",
      );
    }
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-[#050914] flex items-center justify-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          Preparing secure sign in...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#050914] font-sans text-slate-100 lg:grid lg:grid-cols-2">
      <div className="relative hidden lg:flex min-h-screen overflow-hidden border-r border-white/10 flex-col justify-end p-12 xl:p-16">
        {/* Photographic Background Layer */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: "url('/login-bg.png')",
          }}
        />
        
        {/* Gradient overlays to ensure white text readability */}
        <div className="absolute inset-0 bg-slate-950/20 mix-blend-multiply" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#050914] via-[#050914]/80 to-transparent opacity-90" />
        
        {/* Subtle grid pattern for texture */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:2.8rem_2.8rem]" />

        {/* Content */}
        <div className="relative z-10 w-full h-full flex flex-col justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-white/95 text-slate-900 flex items-center justify-center shadow-lg">
              <div className="h-4 w-4 rounded-sm bg-[#0a192f]" />
            </div>
            <span className="text-2xl font-serif tracking-tight text-white drop-shadow-md">Haven</span>
          </div>

          <div className="max-w-xl mt-auto pb-8">
            <h1 className="text-6xl md:text-7xl font-display font-bold leading-[1.05] tracking-tight text-white drop-shadow-sm">
              Elevating <br /><span className="text-emerald-400">Human Care.</span>
            </h1>
            <p className="mt-8 text-lg font-medium leading-relaxed text-slate-200">
              The comprehensive platform for assisted living operators. Streamline your operations from clinical workflows to compliance.
            </p>
          </div>
        </div>
      </div>

      <div className="flex min-h-screen items-center justify-center p-6 sm:p-10 lg:p-14">
        <div className="w-full max-w-md space-y-7">
          <div className="space-y-2 text-center lg:text-left">
            <p className="text-sm uppercase tracking-[0.18em] text-slate-400">Haven Access</p>
            <h2 className="text-4xl font-display font-semibold tracking-tight text-white">
              Sign in
            </h2>
            <p className="text-sm text-slate-400">
              Use your organizational credentials. Your dashboard is selected automatically by role.
            </p>
          </div>

          {sessionProbeError ? (
            <div className="rounded-lg border border-amber-600/50 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
              {sessionProbeError}
            </div>
          ) : null}

          <Card className="border border-white/10 bg-slate-900/65 shadow-2xl backdrop-blur">
            <CardContent className="p-6 sm:p-8">
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
                            placeholder="jane@oakridge.com"
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
                          <button type="button" className="tap-responsive text-xs font-medium text-amber-400 hover:text-amber-300">
                            Forgot password?
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

          <p className="text-center text-sm text-slate-500 lg:text-left">
            Need access? Contact your facility administrator.
          </p>
        </div>
      </div>
    </div>
  );
}
