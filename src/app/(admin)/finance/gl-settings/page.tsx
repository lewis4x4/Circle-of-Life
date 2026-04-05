"use client";

import React, { useCallback, useEffect, useState } from "react";

import { FinanceHubNav } from "../finance-hub-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { canMutateFinance, loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import type { Database } from "@/types/database";

type EntityGlSettingsInsert = Database["public"]["Tables"]["entity_gl_settings"]["Insert"];
type EntityGlSettingsUpdate = Database["public"]["Tables"]["entity_gl_settings"]["Update"];

type EntityMini = { id: string; name: string };
type GlMini = { id: string; code: string; name: string };
type SettingsRow = {
  id: string;
  entity_id: string;
  accounts_receivable_id: string | null;
  cash_id: string | null;
  revenue_id: string | null;
};

export default function GlSettingsPage() {
  const supabase = createClient();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof loadFinanceRoleContext>> | null>(null);
  const [entities, setEntities] = useState<EntityMini[]>([]);
  const [entityId, setEntityId] = useState("");
  const [accounts, setAccounts] = useState<GlMini[]>([]);
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [arId, setArId] = useState("");
  const [cashId, setCashId] = useState("");
  const [revenueId, setRevenueId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const c = await loadFinanceRoleContext(supabase);
      setCtx(c);
      if (!c.ok) return;
      const { data: ent } = await supabase
        .from("entities")
        .select("id, name")
        .eq("organization_id", c.ctx.organizationId)
        .is("deleted_at", null)
        .order("name");
      const list = (ent ?? []) as EntityMini[];
      setEntities(list);
      setEntityId((prev) => (prev && list.some((e) => e.id === prev) ? prev : list[0]?.id ?? ""));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadSettings = useCallback(async () => {
    if (!entityId) return;
    const [{ data: accs }, { data: s }] = await Promise.all([
      supabase
        .from("gl_accounts")
        .select("id, code, name")
        .eq("entity_id", entityId)
        .is("deleted_at", null)
        .order("code"),
      supabase
        .from("entity_gl_settings")
        .select("id, entity_id, accounts_receivable_id, cash_id, revenue_id")
        .eq("entity_id", entityId)
        .maybeSingle(),
    ]);
    setAccounts((accs ?? []) as GlMini[]);
    const row = s as SettingsRow | null;
    setSettings(row);
    setArId(row?.accounts_receivable_id ?? "");
    setCashId(row?.cash_id ?? "");
    setRevenueId(row?.revenue_id ?? "");
  }, [supabase, entityId]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function save() {
    if (!ctx?.ok || !entityId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const base: Omit<EntityGlSettingsInsert, "id"> = {
        organization_id: ctx.ctx.organizationId,
        entity_id: entityId,
        accounts_receivable_id: arId || null,
        cash_id: cashId || null,
        revenue_id: revenueId || null,
      };

      if (settings) {
        const { error: uErr } = await supabase
          .from("entity_gl_settings")
          .update(base satisfies EntityGlSettingsUpdate)
          .eq("id", settings.id);
        if (uErr) {
          setError(uErr.message);
          return;
        }
      } else {
        const { error: iErr } = await supabase.from("entity_gl_settings").insert(base);
        if (iErr) {
          setError(iErr.message);
          return;
        }
      }
      setSuccess("GL settings saved.");
      await loadSettings();
    } finally {
      setSaving(false);
    }
  }

  const canWrite = ctx?.ok && canMutateFinance(ctx.ctx.appRole);
  const selectClass = cn(
    "flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950",
  );

  return (
    <div className="space-y-6">
      <FinanceHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">GL settings</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Configure default GL account mappings for billing → ledger posting.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400" role="status">
          {success}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entity</CardTitle>
          <CardDescription>Select the legal entity to configure.</CardDescription>
        </CardHeader>
        <CardContent className="max-w-md">
          <select
            className={selectClass}
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            aria-label="Legal entity"
          >
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !canWrite ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          GL settings are read-only for your role. Owner or org admin can configure.
        </p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          No GL accounts for this entity. Create accounts in Chart of Accounts first.
        </p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Account mappings</CardTitle>
            <CardDescription>
              These accounts are used when posting invoices and payments from billing to the general ledger.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="gl-ar">Accounts receivable</Label>
              <select
                id="gl-ar"
                className={selectClass}
                value={arId}
                onChange={(e) => setArId(e.target.value)}
              >
                <option value="">— none —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="gl-cash">Cash</Label>
              <select
                id="gl-cash"
                className={selectClass}
                value={cashId}
                onChange={(e) => setCashId(e.target.value)}
              >
                <option value="">— none —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="gl-rev">Revenue</Label>
              <select
                id="gl-rev"
                className={selectClass}
                value={revenueId}
                onChange={(e) => setRevenueId(e.target.value)}
              >
                <option value="">— none —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <Button type="button" onClick={() => void save()} disabled={saving}>
                {saving ? "Saving…" : "Save settings"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
