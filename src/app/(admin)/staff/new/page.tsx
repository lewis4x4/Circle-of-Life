"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, UserPlus } from "lucide-react";

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

/** Matches `staff_role` enum in DB */
const STAFF_ROLES: { value: string; label: string }[] = [
  { value: "cna", label: "CNA" },
  { value: "lpn", label: "LPN" },
  { value: "rn", label: "RN" },
  { value: "administrator", label: "Administrator" },
  { value: "activities_director", label: "Activities director" },
  { value: "dietary_staff", label: "Dietary staff" },
  { value: "dietary_manager", label: "Dietary manager" },
  { value: "maintenance", label: "Maintenance" },
  { value: "housekeeping", label: "Housekeeping" },
  { value: "driver", label: "Driver" },
  { value: "other", label: "Other" },
];

const EMPLOYMENT_STATUSES: { value: string; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "on_leave", label: "On leave" },
];

type QueryError = { message: string };

export default function AdminNewStaffPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [staffRole, setStaffRole] = useState("cna");
  const [employmentStatus, setEmploymentStatus] = useState("active");
  const [hireDate, setHireDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError("Select a facility in the header before adding staff.");
      return;
    }
    const fn = firstName.trim();
    const ln = lastName.trim();
    if (!fn || !ln) {
      setError("First and last name are required.");
      return;
    }
    if (!hireDate) {
      setError("Hire date is required.");
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
        facility_id: selectedFacilityId,
        organization_id: orgId,
        first_name: fn,
        last_name: ln,
        staff_role: staffRole,
        employment_status: employmentStatus,
        hire_date: hireDate,
        created_by: user.id,
        updated_by: user.id,
      };
      const ph = phone.trim();
      const em = email.trim();
      if (ph) payload.phone = ph;
      if (em) payload.email = em;

      const ins = (await supabase
        .from("staff" as never)
        .insert(payload as never)
        .select("id")
        .single()) as {
        data: { id: string } | null;
        error: QueryError | null;
      };

      if (ins.error) throw new Error(ins.error.message);
      const id = ins.data?.id;
      if (!id) throw new Error("Insert did not return an id.");

      router.push(`/admin/staff/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create staff record.");
    } finally {
      setSubmitting(false);
    }
  };

  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/staff"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Staff
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <UserPlus className="h-6 w-6 text-slate-500" />
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Add staff</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Create a roster row for the selected facility. Linking a login account is done separately.
          </p>
        </div>
      </div>

      {!facilityReady && (
        <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Choose a facility from the header selector to enable this form.
        </p>
      )}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Requires admin role: owner, org admin, or facility admin (per RLS). Nurses can view roster but cannot
        insert staff records.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Profile & role</CardTitle>
          <CardDescription>
            Compensation, certifications, and scheduling are managed from the staff profile after save.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 max-w-xl">
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">First name</label>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoComplete="given-name" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Last name</label>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} required autoComplete="family-name" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Role</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={staffRole}
                  onChange={(e) => setStaffRole(e.target.value)}
                >
                  {STAFF_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Employment status</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={employmentStatus}
                  onChange={(e) => setEmploymentStatus(e.target.value)}
                >
                  {EMPLOYMENT_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Hire date</label>
              <Input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} required />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Phone (optional)</label>
                <Input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Email (optional)</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
            </div>

            <Button type="submit" disabled={submitting || !facilityReady}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Create staff record"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
