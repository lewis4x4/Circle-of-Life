"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type CredStatus = Database["public"]["Enums"]["driver_credential_status"];

const STATUS_OPTIONS: CredStatus[] = ["active", "suspended", "expired"];

export default function AdminTransportationDriverNewPage() {
  const supabase = createClient();
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();
  const [staffList, setStaffList] = useState<{ id: string; label: string }[]>([]);
  const [staffId, setStaffId] = useState("");
  const [status, setStatus] = useState<CredStatus>("active");
  const [licenseClass, setLicenseClass] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseExpires, setLicenseExpires] = useState("");
  const [medExpires, setMedExpires] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStaff = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setStaffList([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error: qErr } = await supabase
        .from("staff")
        .select("id, first_name, last_name")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("last_name", { ascending: true })
        .limit(400);
      if (qErr) throw qErr;
      setStaffList(
        (data ?? []).map((s) => ({
          id: s.id,
          label: `${s.first_name} ${s.last_name}`.trim(),
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load staff.");
      setStaffList([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId) || !staffId) return;
    setSaving(true);
    setError(null);
    try {
      const ctx = await loadFinanceRoleContext(supabase);
      if (!ctx.ok) throw new Error(ctx.error);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in required.");
      const { error: insErr } = await supabase.from("driver_credentials").insert({
        organization_id: ctx.ctx.organizationId,
        facility_id: selectedFacilityId,
        staff_id: staffId,
        status,
        license_class: licenseClass.trim() || null,
        license_number: licenseNumber.trim() || null,
        license_expires_on: licenseExpires.trim() || null,
        medical_card_expires_on: medExpires.trim() || null,
        notes: notes.trim() || null,
        created_by: user.id,
      });
      if (insErr) throw insErr;
      router.push("/admin/transportation");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));
  const selectClass = cn(
    "h-8 w-full max-w-xl rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none",
    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
  );

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Add driver credential
        </h1>
        <Link href="/admin/transportation" className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}>
          Back
        </Link>
      </div>

      {!facilityReady && (
        <p className="text-sm text-amber-800 dark:text-amber-200">Select a facility first.</p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Credential record</CardTitle>
          <CardDescription>One active credential row per staff member per facility.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="stf">Staff</Label>
              {loading ? (
                <p className="text-sm text-slate-500">Loading staff…</p>
              ) : (
                <select
                  id="stf"
                  required
                  className={selectClass}
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  disabled={!facilityReady || staffList.length === 0}
                >
                  <option value="">Select…</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="stat">Status</Label>
              <select id="stat" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as CredStatus)}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="lc">License class</Label>
                <Input id="lc" value={licenseClass} onChange={(e) => setLicenseClass(e.target.value)} placeholder="e.g. CDL B" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ln">License number</Label>
                <Input id="ln" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="le">License expires</Label>
                <Input id="le" type="date" value={licenseExpires} onChange={(e) => setLicenseExpires(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="me">Medical card expires</Label>
                <Input id="me" type="date" value={medExpires} onChange={(e) => setMedExpires(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <Button type="submit" disabled={saving || !facilityReady || !staffId}>
              {saving ? "Saving…" : "Save credential"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
