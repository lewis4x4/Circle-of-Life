"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { VendorHubNav } from "../vendor-hub-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { canManageVendorMaster } from "@/lib/vendors/vendor-role-helpers";
import {
  VENDOR_DIRECTORY_LIST_SELECT,
  VENDOR_HUB_LIST_LIMIT,
} from "@/lib/admin/hub-list-limits";
import type { Database } from "@/types/database";

type VendorRow = Database["public"]["Tables"]["vendors"]["Row"];

export default function VendorDirectoryPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  // Identity comes from the app-wide auth provider instead of a per-page
  // duplicate auth/profile lookup.
  const { organizationId, appRole, loading: authLoading } = useHavenAuth();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const {
    data: rows = [],
    isPending,
    error,
  } = useQuery({
    queryKey: ["vendors", "directory", organizationId],
    enabled: !!organizationId,
    queryFn: async (): Promise<VendorRow[]> => {
      const { data, error } = await supabase
        .from("vendors")
        .select(VENDOR_DIRECTORY_LIST_SELECT)
        .eq("organization_id", organizationId as string)
        .is("deleted_at", null)
        .order("name")
        .limit(VENDOR_HUB_LIST_LIMIT);
      if (error) throw new Error(error.message);
      return (data ?? []) as VendorRow[];
    },
  });

  const loading = authLoading || isPending;
  const loadError =
    !authLoading && !organizationId
      ? "Organization missing on profile."
      : createError
        ? createError
        : error
          ? error.message
          : null;

  const canWrite =
    !!organizationId && canManageVendorMaster(appRole as Database["public"]["Enums"]["app_role"]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!organizationId || !canWrite || !name.trim()) return;
    setSaving(true);
    setCreateError(null);
    const { data, error } = await supabase
      .from("vendors")
      .insert({
        organization_id: organizationId,
        name: name.trim(),
        category: "other",
        status: "active",
      })
      .select("id")
      .single();
    setSaving(false);
    if (error) {
      setCreateError(error.message);
      return;
    }
    setName("");
    await queryClient.invalidateQueries({ queryKey: ["vendors", "directory", organizationId] });
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
