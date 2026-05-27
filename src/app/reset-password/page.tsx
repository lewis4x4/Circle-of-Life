"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAppRoleFromClaims } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

const INVALID_RESET_LINK_MESSAGE =
  "This password reset link is invalid or has expired. Request a new one from the sign-in page.";

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [sessionReady, setSessionReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordPending, setPasswordPending] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const resolveRouteFromRole = useCallback(async (candidateUser?: Pick<User, "app_metadata" | "user_metadata"> | null) => {
    const candidateRole = candidateUser ? getAppRoleFromClaims(candidateUser) : null;
    if (candidateRole) return getDashboardRouteForRole(candidateRole);

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) return "/admin";

    const role = getAppRoleFromClaims(user);
    return role ? getDashboardRouteForRole(role) : "/admin";
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;

    async function verifyResetSession() {
      if (!isBrowserSupabaseConfigured()) {
        if (!cancelled) {
          setHasSession(false);
          setSessionReady(true);
        }
        return;
      }

      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();
        if (cancelled) return;
        setHasSession(!error && Boolean(session?.user));
      } catch {
        if (!cancelled) setHasSession(false);
      } finally {
        if (!cancelled) setSessionReady(true);
      }
    }

    void verifyResetSession();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(null);

    if (!newPassword || !confirmPassword) {
      setPasswordError("All password fields are required.");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("Password must be at least 8 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation must match.");
      return;
    }

    setPasswordPending(true);
    try {
      const updateResult = await supabase.auth.updateUser({ password: newPassword });
      if (updateResult.error) {
        setPasswordError(updateResult.error.message);
        return;
      }

      toast.success("Password updated");
      const destination = await resolveRouteFromRole(updateResult.data.user ?? null);
      router.replace(destination || "/admin");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Could not update password.");
    } finally {
      setPasswordPending(false);
    }
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-slate-950 font-sans text-slate-100">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/login-bg.png')" }}
      />
      <div className="absolute inset-0 bg-slate-950/55" />
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/70 via-slate-950/55 to-slate-950/85" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:2.8rem_2.8rem]" />

      <header className="relative z-10 flex items-center justify-between px-6 pt-8 sm:px-10 lg:px-16">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/95 text-slate-900 shadow-lg">
            <div className="h-4 w-4 rounded-sm bg-slate-950" />
          </div>
          <span className="font-serif text-2xl tracking-tight text-white drop-shadow-md">Haven</span>
        </div>
        <p className="hidden text-xs uppercase tracking-[0.22em] text-slate-300 sm:block">
          Operations Platform
        </p>
      </header>

      <main className="relative z-10 flex min-h-[calc(100vh-7rem)] items-center justify-center px-6 py-16 sm:px-10">
        <div className="w-full max-w-lg space-y-10">
          <div className="space-y-4 text-center">
            <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight text-white drop-shadow-sm sm:text-6xl">
              Set your <span className="text-emerald-400">new password.</span>
            </h1>
            <p className="mx-auto max-w-md text-base leading-relaxed text-slate-300">
              Choose a new password to finish securing your Haven account.
            </p>
          </div>

          <Card className="border border-white/10 bg-slate-900/70 shadow-2xl backdrop-blur-md">
            <CardContent className="p-7 sm:p-9">
              {!sessionReady ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-300">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying reset link...
                </div>
              ) : !hasSession ? (
                <div className="space-y-5 text-center">
                  <div className="rounded-md border border-amber-700/60 bg-amber-900/25 p-4 text-sm font-medium text-amber-100">
                    {INVALID_RESET_LINK_MESSAGE}
                  </div>
                  <Link
                    href="/login"
                    className="flex h-12 w-full tap-responsive items-center justify-center rounded-md bg-amber-500 font-semibold text-slate-950 hover:bg-amber-400"
                  >
                    Back to sign in
                  </Link>
                </div>
              ) : (
                <form onSubmit={handlePasswordChange} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="new-password" className="font-medium text-slate-200">
                      New password
                    </Label>
                    <Input
                      id="new-password"
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      disabled={passwordPending}
                      className="h-12 border-slate-700 bg-slate-950/60 text-slate-100 placeholder:text-slate-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirm-password" className="font-medium text-slate-200">
                      Confirm new password
                    </Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      disabled={passwordPending}
                      className="h-12 border-slate-700 bg-slate-950/60 text-slate-100 placeholder:text-slate-500"
                    />
                  </div>

                  {passwordError && (
                    <div className="animate-in fade-in slide-in-from-top-1 rounded-md border border-red-700/60 bg-red-900/25 p-3">
                      <p className="text-center text-sm font-medium text-red-200">{passwordError}</p>
                    </div>
                  )}

                  <Button
                    type="submit"
                    className="h-12 w-full tap-responsive bg-amber-500 font-semibold text-slate-950 hover:bg-amber-400"
                    disabled={passwordPending}
                  >
                    {passwordPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Updating password...
                      </>
                    ) : (
                      <>
                        Set new password
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <p className="text-center text-sm text-slate-300">
            Need a new reset link? Return to the sign-in page and request another email.
          </p>
        </div>
      </main>
    </div>
  );
}
