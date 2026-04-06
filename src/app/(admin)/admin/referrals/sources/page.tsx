"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { ReferralsHubNav } from "../referrals-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

const SOURCE_TYPES = [
  { value: "hospital", label: "Hospital" },
  { value: "agency", label: "Agency" },
  { value: "family", label: "Family" },
  { value: "web", label: "Web" },
  { value: "other", label: "Other" },
] as const;

type SourceRow = {
  id: string;
  name: string;
  source_type: string;
  facility_id: string | null;
  is_active: boolean;
};

export default function AdminReferralSourcesPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();

  const [rows, setRows] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<string>("hospital");
  const [scopeFacility, setScopeFacility] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      return;
    }

    const { data: fac, error: facErr } = await supabase.from("facilities").select("organization_id").eq("id", selectedFacilityId).single();
    if (facErr || !fac?.organization_id) {
      setLoadError("Could not resolve organization for this facility.");
      setRows([]);
      setLoading(false);
      return;
    }

    const { data, error: qErr } = await supabase
      .from("referral_sources")
      .select("id, name, source_type, facility_id, is_active")
      .eq("organization_id", fac.organization_id)
      .is("deleted_at", null)
      .or(`facility_id.is.null,facility_id.eq.${selectedFacilityId}`)
      .order("name");

    if (qErr) {
      setLoadError(qErr.message);
      setRows([]);
    } else {
      setRows((data ?? []) as SourceRow[]);
    }
    setLoading(false);
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setFormError("Select a facility in the header.");
      return;
    }
    const n = name.trim();
    if (!n) {
      setFormError("Name is required.");
      return;
    }

    setSubmitting(true);
    try {
      const { data: fac, error: facErr } = await supabase
        .from("facilities")
        .select("organization_id")
        .eq("id", selectedFacilityId)
        .is("deleted_at", null)
        .maybeSingle();
      if (facErr || !fac?.organization_id) {
        setFormError("Could not resolve organization for this facility.");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setFormError("You must be signed in.");
        return;
      }

      const payload = {
        organization_id: fac.organization_id,
        facility_id: scopeFacility ? selectedFacilityId : null,
        name: n,
        source_type: sourceType,
        is_active: true,
        created_by: user.id,
      };

      const { error: insErr } = await supabase.from("referral_sources").insert(payload);
      if (insErr) {
        setFormError(insErr.message);
        return;
      }
      setName("");
      setScopeFacility(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  const noFacility = !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Referral sources
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Master list for attribution (hospital, agency, family, web, other). Ties to{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-900">residents.referral_source_id</code> when set.
          </p>
        </div>
        <Link href="/admin/referrals" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Back to pipeline
        </Link>
      </div>

      <ReferralsHubNav />

      <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
        <CardHeader>
          <CardTitle className="font-display text-lg">Add source</CardTitle>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Inserts require <strong className="font-medium">owner</strong> or <strong className="font-medium">org_admin</strong> (RLS).
            Facility roles can use existing sources on leads.
          </p>
        </CardHeader>
        <CardContent>
          {noFacility ? (
            <p className="text-sm text-amber-800 dark:text-amber-200">Select a facility in the header to manage sources.</p>
          ) : (
            <form onSubmit={(e) => void handleCreate(e)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="src-name">Name</Label>
                  <Input id="src-name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="src-type">Type</Label>
                  <select
                    id="src-type"
                    value={sourceType}
                    onChange={(e) => setSourceType(e.target.value)}
                    className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
                  >
                    {SOURCE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={scopeFacility}
                      onChange={(e) => setScopeFacility(e.target.checked)}
                      className="rounded border-input"
                    />
                    Limit to current facility
                  </label>
                </div>
              </div>
              {formError ? (
                <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                  {formError}
                </p>
              ) : null}
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Add source"
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
        <CardHeader>
          <CardTitle className="font-display text-lg">Sources</CardTitle>
          <p className="text-sm text-slate-600 dark:text-slate-300">Org-wide and facility-scoped channels visible for this facility.</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-slate-600 dark:text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading…
            </div>
          ) : loadError ? (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {loadError}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-800">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Active</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={4} className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
                        No sources yet. Add one above (org admin) or ask an org admin to create channels.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r) => (
                      <TableRow key={r.id} className="hover:bg-transparent">
                        <TableCell className="font-medium text-slate-900 dark:text-slate-100">{r.name}</TableCell>
                        <TableCell className="capitalize">{r.source_type.replace(/_/g, " ")}</TableCell>
                        <TableCell>{r.facility_id ? "This facility" : "Organization"}</TableCell>
                        <TableCell>{r.is_active ? "Yes" : "No"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
