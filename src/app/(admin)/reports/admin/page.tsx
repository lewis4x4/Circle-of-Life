"use client";

import { useEffect, useState } from "react";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canManageReports, loadReportsRoleContext } from "@/lib/reports/auth";
import { createClient } from "@/lib/supabase/client";

type TemplateRow = {
  id: string;
  name: string;
  slug: string;
  status: string;
  official_template: boolean;
  locked_definition: boolean;
  updated_at: string;
};

export default function ReportsGovernancePage() {
  const supabase = createClient();
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const ctx = await loadReportsRoleContext(supabase);
        if (!ctx.ok) throw new Error(ctx.error);
        setCanManage(canManageReports(ctx.ctx.appRole));
        const { data, error: queryErr } = await supabase
          .from("report_templates")
          .select("id, name, slug, status, official_template, locked_definition, updated_at")
          .is("deleted_at", null)
          .order("updated_at", { ascending: false });
        if (queryErr) throw new Error(queryErr.message);
        if (alive) setRows((data ?? []) as TemplateRow[]);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load governance templates.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [supabase]);

  return (
    <div className="space-y-6">
      <ReportsHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Template governance</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Control official templates, locking, deprecation, and report permissions.
        </p>
      </div>
      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {!canManage && (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
          Governance actions are restricted to owner and org_admin roles.
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Template registry</CardTitle>
          <CardDescription>Official/locked metadata and lifecycle status.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No templates found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>{row.slug}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {row.official_template && <Badge variant="secondary">Official</Badge>}
                        {row.locked_definition && <Badge variant="outline">Locked</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>{row.status}</TableCell>
                    <TableCell>{new Date(row.updated_at).toLocaleString()}</TableCell>
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
