"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, GraduationCap, Loader2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type StaffOption = { id: string; name: string };
type ProgramOption = {
  id: string;
  code: string;
  name: string;
  external_provider: string | null;
};

const DELIVERY: Database["public"]["Enums"]["training_delivery_method"][] = [
  "in_person",
  "external",
  "online",
  "hybrid",
];

function deliveryLabel(d: (typeof DELIVERY)[number]) {
  return d.replace(/_/g, " ");
}

export default function AdminNewTrainingCompletionPage() {
  const supabase = createClient();
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();

  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [programList, setProgramList] = useState<ProgramOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [staffId, setStaffId] = useState("");
  const [programId, setProgramId] = useState("");
  const [completedAt, setCompletedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [expiresAt, setExpiresAt] = useState("");
  const [hoursCompleted, setHoursCompleted] = useState("");
  const [deliveryMethod, setDeliveryMethod] =
    useState<Database["public"]["Enums"]["training_delivery_method"]>("in_person");
  const [externalProvider, setExternalProvider] = useState("");
  const [certificateNumber, setCertificateNumber] = useState("");
  const [notes, setNotes] = useState("");

  const loadFacilityOrg = useCallback(async () => {
    if (!isValidFacilityIdForQuery(selectedFacilityId)) return null;
    const { data, error: qErr } = await supabase
      .from("facilities")
      .select("organization_id")
      .eq("id", selectedFacilityId)
      .is("deleted_at", null)
      .maybeSingle();
    if (qErr) throw new Error(qErr.message);
    return data?.organization_id ?? null;
  }, [supabase, selectedFacilityId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setStaffList([]);
      setProgramList([]);
      setLoading(false);
      return;
    }
    try {
      const orgId = await loadFacilityOrg();
      if (!orgId) {
        setStaffList([]);
        setProgramList([]);
        return;
      }

      const [staffRes, progRes] = await Promise.all([
        supabase
          .from("staff")
          .select("id, first_name, last_name")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("last_name", { ascending: true })
          .limit(400),
        supabase
          .from("training_programs")
          .select("id, code, name, external_provider")
          .eq("organization_id", orgId)
          .eq("active", true)
          .is("deleted_at", null)
          .order("name", { ascending: true })
          .limit(200),
      ]);

      if (staffRes.error) throw staffRes.error;
      if (progRes.error) throw progRes.error;

      setStaffList(
        (staffRes.data ?? []).map((s) => ({
          id: s.id,
          name: `${s.first_name} ${s.last_name}`.trim(),
        })),
      );
      setProgramList((progRes.data ?? []) as ProgramOption[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load form data.");
      setStaffList([]);
      setProgramList([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId, loadFacilityOrg]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const p = programList.find((x) => x.id === programId);
    setExternalProvider(p?.external_provider?.trim() ? p.external_provider : "");
  }, [programId, programList]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setError("Select a facility in the header first.");
      return;
    }
    if (!staffId.trim()) {
      setError("Choose a staff member.");
      return;
    }
    if (!programId.trim()) {
      setError("Choose a training program.");
      return;
    }
    if (!completedAt) {
      setError("Completion date is required.");
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

      let hours: number | null = null;
      const ht = hoursCompleted.trim();
      if (ht) {
        const n = Number(ht);
        if (Number.isNaN(n) || n < 0) {
          setError("Hours must be a non-negative number.");
          return;
        }
        hours = n;
      }

      const payload: Database["public"]["Tables"]["staff_training_completions"]["Insert"] = {
        organization_id: orgId,
        facility_id: selectedFacilityId,
        staff_id: staffId,
        training_program_id: programId,
        completed_at: completedAt,
        delivery_method: deliveryMethod,
        created_by: user.id,
      };

      const ex = expiresAt.trim();
      if (ex) payload.expires_at = ex;
      if (hours != null) payload.hours_completed = hours;
      const ep = externalProvider.trim();
      if (ep) payload.external_provider = ep;
      const cn = certificateNumber.trim();
      if (cn) payload.certificate_number = cn;
      const nt = notes.trim();
      if (nt) payload.notes = nt;
      payload.evaluator_user_id = user.id;

      const { error: insErr } = await supabase.from("staff_training_completions").insert(payload);

      if (insErr) {
        const msg = insErr.message ?? "";
        if (msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("policy")) {
          setError(
            "You may not have permission to add completions (requires owner, org admin, or facility admin).",
          );
          return;
        }
        throw new Error(insErr.message);
      }

      router.push("/admin/training");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save completion.");
    } finally {
      setSubmitting(false);
    }
  }

  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/training"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "inline-flex gap-1")}
        >
          <ArrowLeft className="h-4 w-4" />
          Training
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <GraduationCap className="h-6 w-6 text-slate-500" />
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Log training completion</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Record a completed training program for a staff member (e.g. Baya certificate, in-service).
          </p>
        </div>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        RLS: only <strong>owner</strong>, <strong>org admin</strong>, or <strong>facility admin</strong> can insert
        completion rows. Choose a single facility in the header (not &quot;All facilities&quot;).
      </p>

      {!facilityReady && (
        <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Choose a facility from the header selector to load staff and programs.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Completion</CardTitle>
          <CardDescription>Required: staff, program, completion date, delivery method.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="max-w-xl space-y-4">
            {error && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
                {error}
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="staff">Staff</Label>
              <select
                id="staff"
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                disabled={!facilityReady || loading}
              >
                <option value="">Select…</option>
                {staffList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="program">Training program</Label>
              <select
                id="program"
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                value={programId}
                onChange={(e) => setProgramId(e.target.value)}
                disabled={!facilityReady || loading}
              >
                <option value="">Select…</option>
                {programList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="completed">Completed on</Label>
                <Input
                  id="completed"
                  type="date"
                  value={completedAt}
                  onChange={(e) => setCompletedAt(e.target.value)}
                  disabled={!facilityReady || loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expires">Expires on (optional)</Label>
                <Input
                  id="expires"
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  disabled={!facilityReady || loading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="hours">Hours completed (optional)</Label>
              <Input
                id="hours"
                type="text"
                inputMode="decimal"
                placeholder="e.g. 4.5"
                value={hoursCompleted}
                onChange={(e) => setHoursCompleted(e.target.value)}
                disabled={!facilityReady || loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="delivery">Delivery method</Label>
              <select
                id="delivery"
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm capitalize dark:border-slate-800 dark:bg-slate-950"
                value={deliveryMethod}
                onChange={(e) =>
                  setDeliveryMethod(
                    e.target.value as Database["public"]["Enums"]["training_delivery_method"],
                  )
                }
                disabled={!facilityReady || loading}
              >
                {DELIVERY.map((d) => (
                  <option key={d} value={d}>
                    {deliveryLabel(d)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider">External provider (optional)</Label>
              <Input
                id="provider"
                value={externalProvider}
                onChange={(e) => setExternalProvider(e.target.value)}
                placeholder="e.g. Baya"
                disabled={!facilityReady || loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cert">Certificate number (optional)</Label>
              <Input
                id="cert"
                value={certificateNumber}
                onChange={(e) => setCertificateNumber(e.target.value)}
                disabled={!facilityReady || loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <textarea
                id="notes"
                className="flex min-h-[80px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={!facilityReady || loading}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={!facilityReady || loading || submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save completion"
                )}
              </Button>
              <Link href="/admin/training" className={buttonVariants({ variant: "outline" })}>
                Cancel
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
