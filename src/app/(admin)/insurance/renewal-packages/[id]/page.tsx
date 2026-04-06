"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { InsuranceHubNav } from "../../insurance-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  canMutateFinance,
  loadFinanceRoleContext,
} from "@/lib/finance/load-finance-context";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import type { RenewalPackagePayload } from "@/lib/insurance/assemble-renewal-package-payload";
import type { Database } from "@/types/database";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Pkg = Database["public"]["Tables"]["renewal_data_packages"]["Row"] & {
  insurance_policies: { policy_number: string; carrier_name: string } | null;
};

export default function RenewalPackageDetailPage() {
  const params = useParams();
  const rawId = typeof params.id === "string" ? params.id : "";
  const id = UUID_RE.test(rawId) ? rawId : "";
  const supabase = createClient();
  const [row, setRow] = useState<Pkg | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canMutate, setCanMutate] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const ctx = await loadFinanceRoleContext(supabase);
    if (!ctx.ok) {
      setError(ctx.error);
      setLoading(false);
      return;
    }
    setCanMutate(canMutateFinance(ctx.ctx.appRole));

    const { data, error: qErr } = await supabase
      .from("renewal_data_packages")
      .select("*, insurance_policies(policy_number, carrier_name)")
      .eq("id", id)
      .maybeSingle();

    if (qErr || !data) {
      setError(qErr?.message ?? "Package not found.");
      setRow(null);
      setLoading(false);
      return;
    }

    const pkg = data as unknown as Pkg;
    setRow(pkg);
    setDraft(pkg.ai_narrative_draft ?? "");
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function saveDraft() {
    if (!id || !row || !canMutate) return;
    setSaving(true);
    setError(null);
    try {
      const { error: uErr } = await supabase
        .from("renewal_data_packages")
        .update({
          ai_narrative_draft: draft || null,
        })
        .eq("id", id);
      if (uErr) {
        setError(uErr.message);
        return;
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function markReviewed() {
    if (!id || !canMutate) return;
    setSaving(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error: uErr } = await supabase
        .from("renewal_data_packages")
        .update({
          narrative_reviewed_at: new Date().toISOString(),
          narrative_reviewed_by: user?.id ?? null,
        })
        .eq("id", id);
      if (uErr) {
        setError(uErr.message);
        return;
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function markPublished() {
    if (!id || !canMutate) return;
    setSaving(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error: uErr } = await supabase
        .from("renewal_data_packages")
        .update({
          narrative_published_at: new Date().toISOString(),
          narrative_published_by: user?.id ?? null,
        })
        .eq("id", id);
      if (uErr) {
        setError(uErr.message);
        return;
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (!id) {
    return (
      <div className="space-y-6">
        <InsuranceHubNav />
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          Invalid package id.
        </p>
        <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href="/admin/insurance/renewal-packages">
          Back to packages
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <InsuranceHubNav />
        <p className="text-sm text-slate-600 dark:text-slate-400">Loading…</p>
      </div>
    );
  }

  if (error || !row) {
    return (
      <div className="space-y-6">
        <InsuranceHubNav />
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error ?? "Not found."}
        </p>
        <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href="/admin/insurance/renewal-packages">
          Back to packages
        </Link>
      </div>
    );
  }

  const payload = row.payload as unknown as RenewalPackagePayload | null;
  const metrics = payload?.metrics;

  return (
    <div className="space-y-6">
      <InsuranceHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Renewal data package</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {row.insurance_policies?.policy_number ?? "Policy"} · {row.insurance_policies?.carrier_name}
        </p>
        <p className="mt-1 font-mono text-xs text-slate-500">
          {row.period_start} → {row.period_end}
        </p>
      </div>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Underwriting snapshot</CardTitle>
          <CardDescription>Metrics assembled for this period (JSON payload version {payload?.version ?? "—"}).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-2">
          <p>
            <span className="text-slate-500">Active residents:</span> {metrics?.active_residents ?? "—"}
          </p>
          <p>
            <span className="text-slate-500">Incidents in period:</span> {metrics?.incidents_in_period ?? "—"}
          </p>
          <p>
            <span className="text-slate-500">Active staff:</span> {metrics?.active_staff ?? "—"}
          </p>
          <p>
            <span className="text-slate-500">Invoice total (period overlap):</span>{" "}
            {metrics != null ? formatUsdFromCents(metrics.invoice_total_cents) : "—"}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payload (JSON)</CardTitle>
          <CardDescription>Auditable source metrics; treat as internal until narrative is reviewed and published.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-950">
            {JSON.stringify(row.payload, null, 2)}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Narrative</CardTitle>
          <CardDescription>
            AI-assisted text is draft until reviewed. Only owner / org admin may edit (RLS). Publishing is for external-ready
            copy.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="narr">Narrative draft</Label>
            <textarea
              id="narr"
              className={cn(
                "min-h-[140px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
              )}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              readOnly={!canMutate}
              disabled={!canMutate}
            />
          </div>
          {canMutate ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => void saveDraft()} disabled={saving}>
                {saving ? "Saving…" : "Save draft"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void markReviewed()}
                disabled={saving || Boolean(row.narrative_reviewed_at)}
              >
                Mark reviewed
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void markPublished()}
                disabled={saving || Boolean(row.narrative_published_at) || !row.narrative_reviewed_at}
              >
                Mark published
              </Button>
            </div>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-400">View-only: narrative edits require owner or org admin.</p>
          )}
          <div className="text-xs text-slate-500">
            {row.narrative_reviewed_at ? (
              <p>Reviewed {new Date(row.narrative_reviewed_at).toLocaleString()}</p>
            ) : (
              <p>Not reviewed</p>
            )}
            {row.narrative_published_at ? (
              <p>Published {new Date(row.narrative_published_at).toLocaleString()}</p>
            ) : (
              <p>Not published</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href="/admin/insurance/renewal-packages">
        ← Back to packages
      </Link>
    </div>
  );
}
