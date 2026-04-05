"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
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

const GENDERS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

const STATUSES = [
  { value: "pending_admission", label: "Pending admission" },
  { value: "active", label: "Active (admitted)" },
] as const;

const ACUITY = [
  { value: "level_1", label: "Level 1" },
  { value: "level_2", label: "Level 2" },
  { value: "level_3", label: "Level 3" },
] as const;

type QueryError = { message: string };

export default function AdminNewResidentPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState<string>("female");
  const [status, setStatus] = useState<string>("active");
  const [acuity, setAcuity] = useState<string>("level_1");
  const [admissionDate, setAdmissionDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showAdmission = status === "active";

  useEffect(() => {
    if (status === "active" && !admissionDate) {
      setAdmissionDate(new Date().toISOString().slice(0, 10));
    }
  }, [status, admissionDate]);

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
      setError("Select a facility in the header before adding a resident.");
      return;
    }
    const fn = firstName.trim();
    const ln = lastName.trim();
    if (!fn || !ln) {
      setError("First and last name are required.");
      return;
    }
    if (!dob) {
      setError("Date of birth is required.");
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
        date_of_birth: dob,
        gender,
        status,
        acuity_level: acuity,
        created_by: user.id,
        updated_by: user.id,
      };
      if (showAdmission && admissionDate.trim()) {
        payload.admission_date = admissionDate.trim();
      } else {
        payload.admission_date = null;
      }

      const ins = (await supabase
        .from("residents" as never)
        .insert(payload as never)
        .select("id")
        .single()) as {
        data: { id: string } | null;
        error: QueryError | null;
      };

      if (ins.error) throw new Error(ins.error.message);
      const id = ins.data?.id;
      if (!id) throw new Error("Insert did not return an id.");

      router.push(`/admin/residents/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create resident.");
    } finally {
      setSubmitting(false);
    }
  };

  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/residents"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Residents
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <UserPlus className="h-6 w-6 text-slate-500" />
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Add resident</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Create a resident record for the selected facility. Required fields match the core census profile.
          </p>
        </div>
      </div>

      {!facilityReady && (
        <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Choose a facility from the header selector to enable this form.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Identity & placement</CardTitle>
          <CardDescription>
            Additional clinical and billing details can be edited on the resident profile after save.
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
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Date of birth</label>
                <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Gender</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                >
                  {GENDERS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Residency status</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Acuity (initial)</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={acuity}
                  onChange={(e) => setAcuity(e.target.value)}
                >
                  {ACUITY.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {showAdmission && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Admission date</label>
                <Input type="date" value={admissionDate} onChange={(e) => setAdmissionDate(e.target.value)} />
              </div>
            )}

            <Button type="submit" disabled={submitting || !facilityReady}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Create resident"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
