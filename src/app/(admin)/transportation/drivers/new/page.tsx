"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  DRIVER_NEW_LICENSE_EXPIRES_LABEL,
  DRIVER_NEW_LOADING_PROFILE_COPY,
  DRIVER_NEW_LOADING_STAFF_COPY,
  DRIVER_NEW_NO_STAFF_AT_FACILITY_COPY,
} from "@/lib/transportation/driver-new-display-copy";
import {
  isDriverNewSubmitBlocked,
  resolveDriverNewFetchErrorBannerMessage,
  resolveDriverNewOrganizationGapMessage,
  resolveDriverNewSubmitButtonLabel,
} from "@/lib/transportation/driver-new-page-state";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type CredStatus = Database["public"]["Enums"]["driver_credential_status"];

const STATUS_OPTIONS: CredStatus[] = ["active", "suspended", "expired"];

export default function AdminTransportationDriverNewPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { user, organizationId, loading: authLoading } = useHavenAuth();
  const { selectedFacilityId } = useFacilityStore();
  const [staffList, setStaffList] = useState<{ id: string; label: string }[]>([]);
  const [staffId, setStaffId] = useState("");
  const [status, setStatus] = useState<CredStatus>("active");
  const [licenseClass, setLicenseClass] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseExpires, setLicenseExpires] = useState("");
  const [medExpires, setMedExpires] = useState("");
  const [notes, setNotes] = useState("");
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const organizationGapMessage = resolveDriverNewOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: false,
  });
  const fetchErrorBannerMessage = resolveDriverNewFetchErrorBannerMessage({
    authLoading,
    fetchError,
  });

  const loadStaff = useCallback(async () => {
    if (authLoading) {
      return;
    }

    setLoadingStaff(true);
    setFetchError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setStaffList([]);
      setLoadingStaff(false);
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
      if (qErr) {
        setFetchError(qErr.message);
        setStaffList([]);
        return;
      }
      setStaffList(
        (data ?? []).map((s) => ({
          id: s.id,
          label: `${s.first_name} ${s.last_name}`.trim(),
        })),
      );
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to load staff.");
      setStaffList([]);
    } finally {
      setLoadingStaff(false);
    }
  }, [authLoading, supabase, selectedFacilityId]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));
    if (
      isDriverNewSubmitBlocked({
        saving,
        authLoading,
        organizationId,
        facilityReady,
        staffId,
      })
    ) {
      return;
    }
    if (!user || !organizationId || !selectedFacilityId) return;

    setSaving(true);
    setFetchError(null);
    try {
      const { error: insErr } = await supabase.from("driver_credentials").insert({
        organization_id: organizationId,
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
      setFetchError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));
  const showEmptyStaffGap =
    facilityReady && !authLoading && !loadingStaff && staffList.length === 0 && !fetchErrorBannerMessage;
  const submitBlocked = isDriverNewSubmitBlocked({
    saving,
    authLoading,
    organizationId,
    facilityReady,
    staffId,
  });
  const selectClass = cn(
    "h-8 w-full max-w-xl rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none",
    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
  );

  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          Add driver credential
        </h1>
        <Link href="/admin/transportation" className={cn(buttonVariants({ variant: "outline" }), "shrink-0")}>
          Back
        </Link>
      </div>

      {authLoading ? (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {DRIVER_NEW_LOADING_PROFILE_COPY}
        </p>
      ) : null}

      {organizationGapMessage ? (
        <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
          <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
        </Card>
      ) : null}

      {!facilityReady && !authLoading ? (
        <p className="text-sm text-amber-800 dark:text-amber-200">Select a facility first.</p>
      ) : null}

      {fetchErrorBannerMessage ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {fetchErrorBannerMessage}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Credential record</CardTitle>
          <CardDescription>One active credential row per staff member per facility.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="stf">Staff</Label>
              {loadingStaff || authLoading ? (
                <p className="text-sm text-slate-500">{DRIVER_NEW_LOADING_STAFF_COPY}</p>
              ) : showEmptyStaffGap ? (
                <p className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  {DRIVER_NEW_NO_STAFF_AT_FACILITY_COPY}
                </p>
              ) : (
                <select
                  id="stf"
                  required
                  className={selectClass}
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  disabled={!facilityReady || staffList.length === 0 || Boolean(organizationGapMessage)}
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
                <Label htmlFor="le">{DRIVER_NEW_LICENSE_EXPIRES_LABEL}</Label>
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
            <Button type="submit" disabled={submitBlocked}>
              {resolveDriverNewSubmitButtonLabel({ saving, authLoading })}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
