"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Loader2, ArrowRight } from "lucide-react";

import { loginSchema, type LoginFormData } from "@/lib/validation/auth";
import { createClient } from "@/lib/supabase/client";

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

  const resolveRouteFromRole = useCallback(async () => {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) return null;

    const roleFromAppMetadata = user.app_metadata?.app_role;
    const roleFromUserMetadata = user.user_metadata?.app_role;
    const role = (roleFromAppMetadata ?? roleFromUserMetadata ?? "") as string;

    if (role === "caregiver") return "/caregiver";
    if (role === "family") return "/family";
    return "/admin";
  }, [supabase]);

  useEffect(() => {
    const routeIfAuthenticated = async () => {
      const destination = await resolveRouteFromRole();
      if (!destination) {
        setCheckingSession(false);
        return;
      }
      router.replace(destination);
      router.refresh();
    };

    void routeIfAuthenticated();
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
      setGlobalError("An unexpected system error occurred. Please contact support.");
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
      <div className="relative hidden lg:flex min-h-screen overflow-hidden border-r border-white/10">
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(120deg, rgba(6,15,44,0.82), rgba(4,17,59,0.62)), radial-gradient(70% 70% at 20% 20%, rgba(32,160,146,0.22), rgba(0,0,0,0))",
          }}
        />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.06)_1px,transparent_1px)] bg-[size:2.8rem_2.8rem]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(56,189,248,0.12),transparent_45%),radial-gradient(circle_at_70%_70%,rgba(20,184,166,0.14),transparent_45%)]" />

        <div className="relative z-10 flex h-full flex-col justify-between p-12 xl:p-16">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-white/95 text-slate-900 flex items-center justify-center shadow-lg">
              <div className="h-4 w-4 rounded-sm bg-[#0a192f]" />
            </div>
            <span className="text-2xl font-serif tracking-tight text-slate-100">Haven</span>
          </div>

          <div className="max-w-xl">
            <p className="text-sm uppercase tracking-[0.18em] text-teal-300/90">Secure Care Operations</p>
            <h1 className="mt-6 text-5xl font-display font-semibold leading-tight text-white">
              Welcome back to the command layer for human care.
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-slate-300">
              One platform for resident safety, compliant documentation, staffing coordination, and family confidence.
            </p>
          </div>

          <p className="text-sm text-slate-400">
            &copy; {new Date().getFullYear()} Circle of Life. Protected health information must remain handled per policy.
          </p>
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
                    disabled={form.formState.isSubmitting}
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
