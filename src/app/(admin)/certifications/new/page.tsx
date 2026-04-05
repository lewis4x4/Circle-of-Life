"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Award, Loader2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

const CERT_TYPE_PRESETS = [
  { value: "bls_cpr", label: "BLS / CPR" },
  { value: "first_aid", label: "First aid" },
  { value: "cna", label: "CNA" },
  { value: "lpn", label: "LPN license" },
  { value: "rn", label: "RN license" },
  { value: "medication_administration", label: "Medication administration" },
  { value: "fire_safety", label: "Fire / safety training" },
  { value: "hipaa", label: "HIPAA / privacy" },
  { value: "dementia_care", label: "Dementia care" },
  { value: "other", label: "Other (describe in name)" },
] as const;

type StaffOption = { id: string; name: string };

type QueryError = { message: string; code?: string };

export default function AdminNewCertificationPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();

  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);

  const [staffId, setStaffId] = useState("");
  const [certType, setCertType] = useState("bls_cpr");
  const [certName, setCertName] = useState("");
  const [issuingAuthority, setIssuingAuthority] = useState("");
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expirationDate, setExpirationDate] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStaff = useCallback(async () => {
    setStaffLoading(true);
    try {
      if (!isValidFacilityIdForQuery(selectedFacilityId)) {
        setStaffList([]);
        return;
      }
      const { data, error: err } = (await supabase
        .from("staff" as never)
        .select("id, first_name, last_name")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .eq("employment_status", "active")
        .order("last_name", { ascending: true })
        .limit(400)) as {
        data: { id: string; first_name: string; last_name: string }[] | null;
        error: QueryError | null;
      };
      if (err) throw err;
      setStaffList(
        (data ?? []).map((s) => ({
          id: s.id,
          name: `${s.last_name?.trim() ?? ""}, ${s.first_name?.trim() ?? ""}`.replace(/^, |, $/g, "").trim() || "Staff",
        })),
      );
    } catch {
      setStaffList([]);
    } finally {
      setStaffLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  const loadFacilityOrg = useCallback(async () => {
    if (!isValidFacilityIdForQuery(selectedFacilityId)) return null;
    const res = (await supabase
      .from("facilities" as never)
      .select("organization_id")
      .eq("id", selectedFacilityId)
      .is("deleted_at", null)
      .maybeSingle()) as {
      data: { organization_id: string } | null;
      error: QueryError | null;
    };
    if (res.error) throw new Error(res.error.message);
    return res.data?.organization_id ?? null;
  }, [supabase, selectedFacilityId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setError("Select a facility in the header first.");
      return;
    }
    if (!staffId.trim()) {
      setError("Choose a staff member.");
      return;
    }
    const name = certName.trim();
    if (!name) {
      setError("Credential name is required.");
      return;
    }
    if (!issueDate) {
      setError("Issue date is required.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const orgId = await loadFacilityOrg();
      if (!orgId) {
        setError("Could not resolve organization for this facility.");
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setError("You must be signed in.");
        return;
      }

      const payload: Record<string, unknown> = {
        staff_id: staffId,
        facility_id: selectedFacilityId,
        organization_id: orgId,
        certification_type: certType,
        certification_name: name,
        issue_date: issueDate,
        status: "active",
        created_by: user.id,
        updated_by: user.id,
      };
      const ia = issuingAuthority.trim();
      if (ia) payload.issuing_authority = ia;
      const exp = expirationDate.trim();
      if (exp) payload.expiration_date = exp;

      const ins = (await supabase
        .from("staff_certifications" as never)
        .insert(payload as never)
        .select("id")
        .single()) as {
        data: { id: string } | null;
        error: QueryError | null;
      };

      if (ins.error) {
        const msg = ins.error.message ?? "";
        if (msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("policy")) {
          setError(
            "You may not have permission to add certifications (requires owner, org admin, or facility admin).",
          );
          return;
        }
        throw new Error(ins.error.message);
      }

      router.push("/admin/certifications");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save certification.");
    } finally {
      setSubmitting(false);
    }
  };

  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/certifications"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Certifications
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <Award className="h-6 w-6 text-slate-500" />
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Add certification</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Record a license or training credential for a staff member at this facility.
          </p>
        </div>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        RLS: only <strong>owner</strong>, <strong>org admin</strong>, or <strong>facility admin</strong> can add
        certification rows (nurses can view the register).
      </p>

      {!facilityReady && (
        <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Choose a facility from the header selector to load staff and enable this form.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Credential</CardTitle>
          <CardDescription>Required: staff, issue date, and credential name.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 max-w-xl">
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Staff member</label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                disabled={staffLoading || !facilityReady}
                required
              >
                <option value="">Select staff…</option>
                {staffList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {facilityReady && !staffLoading && staffList.length === 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-300">No active staff in this facility.</p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Category</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={certType}
                  onChange={(e) => setCertType(e.target.value)}
                >
                  {CERT_TYPE_PRESETS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Credential name</label>
                <Input
                  value={certName}
                  onChange={(e) => setCertName(e.target.value)}
                  placeholder="e.g. American Heart BLS — Healthcare Provider"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Issuing authority (optional)
              </label>
              <Input
                value={issuingAuthority}
                onChange={(e) => setIssuingAuthority(e.target.value)}
                placeholder="e.g. AHA Training Center, FL BON"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Issue date</label>
                <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Expiration (optional)
                </label>
                <Input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} />
              </div>
            </div>

            <Button type="submit" disabled={submitting || !facilityReady || staffLoading || staffList.length === 0}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save certification"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
