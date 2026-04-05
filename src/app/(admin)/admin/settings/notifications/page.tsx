"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BellRing, Send } from "lucide-react";

import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import {
  getVapidPublicKeyBytes,
  invokeDispatchPushTest,
  subscribePushAndSave,
} from "@/lib/push-notifications";
import { createClient } from "@/lib/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function AdminNotificationsSettingsPage() {
  const supabase = createClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [pushSupported, setPushSupported] = useState(false);
  const [vapidConfigured, setVapidConfigured] = useState(false);

  useEffect(() => {
    setPushSupported(
      typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window,
    );
    setVapidConfigured(!!getVapidPublicKeyBytes());
  }, []);

  useEffect(() => {
    void (async () => {
      const ctx = await loadFinanceRoleContext(supabase);
      setRole(ctx.ok ? ctx.ctx.appRole : null);
    })();
  }, [supabase]);

  const onSubscribe = useCallback(async () => {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setErr(ctx.error);
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setErr("Sign in required.");
        return;
      }
      const result = await subscribePushAndSave({
        supabase,
        organizationId: ctx.ctx.organizationId,
        userId: user.id,
      });
      if (!result.ok) {
        setErr(result.error);
        return;
      }
      setMsg("Browser subscribed — subscription saved for this device.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Subscribe failed.");
    } finally {
      setBusy(false);
    }
  }, [supabase]);

  const onTestDispatch = useCallback(async () => {
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setErr(ctx.error);
        return;
      }
      if (!["owner", "org_admin"].includes(ctx.ctx.appRole)) {
        setErr("Only owner or org admin can send a test push from this screen.");
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setErr("Session expired.");
        return;
      }
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
      const anonKey =
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "";
      if (!supabaseUrl || !anonKey) {
        setErr("Supabase is not configured.");
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setErr("Sign in required.");
        return;
      }
      const result = await invokeDispatchPushTest({
        supabaseUrl,
        anonKey,
        accessToken: session.access_token,
        userId: user.id,
        title: "Haven test",
        body: "Push pipeline is working.",
      });
      if (!result.ok) {
        setErr(result.message);
        return;
      }
      setMsg(`Dispatch sent — ${JSON.stringify(result.json)}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Dispatch failed.");
    } finally {
      setBusy(false);
    }
  }, [supabase]);

  const canDispatch = role === "owner" || role === "org_admin";

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-6">
      <div>
        <Link
          href="/admin"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mb-2 -ml-2 gap-1")}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Dashboard
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900 dark:text-white">
          <BellRing className="h-7 w-7 text-slate-600 dark:text-slate-300" aria-hidden />
          Notifications
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Enable Web Push for this browser and verify the deployed `dispatch-push` function.
        </p>
      </div>

      {err && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {err}
        </p>
      )}
      {msg && (
        <p className="rounded-lg border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
          {msg}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Web Push</CardTitle>
          <CardDescription>
            Requires HTTPS (or localhost), user gesture, and VAPID keys configured for the project. Edge Function
            secrets: VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!pushSupported && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              This browser does not support service workers or push messaging.
            </p>
          )}
          {!vapidConfigured && (
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Set NEXT_PUBLIC_VAPID_PUBLIC_KEY in the app environment (public key only; matches server VAPID).
            </p>
          )}
          <Button
            type="button"
            onClick={() => void onSubscribe()}
            disabled={busy || !pushSupported || !vapidConfigured}
            className="gap-2"
          >
            <BellRing className="h-4 w-4" aria-hidden />
            {busy ? "Working…" : "Enable notifications on this device"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Test dispatch</CardTitle>
          <CardDescription>
            Sends a notification through the `dispatch-push` Edge Function to your saved subscriptions (owner / org
            admin only).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void onTestDispatch()}
            disabled={busy || !canDispatch}
            className="gap-2"
          >
            <Send className="h-4 w-4" aria-hidden />
            Send test to my devices
          </Button>
          {!canDispatch && role !== null && (
            <p className="mt-2 text-sm text-slate-500">Ask an owner or org admin to run a test dispatch.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
