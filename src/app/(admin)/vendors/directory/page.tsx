"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { VendorHubNav } from "../vendor-hub-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { canManageVendorMaster } from "@/lib/vendors/vendor-role-helpers";
import type { Database } from "@/types/database";

type VendorRow = Database["public"]["Tables"]["vendors"]["Row"];

export default function VendorDirectoryPage() {
  const supabase = createClient();
  const [rows, setRows] = useState<VendorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof loadFinanceRoleContext>> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const c = await loadFinanceRoleContext(supabase);
    setCtx(c);
    if (!c.ok) {
      setRows([]);
      setLoadError(c.error);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("vendors")
      .select("*")
      .eq("organization_id", c.ctx.organizationId)
      .is("deleted_at", null)
      .order("name");
    if (error) {
      setLoadError(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as VendorRow[]);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const canWrite = ctx?.ok && canManageVendorMaster(ctx.ctx.appRole);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!ctx?.ok || !canWrite || !name.trim()) return;
    setSaving(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from("vendors")
      .insert({
        organization_id: ctx.ctx.organizationId,
        name: name.trim(),
        category: "other",
        status: "active",
      })
      .select("id")
      .single();
    setSaving(false);
    if (error) {
      setLoadError(error.message);
      return;
    }
    setName("");
    await load();
    if (data?.id) {
      window.location.href = `/admin/vendors/${data.id}`;
    }
  }

  return (
    <div className="space-y-6">
      <VendorHubNav />
      {loadError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {loadError}
        </p>
      )}

      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Vendor directory</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">Searchable vendor master for your organization.</p>
      </div>

      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Register vendor</CardTitle>
            <CardDescription>Creates a vendor record; link facilities on the vendor profile.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onCreate} className="flex max-w-md flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="vendor-name">Name</Label>
                <Input
                  id="vendor-name"
                  value={name}
                  onChange={(ev) => setName(ev.target.value)}
                  placeholder="e.g. Regional Linen Services"
                  required
                />
              </div>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? "Saving…" : "Create"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vendors</CardTitle>
          <CardDescription>{loading ? "Loading…" : `${rows.length} vendor(s)`}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Category</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className="border-b border-slate-100 dark:border-slate-900">
                  <td className="py-2 pr-4">
                    <Link className="text-primary underline-offset-4 hover:underline" href={`/admin/vendors/${v.id}`}>
                      {v.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 capitalize text-slate-600 dark:text-slate-400">{v.category}</td>
                  <td className="py-2 capitalize text-slate-600 dark:text-slate-400">{v.status}</td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-6 text-slate-500">
                    No vendors yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
