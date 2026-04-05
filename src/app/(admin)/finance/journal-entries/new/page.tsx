"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useState } from "react";

import { FinanceHubNav } from "../../finance-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { parseDollarsToCents } from "@/lib/finance/format-cents";
import { canMutateFinance, loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type EntityMini = { id: string; name: string };
type FacilityMini = { id: string; name: string; entity_id: string };
type GlMini = { id: string; code: string; name: string };

type LineForm = {
  gl_account_id: string;
  debit: string;
  credit: string;
};

export default function NewJournalEntryPage() {
  const router = useRouter();
  const supabase = createClient();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof loadFinanceRoleContext>> | null>(null);
  const [entities, setEntities] = useState<EntityMini[]>([]);
  const [facilities, setFacilities] = useState<FacilityMini[]>([]);
  const [accounts, setAccounts] = useState<GlMini[]>([]);
  const [entityId, setEntityId] = useState("");
  const [facilityId, setFacilityId] = useState<string>("");
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<LineForm[]>([
    { gl_account_id: "", debit: "", credit: "" },
    { gl_account_id: "", debit: "", credit: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const c = await loadFinanceRoleContext(supabase);
    setCtx(c);
    if (!c.ok) return;
    const [{ data: ent }, { data: fac }] = await Promise.all([
      supabase
        .from("entities")
        .select("id, name")
        .eq("organization_id", c.ctx.organizationId)
        .is("deleted_at", null)
        .order("name"),
      supabase
        .from("facilities")
        .select("id, name, entity_id")
        .eq("organization_id", c.ctx.organizationId)
        .is("deleted_at", null)
        .order("name"),
    ]);
    setEntities((ent ?? []) as EntityMini[]);
    setFacilities((fac ?? []) as FacilityMini[]);
    const firstE = (ent ?? [])[0] as EntityMini | undefined;
    if (firstE) setEntityId((prev) => prev || firstE.id);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadAccounts = useCallback(async () => {
    if (!entityId) return;
    const { data } = await supabase
      .from("gl_accounts")
      .select("id, code, name")
      .eq("entity_id", entityId)
      .is("deleted_at", null)
      .order("code");
    setAccounts((data ?? []) as GlMini[]);
  }, [supabase, entityId]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  function setLine(i: number, patch: Partial<LineForm>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, { gl_account_id: "", debit: "", credit: "" }]);
  }

  async function saveDraft() {
    if (!ctx?.ok || !canMutateFinance(ctx.ctx.appRole)) return;
    setBusy(true);
    setError(null);
    try {
      const orgId = ctx.ctx.organizationId;
      const parsedLines = lines
        .map((l, idx) => {
          const dc = parseDollarsToCents(l.debit);
          const cc = parseDollarsToCents(l.credit);
          return {
            line_number: idx + 1,
            gl_account_id: l.gl_account_id,
            debit_cents: dc && dc > 0 ? dc : 0,
            credit_cents: cc && cc > 0 ? cc : 0,
          };
        })
        .filter((l) => l.gl_account_id && (l.debit_cents > 0 || l.credit_cents > 0));

      if (parsedLines.length < 2) {
        setError("Add at least two lines with accounts and a debit or credit amount.");
        return;
      }

      const ins: Database["public"]["Tables"]["journal_entries"]["Insert"] = {
        organization_id: orgId,
        entity_id: entityId,
        facility_id: facilityId || null,
        entry_date: entryDate,
        memo: memo.trim() || null,
        status: "draft",
        source_type: "manual",
      };

      const { data: je, error: jeErr } = await supabase.from("journal_entries").insert(ins).select("id").single();
      if (jeErr || !je) {
        setError(jeErr?.message ?? "Insert failed");
        return;
      }
      const jid = je.id as string;

      const lineRows: Database["public"]["Tables"]["journal_entry_lines"]["Insert"][] = parsedLines.map((l) => ({
        journal_entry_id: jid,
        organization_id: orgId,
        gl_account_id: l.gl_account_id,
        line_number: l.line_number,
        debit_cents: l.debit_cents,
        credit_cents: l.credit_cents,
      }));

      const { error: lErr } = await supabase.from("journal_entry_lines").insert(lineRows);
      if (lErr) {
        setError(lErr.message);
        return;
      }

      router.push(`/admin/finance/journal-entries/${jid}`);
    } finally {
      setBusy(false);
    }
  }

  if (ctx && ctx.ok && !canMutateFinance(ctx.ctx.appRole)) {
    return (
      <div className="space-y-6">
        <FinanceHubNav />
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Your role can view journal entries but not create them.{" "}
          <Link className="text-primary underline" href="/admin/finance/journal-entries">
            Back to list
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <FinanceHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">New journal entry</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Creates a draft with lines (owner / org admin).</p>
      </div>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Header</CardTitle>
          <CardDescription>Entity and optional facility scope.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="je-entity">Entity</Label>
            <select
              id="je-entity"
              className={cn(
                "flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950",
              )}
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            >
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="je-fac">Facility (optional)</Label>
            <select
              id="je-fac"
              className={cn(
                "flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950",
              )}
              value={facilityId}
              onChange={(e) => setFacilityId(e.target.value)}
            >
              <option value="">Entity-level (no facility)</option>
              {facilities.filter((f) => f.entity_id === entityId).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="je-date">Entry date</Label>
            <Input id="je-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="je-memo">Memo</Label>
            <Input id="je-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lines</CardTitle>
          <CardDescription>Each line is debit XOR credit (USD). Minimum two lines.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {lines.map((line, i) => (
            <div key={i} className="grid gap-2 md:grid-cols-4 md:items-end">
              <div className="space-y-1 md:col-span-2">
                <Label>Account</Label>
                <select
                  className={cn(
                    "flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950",
                  )}
                  value={line.gl_account_id}
                  onChange={(e) => setLine(i, { gl_account_id: e.target.value })}
                >
                  <option value="">Select…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Debit $</Label>
                <Input
                  inputMode="decimal"
                  value={line.debit}
                  onChange={(e) => setLine(i, { debit: e.target.value, credit: "" })}
                />
              </div>
              <div className="space-y-1">
                <Label>Credit $</Label>
                <Input
                  inputMode="decimal"
                  value={line.credit}
                  onChange={(e) => setLine(i, { credit: e.target.value, debit: "" })}
                />
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            Add line
          </Button>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="button" onClick={() => void saveDraft()} disabled={busy}>
          {busy ? "Saving…" : "Save draft"}
        </Button>
        <Link className={cn(buttonVariants({ variant: "outline" }))} href="/admin/finance/journal-entries">
          Cancel
        </Link>
      </div>
    </div>
  );
}
