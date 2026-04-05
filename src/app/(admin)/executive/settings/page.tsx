"use client";

import { useCallback, useEffect, useState } from "react";
import { Settings2 } from "lucide-react";

import { ExecutiveHubNav } from "../executive-hub-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import type { Database } from "@/types/database";

type DateRange = Database["public"]["Tables"]["exec_dashboard_configs"]["Row"]["default_date_range"];

const RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: "mtd", label: "Month to date" },
  { value: "qtd", label: "Quarter to date" },
  { value: "ytd", label: "Year to date" },
  { value: "last_30", label: "Last 30 days" },
  { value: "last_90", label: "Last 90 days" },
];

export default function ExecutiveSettingsPage() {
  const supabase = createClient();
  const [range, setRange] = useState<DateRange>("mtd");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSavedOk(false);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setError(ctx.error);
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Sign in required.");
        return;
      }
      const { data, error: qErr } = await supabase
        .from("exec_dashboard_configs")
        .select("id, default_date_range, widgets")
        .eq("organization_id", ctx.ctx.organizationId)
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .maybeSingle();

      if (qErr) {
        setError(qErr.message);
        return;
      }
      if (data?.default_date_range) {
        setRange(data.default_date_range as DateRange);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load settings.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave() {
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setError(ctx.error);
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Sign in required.");
        return;
      }

      const { data: existing, error: findErr } = await supabase
        .from("exec_dashboard_configs")
        .select("id")
        .eq("organization_id", ctx.ctx.organizationId)
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .maybeSingle();

      if (findErr) {
        setError(findErr.message);
        return;
      }

      const now = new Date().toISOString();

      if (existing?.id) {
        const { error: upErr } = await supabase
          .from("exec_dashboard_configs")
          .update({ default_date_range: range, updated_at: now })
          .eq("id", existing.id);
        if (upErr) {
          setError(upErr.message);
          return;
        }
      } else {
        const { error: insErr } = await supabase.from("exec_dashboard_configs").insert({
          organization_id: ctx.ctx.organizationId,
          user_id: user.id,
          default_date_range: range,
          widgets: [],
        });
        if (insErr) {
          setError(insErr.message);
          return;
        }
      }
      setSavedOk(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
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
            Per-user dashboard defaults stored in `exec_dashboard_configs` (widget layout follows in a later slice).
          </p>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {savedOk && (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
          Saved.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Default period</CardTitle>
          <CardDescription>Used when comparing KPIs and snapshots (rolling implementation).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="exec-range">Date range preset</Label>
            <select
              id="exec-range"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
              value={range}
              disabled={loading}
              onChange={(e) => setRange(e.target.value as DateRange)}
            >
              {RANGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <Button type="button" onClick={() => void onSave()} disabled={loading || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
