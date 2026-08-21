"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Settings2 } from "lucide-react";

import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { ExecutiveHubNav } from "../executive-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

type DateRange = Database["public"]["Tables"]["exec_dashboard_configs"]["Row"]["default_date_range"];

const RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: "mtd", label: "Month to date" },
  { value: "qtd", label: "Quarter to date" },
  { value: "ytd", label: "Year to date" },
  { value: "last_30", label: "Last 30 days" },
  { value: "last_90", label: "Last 90 days" },
];

export const EXECUTIVE_SETTINGS_LOADING_MESSAGE = "Loading executive settings…";

export default function ExecutiveSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { user, organizationId, loading: authLoading } = useHavenAuth();
  const [range, setRange] = useState<DateRange>("mtd");
  const [fetching, setFetching] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [hasOrgScopedData, setHasOrgScopedData] = useState(false);

  const organizationGapMessage = resolveExecutiveOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData,
  });
  const fetchErrorBannerMessage = resolveExecutiveFetchErrorBannerMessage({
    authLoading,
    fetchError,
  });
  const loading = authLoading || fetching;

  const load = useCallback(async () => {
    if (authLoading) {
      return;
    }

    if (!organizationId) {
      setHasOrgScopedData(false);
      setFetchError(null);
      setSaveError(null);
      setSavedOk(false);
      setFetching(false);
      return;
    }

    if (!user) {
      setHasOrgScopedData(false);
      setFetchError("Sign in required.");
      setSaveError(null);
      setSavedOk(false);
      setFetching(false);
      return;
    }

    setFetching(true);
    setFetchError(null);
    setSaveError(null);
    setSavedOk(false);
    try {
      const { data, error: qErr } = await supabase
        .from("exec_dashboard_configs")
        .select("id, default_date_range, widgets")
        .eq("organization_id", organizationId)
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .maybeSingle();

      if (qErr) {
        setHasOrgScopedData(false);
        setFetchError(qErr.message);
        return;
      }
      if (data?.default_date_range) {
        setRange(data.default_date_range as DateRange);
      }
      setHasOrgScopedData(true);
    } catch (e) {
      setHasOrgScopedData(false);
      setFetchError(e instanceof Error ? e.message : "Unable to load settings.");
    } finally {
      setFetching(false);
    }
  }, [authLoading, supabase, organizationId, user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave() {
    if (!organizationId || !user) {
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    try {
      const { data: existing, error: findErr } = await supabase
        .from("exec_dashboard_configs")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .maybeSingle();

      if (findErr) {
        setSaveError(findErr.message);
        return;
      }

      const now = new Date().toISOString();

      if (existing?.id) {
        const { error: upErr } = await supabase
          .from("exec_dashboard_configs")
          .update({ default_date_range: range, updated_at: now })
          .eq("id", existing.id);
        if (upErr) {
          setSaveError(upErr.message);
          return;
        }
      } else {
        const { error: insErr } = await supabase.from("exec_dashboard_configs").insert({
          organization_id: organizationId,
          user_id: user.id,
          default_date_range: range,
          widgets: [],
        });
        if (insErr) {
          setSaveError(insErr.message);
          return;
        }
      }
      setHasOrgScopedData(true);
      setFetchError(null);
      setSavedOk(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <ExecutiveHubNav />

      <div className="flex items-center gap-3">
        <Settings2 className="h-8 w-8 text-slate-600 dark:text-slate-300" aria-hidden />
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Executive settings</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Personal dashboard date-range defaults — your preset when executive KPI views load.
          </p>
        </div>
      </div>

      {organizationGapMessage ? (
        <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
          <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
        </Card>
      ) : null}

      {fetchErrorBannerMessage ? (
        <AdminLiveDataFallbackNotice message={fetchErrorBannerMessage} onRetry={() => void load()} />
      ) : null}

      {saveError ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {saveError}
        </p>
      ) : null}

      {savedOk ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
          Saved.
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {EXECUTIVE_SETTINGS_LOADING_MESSAGE}
        </p>
      ) : organizationGapMessage ? null : (
        <Card>
          <CardHeader>
            <CardTitle>Default period</CardTitle>
            <CardDescription>Applied when you compare KPIs and snapshots across executive views.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 max-w-md">
            <div className="space-y-2">
              <Label htmlFor="exec-range">Date range preset</Label>
              <select
                id="exec-range"
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                value={range}
                onChange={(e) => setRange(e.target.value as DateRange)}
              >
                {RANGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <Button type="button" onClick={() => void onSave()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
