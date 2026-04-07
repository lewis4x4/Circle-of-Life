"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { ReportsHubNav } from "@/components/reports/reports-hub-nav";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canManageReports, loadReportsRoleContext } from "@/lib/reports/auth";
import { PHASE1_TEMPLATE_SEED } from "@/lib/reports/templates";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type SavedView = {
  id: string;
  name: string;
  template_id: string;
  template_version_id: string;
  sharing_scope: string;
  pinned_template_version: boolean;
  updated_at: string;
  archived_at: string | null;
};

export default function SavedReportsPage() {
  const supabase = createClient();
  const [views, setViews] = useState<SavedView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [name, setName] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState(PHASE1_TEMPLATE_SEED[0]?.slug ?? "");

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
        .from("report_saved_views")
        .select("id, name, template_id, template_version_id, sharing_scope, pinned_template_version, updated_at, archived_at")
        .eq("organization_id", ctx.ctx.organizationId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });
      if (queryErr) throw new Error(queryErr.message);
      setViews((data ?? []) as SavedView[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load saved reports.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const templateNameById = useMemo(() => {
    const m = new Map<string, string>();
    PHASE1_TEMPLATE_SEED.forEach((template) => m.set(template.slug, template.name));
    return m;
  }, []);

  async function onCreate() {
    if (!orgId || !userId) return;
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setError(null);
    const { data: template, error: templateErr } = await supabase
      .from("report_templates")
      .select("id")
      .eq("slug", selectedTemplate)
      .is("deleted_at", null)
      .maybeSingle();
    if (templateErr || !template?.id) {
      setError(templateErr?.message ?? "Template not found.");
      return;
    }
    const { data: version, error: versionErr } = await supabase
      .from("report_template_versions")
      .select("id")
      .eq("template_id", template.id)
      .is("deleted_at", null)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (versionErr || !version?.id) {
      setError(versionErr?.message ?? "Template version not found.");
      return;
    }

    const { error: insertErr } = await supabase.from("report_saved_views").insert({
      organization_id: orgId,
      owner_user_id: userId,
      template_id: template.id,
      template_version_id: version.id,
      sharing_scope: "private",
      name: name.trim(),
      pinned_template_version: true,
    });
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setName("");
    await load();
  }

  async function onArchive(id: string) {
    if (!orgId) return;
    const { error: archiveErr } = await supabase
      .from("report_saved_views")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", orgId);
    if (archiveErr) {
      setError(archiveErr.message);
      return;
    }
    await load();
  }

  return (
    <div className="space-y-6">
      <ReportsHubNav />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Saved reports</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Manage pinned or inheriting variants with role-safe sharing and version awareness.
        </p>
      </div>

      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Create saved variant</CardTitle>
            <CardDescription>Create from template and pin to current version.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-[2fr_1fr_auto]">
            <Input placeholder="Variant name" value={name} onChange={(event) => setName(event.target.value)} />
            <select
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
              value={selectedTemplate}
              onChange={(event) => setSelectedTemplate(event.target.value)}
            >
              {PHASE1_TEMPLATE_SEED.map((template) => (
                <option key={template.slug} value={template.slug}>
                  {template.name}
                </option>
              ))}
            </select>
            <Button onClick={() => void onCreate()}>Save</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">My and shared variants</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading...</p>
          ) : views.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No saved variants yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Sharing</TableHead>
                  <TableHead>Version mode</TableHead>
                  <TableHead>Last updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {views.map((view) => (
                  <TableRow key={view.id}>
                    <TableCell>
                      <div className="font-medium">{view.name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Template: {templateNameById.get(view.template_id) ?? "Mapped template"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{view.sharing_scope}</Badge>
                    </TableCell>
                    <TableCell>
                      {view.pinned_template_version ? (
                        <Badge variant="outline">Pinned</Badge>
                      ) : (
                        <Badge variant="secondary">Inherit updates</Badge>
                      )}
                    </TableCell>
                    <TableCell>{new Date(view.updated_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/admin/reports/run/saved_view/${view.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                          Run
                        </Link>
                        <Button variant="ghost" size="sm" onClick={() => void onArchive(view.id)}>
                          Archive
                        </Button>
                      </div>
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
