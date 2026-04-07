"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";

import { QuickObservationForm } from "@/components/rounding/QuickObservationForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import type { CompletionPayload } from "@/lib/rounding/types";

type TaskApiRow = {
  id: string;
  due_at: string;
  derived_status: string;
  residents?: { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null } | null;
};

function displayName(person?: { first_name: string | null; last_name: string | null; preferred_name: string | null } | null) {
  return [person?.preferred_name ?? person?.first_name ?? null, person?.last_name ?? null].filter(Boolean).join(" ");
}

export default function CaregiverResidentRoundPage() {
  const supabase = useMemo(() => createClient(), []);
  const params = useParams<{ residentId: string }>();
  const searchParams = useSearchParams();
  const residentId = params?.residentId ?? "";
  const taskIdFromQuery = searchParams.get("taskId");

  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [residentName, setResidentName] = useState("Resident");
  const [task, setTask] = useState<TaskApiRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setSuccessMessage(null);

    if (!isBrowserSupabaseConfigured()) {
      setLoadError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    try {
      const resolved = await loadCaregiverFacilityContext(supabase);
      if (!resolved.ok) {
        throw new Error(resolved.error);
      }

      setFacilityId(resolved.ctx.facilityId);
      const response = await fetch(
        `/api/rounding/tasks?facilityId=${encodeURIComponent(resolved.ctx.facilityId)}&residentId=${encodeURIComponent(residentId)}&limit=20`,
        { cache: "no-store" },
      );
      const json = (await response.json()) as { error?: string; tasks?: TaskApiRow[] };
      if (!response.ok) {
        throw new Error(json.error ?? "Could not load resident rounds");
      }

      const tasks = json.tasks ?? [];
      const selected =
        tasks.find((candidate) => candidate.id === taskIdFromQuery) ??
        tasks.find((candidate) => candidate.derived_status !== "completed_on_time" && candidate.derived_status !== "completed_late") ??
        tasks[0] ??
        null;

      setTask(selected);
      setResidentName(displayName(selected?.residents) || "Resident");
    } catch (error) {
      setTask(null);
      setLoadError(error instanceof Error ? error.message : "Could not load resident round.");
    } finally {
      setLoading(false);
    }
  }, [residentId, supabase, taskIdFromQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitRound(payload: CompletionPayload) {
    if (!task) return;
    setSubmitting(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/rounding/tasks/${task.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "Could not complete round");
      }
      setSuccessMessage("Round saved successfully.");
      await load();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not complete round.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading resident round…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/caregiver/rounds">
          <Button variant="outline" className="min-h-11 border-zinc-800 bg-zinc-950 text-zinc-100 hover:bg-zinc-900">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to rounds
          </Button>
        </Link>
        {task?.derived_status ? <Badge variant="outline">{task.derived_status.replaceAll("_", " ")}</Badge> : null}
      </div>

      {loadError ? (
        <Card className="border-rose-800/60 bg-rose-950/30 text-rose-100">
          <CardContent className="py-4 text-sm">{loadError}</CardContent>
        </Card>
      ) : null}

      {successMessage ? (
        <Card className="border-emerald-800/60 bg-emerald-950/20 text-emerald-100">
          <CardContent className="py-4 text-sm">{successMessage}</CardContent>
        </Card>
      ) : null}

      {!task ? (
        <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
          <CardContent className="space-y-3 py-6">
            <p className="text-sm text-zinc-300">No active round was found for this resident in the current facility scope.</p>
            <Link href="/caregiver/rounds">
              <Button className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-500">Return to live queue</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <QuickObservationForm
          residentName={residentName}
          dueLabel={`Due at ${new Date(task.due_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${facilityId ? ` · Facility ${facilityId.slice(-4)}` : ""}`}
          submitting={submitting}
          onSubmit={submitRound}
        />
      )}
    </div>
  );
}
