"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { FinanceHubNav } from "@/app/(admin)/finance/finance-hub-nav";
import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import type { EntityMini } from "@/lib/finance/load-trial-balance-data";
import {
  loadPostingRulesData,
  type GlMini,
  type RuleRow,
} from "@/lib/finance/load-posting-rules-data";

const EVENT_PRESETS = [
  { value: "invoice", label: "invoice — recognize revenue (debit AR, credit revenue)" },
  { value: "payment", label: "payment — cash receipt (debit cash, credit AR)" },
] as const;

type PostingRulesPageClientProps = {
  initialEntities: EntityMini[];
  initialEntityId: string;
  initialAccounts: GlMini[];
  initialRules: RuleRow[];
  initialOrgId: string | null;
  initialCanMutate: boolean;
  initialError: string | null;
  initialReady: boolean;
};

export default function GlPostingRulesPageClient({
  initialEntities,
  initialEntityId,
  initialAccounts,
  initialRules,
  initialOrgId,
  initialCanMutate,
  initialError,
  initialReady,
}: PostingRulesPageClientProps) {
  const supabase = createClient();
  const initialLoadEntityRef = useRef(initialEntityId);
  const [entities] = useState<EntityMini[]>(initialEntities);
  const [entityId, setEntityId] = useState(initialEntityId);
  const [accounts, setAccounts] = useState<GlMini[]>(initialAccounts);
  const [rules, setRules] = useState<RuleRow[]>(initialRules);
  const [orgId] = useState<string | null>(initialOrgId);
  const [canMutate] = useState(initialCanMutate);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [ready] = useState(initialReady);

  const [eventType, setEventType] = useState("invoice");
  const [debitId, setDebitId] = useState("");
  const [creditId, setCreditId] = useState("");

  const refreshEntityData = useCallback(async (nextEntityId: string) => {
    if (!nextEntityId || !orgId || !canMutate) {
      setRules([]);
      setAccounts([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await loadPostingRulesData(supabase, orgId, nextEntityId);
      setAccounts(data.accounts);
      setRules(data.rules);
      return data;
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Failed to load posting rules.");
      setRules([]);
      setAccounts([]);
      return null;
    } finally {
      setLoading(false);
    }
  }, [canMutate, orgId, supabase]);

  useEffect(() => {
    if (!ready || !canMutate || !entityId || !orgId) return;
    if (entityId === initialLoadEntityRef.current) {
      initialLoadEntityRef.current = "";
      return;
    }
    void refreshEntityData(entityId);
  }, [ready, canMutate, entityId, orgId, refreshEntityData]);

  function accountLabel(id: string): string {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.code} — ${a.name}` : id.slice(0, 8) + "…";
  }

  async function addRule() {
    if (!canMutate || !orgId || !entityId || !debitId || !creditId || !eventType.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { error: insErr } = await supabase.from("gl_posting_rules").insert({
        organization_id: orgId,
        entity_id: entityId,
        event_type: eventType.trim(),
        debit_gl_account_id: debitId,
        credit_gl_account_id: creditId,
        is_active: true,
      });
      if (insErr) {
        setError(insErr.message);
        return;
      }
      await refreshEntityData(entityId);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(rule: RuleRow, next: boolean) {
    if (!canMutate) return;
    setSaving(true);
    setError(null);
    try {
      const { error: uErr } = await supabase.from("gl_posting_rules").update({ is_active: next }).eq("id", rule.id);
      if (uErr) {
        setError(uErr.message);
        return;
      }
      await refreshEntityData(entityId);
    } finally {
      setSaving(false);
    }
  }

  async function removeRule(rule: RuleRow) {
    if (!canMutate) return;
    setSaving(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      const { error: uErr } = await supabase.from("gl_posting_rules").update({ deleted_at: now }).eq("id", rule.id);
      if (uErr) {
        setError(uErr.message);
        return;
      }
      await refreshEntityData(entityId);
    } finally {
      setSaving(false);
    }
  }

  const selectClass =
    "h-9 min-w-[200px] rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none dark:bg-input/30";

  return (
    <div className="space-y-6">
      <FinanceHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">GL posting rules</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Map billing event types to debit and credit GL accounts per legal entity (Module 17 Enhanced). Posting an
          invoice or payment to the GL uses an <strong>active</strong> rule for this entity when present; otherwise
          Finance → GL Settings (AR, revenue, cash).
        </p>
      </div>

      {!canMutate && ready ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Restricted</CardTitle>
            <CardDescription>
              Posting rules are visible only to owner and org admin accounts (RLS). Facility finance users should use
              chart of accounts and ledger in read-only mode.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {error ? <AdminLiveDataFallbackNotice message={error} onRetry={() => void refreshEntityData(entityId)} /> : null}

      {canMutate ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Filters</CardTitle>
              <CardDescription>Select an entity to view and edit its posting rules.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="ent">Entity</Label>
                <select
                  id="ent"
                  className={selectClass}
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add rule</CardTitle>
              <CardDescription>
                Presets match <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">invoice</code> and{" "}
                <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">payment</code> sources. You can
                type a custom event key for future integrations.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="ev">Event type</Label>
                  <select
                    id="ev"
                    className={selectClass}
                    value={EVENT_PRESETS.some((p) => p.value === eventType) ? eventType : "__custom__"}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "__custom__") setEventType("");
                      else setEventType(v);
                    }}
                  >
                    {EVENT_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                    <option value="__custom__">Custom…</option>
                  </select>
                </div>
                {!EVENT_PRESETS.some((p) => p.value === eventType) ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="evc">Custom key</Label>
                    <input
                      id="evc"
                      className="h-9 min-w-[180px] rounded-md border border-input bg-transparent px-3 text-sm shadow-xs dark:bg-input/30"
                      value={eventType}
                      onChange={(e) => setEventType(e.target.value)}
                      placeholder="e.g. vendor_payment"
                    />
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <Label htmlFor="db">Debit account</Label>
                  <select
                    id="db"
                    className={selectClass}
                    value={debitId}
                    onChange={(e) => setDebitId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cr">Credit account</Label>
                  <select
                    id="cr"
                    className={selectClass}
                    value={creditId}
                    onChange={(e) => setCreditId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void addRule()}
                  disabled={saving || !debitId || !creditId || !eventType.trim() || accounts.length === 0}
                >
                  {saving ? "Saving…" : "Add rule"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rules</CardTitle>
              <CardDescription>
                {loading ? "Loading…" : `${rules.length} active rule row(s). Deactivate instead of delete if you need history.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {accounts.length === 0 ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Add chart of accounts for this entity before creating posting rules.
                </p>
              ) : rules.length === 0 && !loading ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">No posting rules yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>Debit</TableHead>
                      <TableHead>Credit</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead className="w-40" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-sm">{r.event_type}</TableCell>
                        <TableCell className="text-sm">{accountLabel(r.debit_gl_account_id)}</TableCell>
                        <TableCell className="text-sm">{accountLabel(r.credit_gl_account_id)}</TableCell>
                        <TableCell>{r.is_active ? "yes" : "no"}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mr-2"
                            disabled={saving}
                            onClick={() => void toggleActive(r, !r.is_active)}
                          >
                            {r.is_active ? "Deactivate" : "Activate"}
                          </Button>
                          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => void removeRule(r)}>
                            Remove
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
