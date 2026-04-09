"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, PlugZap } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Status = {
  googleOAuthEnvConfigured: boolean;
  stateSecretConfigured: boolean;
  yelpFusionConfigured: boolean;
  connected: boolean;
  connectedAt: string | null;
  canManage: boolean;
};

const ERROR_LABELS: Record<string, string> = {
  missing_code_or_state: "Google did not return a complete authorization response. Try again.",
  invalid_state: "This sign-in link expired or was invalid. Start Connect again.",
  session_mismatch: "Your session changed during sign-in. Try Connect again.",
  token_exchange_failed: "Google rejected the token exchange. Check client ID, secret, and redirect URI.",
  no_refresh_token_retry_consent: "No refresh token returned. Revoke app access in Google Account and connect again with consent.",
  server_misconfigured: "Server is missing Supabase service role configuration.",
  save_failed: "Could not save credentials. Try again or contact support.",
  access_denied: "Google sign-in was cancelled.",
};

export default function ReputationIntegrationsPage() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncingYelp, setSyncingYelp] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reputation/integrations/status");
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? "Failed to load status");
      }
      setStatus((await res.json()) as Status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const qError = searchParams.get("error");
  const qConnected = searchParams.get("connected");

  async function syncReviews() {
    setSyncing(true);
    setSyncMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/reputation/sync/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = (await res.json()) as {
        error?: string;
        imported?: number;
        accountsProcessed?: number;
        details?: { label: string; inserted: number; fetched: number; error: string | null }[];
      };
      if (!res.ok) {
        throw new Error(j.error ?? "Sync failed");
      }
      const imp = j.imported ?? 0;
      const n = j.accountsProcessed ?? 0;
      setSyncMessage(`Synced ${n} listing(s): ${imp} new review row(s) imported into Reputation (drafts).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function syncYelpReviews() {
    setSyncingYelp(true);
    setSyncMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/reputation/sync/yelp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const j = (await res.json()) as {
        error?: string;
        imported?: number;
        accountsProcessed?: number;
        note?: string;
      };
      if (!res.ok) {
        throw new Error(j.error ?? "Yelp sync failed");
      }
      const imp = j.imported ?? 0;
      const n = j.accountsProcessed ?? 0;
      setSyncMessage(
        `Yelp: ${n} listing(s) processed, ${imp} new draft row(s). ${j.note ?? ""}`.trim(),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Yelp sync failed");
    } finally {
      setSyncingYelp(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/reputation/integrations/google", { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        throw new Error(j.error ?? "Disconnect failed");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <Link
          href="/admin/reputation"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Reputation
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <PlugZap className="h-6 w-6 text-indigo-500" />
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Integrations</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Import public reviews into Haven drafts (owner only). Google uses OAuth; Yelp uses a server API key
            (Fusion — up to 3 excerpts per listing).
          </p>
        </div>
      </div>

      {qConnected === "1" && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
          Google account linked. Refresh tokens are stored server-side only.
        </p>
      )}

      {qError && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          {ERROR_LABELS[qError] ?? `Something went wrong (${qError}).`}
        </p>
      )}

      {syncMessage && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-100">
          {syncMessage}
        </p>
      )}

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Google Business Profile</CardTitle>
          <CardDescription>
            OAuth scope: Business Profile API (read reviews). Only the <strong>organization owner</strong> can
            connect, disconnect, or run import. For automated runs, ops can schedule{" "}
            <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">POST /api/cron/reputation/google-reviews</code>{" "}
            with header <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">x-cron-secret</code> (see{" "}
            <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">REPUTATION_GOOGLE_CRON_SECRET</code>
            ).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : status ? (
            <>
              <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1 list-disc pl-5">
                <li>
                  Env vars set:{" "}
                  <strong>{status.googleOAuthEnvConfigured ? "Yes (client + secret + redirect)" : "No"}</strong>
                </li>
                <li>
                  State signing secret:{" "}
                  <strong>{status.stateSecretConfigured ? "Yes" : "No (REPUTATION_OAUTH_STATE_SECRET)"}</strong>
                </li>
                <li>
                  Status:{" "}
                  <strong>
                    {status.connected
                      ? `Connected${status.connectedAt ? ` · ${status.connectedAt.slice(0, 10)}` : ""}`
                      : "Not connected"}
                  </strong>
                </li>
              </ul>

              {!status.googleOAuthEnvConfigured || !status.stateSecretConfigured ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Configure server env vars (see <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">docs/specs/23-reputation.md</code>{" "}
                  Track D D44) then redeploy. Redirect URI in Google Cloud must match{" "}
                  <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">REPUTATION_GOOGLE_REDIRECT_URI</code>{" "}
                  exactly.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {status.canManage && status.googleOAuthEnvConfigured && status.stateSecretConfigured ? (
                  <a href="/api/reputation/oauth/google" className={cn(buttonVariants({ variant: "default" }))}>
                    Connect Google
                  </a>
                ) : status.canManage ? (
                  <Button type="button" disabled>
                    Connect Google (configure env first)
                  </Button>
                ) : (
                  <Button type="button" variant="secondary" disabled>
                    Only owner can connect
                  </Button>
                )}

                {status.canManage && status.connected ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={syncing}
                    onClick={() => void syncReviews()}
                  >
                    {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Import Google reviews now"}
                  </Button>
                ) : null}

                {status.canManage && status.connected ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={disconnecting}
                    onClick={() => void disconnect()}
                  >
                    {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Disconnect Google"}
                  </Button>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">Could not load integration status.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Yelp (Fusion API)</CardTitle>
          <CardDescription>
            Server-only <strong>YELP_FUSION_API_KEY</strong>. Add a <strong>Yelp</strong> reputation account per
            facility with <strong>External place ID</strong> = Yelp business id. Fusion returns up to{" "}
            <strong>three</strong> review excerpts per import. Only the <strong>owner</strong> can run import.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : status ? (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                API key configured:{" "}
                <strong>{status.yelpFusionConfigured ? "Yes" : "No (set YELP_FUSION_API_KEY)"}</strong>
              </p>
              <div className="flex flex-wrap gap-2">
                {status.canManage && status.yelpFusionConfigured ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={syncingYelp}
                    onClick={() => void syncYelpReviews()}
                  >
                    {syncingYelp ? <Loader2 className="h-4 w-4 animate-spin" /> : "Import Yelp reviews now"}
                  </Button>
                ) : status.canManage ? (
                  <Button type="button" disabled>
                    Import Yelp (configure API key first)
                  </Button>
                ) : (
                  <Button type="button" variant="secondary" disabled>
                    Only owner can import
                  </Button>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">Could not load integration status.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
