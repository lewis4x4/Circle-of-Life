"use client";

import React, { useCallback, useEffect, useState } from "react";

import { FinanceHubNav } from "../finance-hub-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { canMutateFinance, loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import type { Database } from "@/types/database";

type GlAccountRow = Database["public"]["Tables"]["gl_accounts"]["Row"];
type EntityMini = { id: string; name: string };
type AccountType = Database["public"]["Enums"]["gl_account_type"];

export default function ChartOfAccountsPage() {
  const supabase = createClient();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof loadFinanceRoleContext>> | null>(null);
  const [entities, setEntities] = useState<EntityMini[]>([]);
  const [entityId, setEntityId] = useState<string>("");
  const [rows, setRows] = useState<GlAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("asset");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const c = await loadFinanceRoleContext(supabase);
      setCtx(c);
      if (!c.ok) {
        setError(c.error);
        return;
      }
      const { data: ent, error: eErr } = await supabase
        .from("entities")
        .select("id, name")
        .eq("organization_id", c.ctx.organizationId)
        .is("deleted_at", null)
        .order("name");
      if (eErr) {
        setError(eErr.message);
        return;
      }
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

  const loadAccounts = useCallback(async () => {
    if (!entityId) return;
    const { data, error: qErr } = await supabase
      .from("gl_accounts")
      .select("*")
      .eq("entity_id", entityId)
      .is("deleted_at", null)
      .order("code");
    if (qErr) setError(qErr.message);
    else setRows((data ?? []) as GlAccountRow[]);
  }, [supabase, entityId]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  async function addAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!ctx?.ok || !entityId) return;
    if (!canMutateFinance(ctx.ctx.appRole)) return;
    setSaving(true);
    setError(null);
    try {
      const ins: Database["public"]["Tables"]["gl_accounts"]["Insert"] = {
        organization_id: ctx.ctx.organizationId,
        entity_id: entityId,
        code: code.trim(),
        name: name.trim(),
        account_type: accountType,
      };
      const { error: upErr } = await supabase.from("gl_accounts").insert(ins);
      if (upErr) {
        setError(upErr.message);
        return;
      }
      setCode("");
      setName("");
      await loadAccounts();
    } finally {
      setSaving(false);
    }
  }

  const canWrite = ctx?.ok && canMutateFinance(ctx.ctx.appRole);

  return (
    <div className="space-y-6">
      <FinanceHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Chart of accounts</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">GL accounts per legal entity.</p>
      </div>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entity</CardTitle>
          <CardDescription>Select the legal entity whose chart you are viewing.</CardDescription>
        </CardHeader>
        <CardContent className="max-w-md">
          <select
            className={cn(
              "flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950",
            )}
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

      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add account</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addAccount} className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="coa-code">Code</Label>
                <Input id="coa-code" value={code} onChange={(e) => setCode(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="coa-name">Name</Label>
                <Input id="coa-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="coa-type">Type</Label>
                <select
                  id="coa-type"
                  className={cn(
                    "flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950",
                  )}
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as AccountType)}
                >
                  {(["asset", "liability", "equity", "revenue", "expense"] as const).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={saving || !entityId}>
                  {saving ? "Saving…" : "Add"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Chart of accounts is read-only for your role. Owner or org admin can add accounts.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Accounts</CardTitle>
          <CardDescription>{loading ? "Loading…" : `${rows.length} rows`}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">{r.code}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>{r.account_type}</TableCell>
                  <TableCell>{r.is_active ? "yes" : "no"}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && !loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-slate-500">
                    No accounts yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
