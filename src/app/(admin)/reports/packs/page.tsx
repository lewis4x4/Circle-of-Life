"use client";

import { useCallback, useEffect, useState } from "react";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canManageReports, loadReportsRoleContext } from "@/lib/reports/auth";
import { createClient } from "@/lib/supabase/client";

type Pack = {
  id: string;
  name: string;
  category: string;
  official_pack: boolean;
  locked_definition: boolean;
  active: boolean;
  created_at: string;
};

export default function ReportPacksPage() {
  const supabase = createClient();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("operational");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await loadReportsRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      setOrgId(ctx.ctx.organizationId);
      setUserId(ctx.ctx.userId);
      setCanManage(canManageReports(ctx.ctx.appRole));

      const { data, error: queryErr } = await supabase
        .from("report_packs")
        .select("id, name, category, official_pack, locked_definition, active, created_at")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (queryErr) throw new Error(queryErr.message);
      setPacks((data ?? []) as Pack[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load report packs.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreatePack() {
    if (!orgId || !userId) return;
    if (!name.trim()) {
      setError("Pack name is required.");
      return;
    }
    const { error: insertErr } = await supabase.from("report_packs").insert({
      organization_id: orgId,
      name: name.trim(),
      category,
      owner_scope: "organization",
      official_pack: false,
      locked_definition: false,
      active: true,
      created_by: userId,
      updated_by: userId,
    });
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setName("");
    await load();
  }

  async function onCreateSurveyPack() {
    if (!orgId || !userId) return;
    const { error: insertErr } = await supabase.from("report_packs").insert({
      organization_id: orgId,
      name: "Survey Visit Pack",
      description: "One-click survey packet bundle.",
      category: "survey",
      owner_scope: "organization",
      official_pack: true,
      locked_definition: true,
      active: true,
      created_by: userId,
      updated_by: userId,
    });
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    await load();
  }

  return (
    <div className="space-y-6">
      <ReportsHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Report packs</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Curate recurring executive, compliance, and survey-ready report bundles.
        </p>
      </div>
      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Create pack</CardTitle>
            <CardDescription>Start with role-based or event-based bundles.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-[2fr_1fr_auto]">
            <Input placeholder="Pack name (e.g. CEO Weekly Pack)" value={name} onChange={(event) => setName(event.target.value)} />
            <select
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="operational">Operational</option>
              <option value="board">Board</option>
              <option value="survey">Survey</option>
              <option value="compliance">Compliance</option>
            </select>
            <Button onClick={() => void onCreatePack()}>Create</Button>
            <Button variant="outline" onClick={() => void onCreateSurveyPack()}>
              One-click Survey Visit Pack
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pack registry</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>
          ) : packs.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No packs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Controls</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packs.map((pack) => (
                  <TableRow key={pack.id}>
                    <TableCell>{pack.name}</TableCell>
                    <TableCell>{pack.category}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {pack.official_pack && <Badge variant="secondary">Official</Badge>}
                        {pack.locked_definition && <Badge variant="outline">Locked</Badge>}
                        {!pack.active && <Badge variant="outline">Inactive</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-slate-500 dark:text-slate-400">
                      Pack builder enhancements are enabled in governance flows.
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
