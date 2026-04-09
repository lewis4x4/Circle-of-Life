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
type ProgramOption = { id: string; code: string; name: string };

export default function AdminNewInserviceSessionPage() {
  const supabase = createClient();
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();

  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  const [programList, setProgramList] = useState<ProgramOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [topic, setTopic] = useState("");
  const [trainerName, setTrainerName] = useState("");
  const [hours, setHours] = useState("1");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [programId, setProgramId] = useState("");
  const [selectedStaffIds, setSelectedStaffIds] = useState<Set<string>>(new Set());

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
          .select("id, code, name")
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

  function toggleStaff(id: string) {
    setSelectedStaffIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setError("Select a facility in the header first.");
      return;
    }
    const t = topic.trim();
    const tr = trainerName.trim();
    if (!t) {
      setError("Topic is required.");
      return;
    }
    if (!tr) {
      setError("Trainer name is required.");
      return;
    }
    if (!sessionDate) {
      setError("Session date is required.");
      return;
    }
    const hn = Number(hours.trim());
    if (Number.isNaN(hn) || hn <= 0 || hn > 99.99) {
      setError("Hours must be between 0.01 and 99.99.");
      return;
    }
    if (selectedStaffIds.size === 0) {
      setError("Select at least one attendee.");
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

      const payload: Database["public"]["Tables"]["inservice_log_sessions"]["Insert"] = {
        organization_id: orgId,
        facility_id: selectedFacilityId,
        session_date: sessionDate,
        topic: t,
        trainer_name: tr,
        hours: hn,
        created_by: user.id,
        trainer_user_id: user.id,
      };

      const pid = programId.trim();
      if (pid) payload.training_program_id = pid;
      const loc = location.trim();
      if (loc) payload.location = loc;
      const nt = notes.trim();
      if (nt) payload.notes = nt;

      const { data: inserted, error: insErr } = await supabase
        .from("inservice_log_sessions")
        .insert(payload)
        .select("id")
        .single();

      if (insErr) {
        const msg = insErr.message ?? "";
        if (msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("policy")) {
          setError(
            "You may not have permission to create sessions (requires owner, org admin, or facility admin).",
          );
          return;
        }
        throw new Error(insErr.message);
      }
      if (!inserted?.id) throw new Error("Could not create session.");

      const sessionId = inserted.id;
      const attendeeRows: Database["public"]["Tables"]["inservice_log_attendees"]["Insert"][] = [
        ...selectedStaffIds,
      ].map((staffId) => ({
        session_id: sessionId,
        staff_id: staffId,
        signed_in: true,
      }));

      const { error: attErr } = await supabase.from("inservice_log_attendees").insert(attendeeRows);

      if (attErr) {
        await supabase
          .from("inservice_log_sessions")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", sessionId);
        const msg = attErr.message ?? "";
        if (msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("policy")) {
          setError("Could not add attendees (permission denied). Session was not saved.");
          return;
        }
        throw new Error(attErr.message);
      }

      const catalogProgramId = programId.trim();
      if (catalogProgramId) {
        const completionRows: Database["public"]["Tables"]["staff_training_completions"]["Insert"][] =
          [...selectedStaffIds].map((staffId) => ({
            organization_id: orgId,
            facility_id: selectedFacilityId,
            staff_id: staffId,
            training_program_id: catalogProgramId,
            completed_at: sessionDate,
            hours_completed: hn,
            delivery_method: "in_person" as const,
            evaluator_user_id: user.id,
            notes: `In-service: ${t} (session ${sessionId})`,
            created_by: user.id,
          }));

        const { error: compErr } = await supabase
          .from("staff_training_completions")
          .insert(completionRows);

        if (compErr) {
          await supabase.from("inservice_log_attendees").delete().eq("session_id", sessionId);
          await supabase
            .from("inservice_log_sessions")
            .update({ deleted_at: new Date().toISOString() })
            .eq("id", sessionId);
          const msg = compErr.message ?? "";
          if (msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("policy")) {
            setError(
              "Could not log training completions for attendees (permission denied). Session was not saved.",
            );
            return;
          }
          throw new Error(compErr.message);
        }
      }

      router.push("/admin/training");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save in-service session.");
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
          <h1 className="font-display text-2xl font-semibold tracking-tight">New in-service session</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Record an in-service training event and who attended (digital sign-in).
          </p>
        </div>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        RLS: only <strong>owner</strong>, <strong>org admin</strong>, or <strong>facility admin</strong> can create
        sessions. Choose a single facility in the header (not &quot;All facilities&quot;).
      </p>

      {!facilityReady && (
        <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Choose a facility from the header selector to load staff and programs.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Session & attendees</CardTitle>
          <CardDescription>
            Required: date, topic, trainer, hours, and at least one staff attendee.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(e)} className="max-w-2xl space-y-4">
            {error && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
                {error}
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="sessionDate">Session date</Label>
                <Input
                  id="sessionDate"
                  type="date"
                  value={sessionDate}
                  onChange={(e) => setSessionDate(e.target.value)}
                  disabled={!facilityReady || loading}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hours">Hours</Label>
                <Input
                  id="hours"
                  type="number"
                  step="0.25"
                  min="0.01"
                  max="99.99"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  disabled={!facilityReady || loading}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="topic">Topic</Label>
              <Input
                id="topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                disabled={!facilityReady || loading}
                placeholder="e.g. Fire safety refresher"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="trainer">Trainer name</Label>
              <Input
                id="trainer"
                value={trainerName}
                onChange={(e) => setTrainerName(e.target.value)}
                disabled={!facilityReady || loading}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="program">Training program (optional)</Label>
              <select
                id="program"
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                value={programId}
                onChange={(e) => setProgramId(e.target.value)}
                disabled={!facilityReady || loading}
              >
                <option value="">None</option>
                {programList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                If you pick a catalog program, each selected attendee also receives a matching{" "}
                <strong>staff training completion</strong> row (same date and hours as this session).
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Location (optional)</Label>
              <Input
                id="location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                disabled={!facilityReady || loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={!facilityReady || loading}
              />
            </div>

            <div className="space-y-2">
              <fieldset className="space-y-2 border-0 p-0">
                <legend className="text-sm font-medium leading-none">Attendees</legend>
                <div
                  className="max-h-56 overflow-y-auto rounded-md border border-slate-200 p-3 dark:border-slate-800"
                  role="group"
                  aria-label="Staff attendees for this in-service session"
                >
                {loading ? (
                  <p className="text-sm text-slate-500">Loading staff…</p>
                ) : staffList.length === 0 ? (
                  <p className="text-sm text-slate-500">No staff in this facility.</p>
                ) : (
                  <ul className="space-y-2">
                    {staffList.map((s) => (
                      <li key={s.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`staff-${s.id}`}
                          checked={selectedStaffIds.has(s.id)}
                          onChange={() => toggleStaff(s.id)}
                          className="h-4 w-4 rounded border-slate-300"
                          aria-label={`Attendee ${s.name}`}
                        />
                        <label htmlFor={`staff-${s.id}`} className="text-sm cursor-pointer">
                          {s.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                </div>
              </fieldset>
              <p className="text-[10px] text-slate-500">
                {selectedStaffIds.size} selected
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={!facilityReady || loading || submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save session"
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
