"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";

import { ExecutiveHubNav } from "../executive-hub-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchAdminFacilityOptions } from "@/lib/admin-facilities";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type ScenarioRow = Database["public"]["Tables"]["exec_scenarios"]["Row"] & {
  facilities: { name: string } | null;
};

export default function ExecutiveScenariosPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [rows, setRows] = useState<ScenarioRow[]>([]);
  const [facilityNames, setFacilityNames] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopeFacilityId, setScopeFacilityId] = useState<string>("org");
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
      const [facList, { data, error: qErr }] = await Promise.all([
        fetchAdminFacilityOptions(),
        supabase
          .from("exec_scenarios")
          .select("*, facilities(name)")
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .limit(50),
      ]);
      setFacilityNames(facList.map((f) => ({ id: f.id, name: f.name })));
      if (qErr) throw qErr;
      setRows((data ?? []) as ScenarioRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load scenarios.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createScenario(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setSaving(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");
      const facilityId =
        scopeFacilityId !== "org" && isValidFacilityIdForQuery(scopeFacilityId) ? scopeFacilityId : null;
      const { error: insErr } = await supabase.from("exec_scenarios").insert({
        organization_id: ctx.ctx.organizationId,
        facility_id: facilityId,
        name: n,
        description: description.trim() || null,
        created_by: user.id,
        assumptions: {},
      });
      if (insErr) throw insErr;
      setName("");
      setDescription("");
      setScopeFacilityId("org");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create scenario.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId)) {
      setScopeFacilityId(selectedFacilityId);
    }
  }, [selectedFacilityId]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <ExecutiveHubNav />
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Scenarios
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          What-if assumption bundles for portfolio modeling. Solvers and NLQ links are Enhanced.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      )}

      {!canUse && !loading && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Scenarios are available to organization owners and org admins.
        </p>
      )}

      {canUse && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">New scenario</CardTitle>
            <CardDescription>Organization-wide or scoped to one facility.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={createScenario} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sc-name">Name</Label>
                <Input
                  id="sc-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={200}
                  placeholder="e.g. +3% private-pay rate"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sc-desc">Description (optional)</Label>
                <textarea
                  id="sc-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Notes for your team"
                  className={cn(
                    "min-h-[64px] w-full max-w-2xl rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none",
                    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                    "dark:bg-input/30",
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sc-scope">Scope</Label>
                <select
                  id="sc-scope"
                  value={scopeFacilityId}
                  onChange={(e) => setScopeFacilityId(e.target.value)}
                  className={cn(
                    "h-8 w-full max-w-md rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none",
                    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                    "dark:bg-input/30",
                  )}
                >
                  <option value="org">Organization (all facilities)</option>
                  {facilityNames.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? "Saving…" : "Create scenario"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Saved scenarios</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">No scenarios yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium">{row.name}</div>
                      {row.description && (
                        <div className="text-xs text-slate-500 dark:text-slate-400">{row.description}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.facility_id ? (row.facilities?.name ?? row.facility_id) : "Organization"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-slate-500">
                      {format(new Date(row.updated_at), "MMM d, yyyy p")}
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
