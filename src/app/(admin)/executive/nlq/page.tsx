"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";

import { ExecutiveHubNav } from "../executive-hub-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import type { Database } from "@/types/database";

type NlqRow = Database["public"]["Tables"]["exec_nlq_sessions"]["Row"];

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

export default function ExecutiveNlqPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<NlqRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [canUse, setCanUse] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) {
        setError(ctx.error);
        setRows([]);
        setCanUse(false);
        return;
      }
      const role = ctx.ctx.appRole;
      const allowed = role === "owner" || role === "org_admin";
      setCanUse(allowed);
      if (!allowed) {
        setRows([]);
        return;
      }
      const { data, error: qErr } = await supabase
        .from("exec_nlq_sessions")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(50);
      if (qErr) throw qErr;
      setRows(data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load NLQ sessions.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createSession(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setSaving(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");
      const { error: insErr } = await supabase.from("exec_nlq_sessions").insert({
        organization_id: ctx.ctx.organizationId,
        user_id: user.id,
        created_by: user.id,
        title: t,
        status: "draft",
      });
      if (insErr) throw insErr;
      setTitle("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create session.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <ExecutiveHubNav />
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Natural language queries
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Session log for executive NLQ attempts. Optional links to <code className="text-xs">ai_invocations</code>{" "}
          are populated when an Edge Function or app flow records a model call (Enhanced).
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      )}

      {!canUse && !loading && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          NLQ sessions are available to organization owners and org admins.
        </p>
      )}

      {canUse && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">New session</CardTitle>
            <CardDescription>Add a titled draft; execution pipeline is Enhanced.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createSession} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <Label htmlFor="nlq-title">Title</Label>
                <Input
                  id="nlq-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. AR aging vs last quarter"
                  maxLength={500}
                />
              </div>
              <Button type="submit" disabled={saving || !title.trim()}>
                {saving ? "Saving…" : "Create draft"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent sessions</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">No NLQ sessions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>AI invocation</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.title}</TableCell>
                    <TableCell className="capitalize">{formatStatus(row.status)}</TableCell>
                    <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-300">
                      {row.ai_invocation_id ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-slate-500">
                      {format(new Date(row.created_at), "MMM d, yyyy p")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
