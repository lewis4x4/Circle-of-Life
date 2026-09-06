"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";

import { CaregiverRoundsEmptyNotice } from "@/components/caregiver/CaregiverRoundsEmptyNotice";
import { QuickObservationForm } from "@/components/rounding/QuickObservationForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { queueRoundingCompletion, shouldQueueRoundingRequest } from "@/lib/pwa/rounding-sync";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import type { CompletionPayload } from "@/lib/rounding/types";
import { useRoundingOfflineSync } from "@/hooks/useRoundingOfflineSync";
import {
  describeCaregiverResidentRoundEmptyState,
  describeLiveBoardCadenceReminder,
} from "@/lib/rounding/col-discovery-round-cadence";

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
  const roundingSync = useRoundingOfflineSync();
  const params = useParams<{ residentId: string }>();
  const searchParams = useSearchParams();
  const residentId = params?.residentId ?? "";
  const taskIdFromQuery = searchParams.get("taskId");

  const [queueOwner, setQueueOwner] = useState<{ ownerUserId: string; organizationId: string; facilityId: string } | null>(null);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [facilityName, setFacilityName] = useState<string | null>(null);
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

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in to record observations.");
      setQueueOwner({ ownerUserId: user.id, organizationId: resolved.ctx.organizationId, facilityId: resolved.ctx.facilityId });
      setFacilityId(resolved.ctx.facilityId);
      setFacilityName(resolved.ctx.facilityName);
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
        tasks.find(
          (candidate) =>
            candidate.derived_status !== "completed_on_time" && candidate.derived_status !== "completed_late",
        ) ??
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
    if (!task || !queueOwner) return;
    payload = { ...payload, observedAt: payload.observedAt ?? new Date().toISOString() };
    setSubmitting(true);
    setLoadError(null);
    try {
      if (!navigator.onLine) {
        await queueRoundingCompletion(task.id, residentId, payload, queueOwner);
        setSuccessMessage("Round queued for sync. It will upload automatically when the device reconnects.");
        setTask(null);
        return;
      }

      const response = await fetch(`/api/rounding/tasks/${task.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await response.json()) as { error?: string };
      if (response.status === 409) {
        await queueRoundingCompletion(task.id, residentId, payload, queueOwner);
        setLoadError("This task was completed elsewhere. Your observation is retained in the Outbox for reconciliation.");
        return;
      }
      if (!response.ok) {
        throw new Error(json.error ?? "Could not complete round");
      }
      setSuccessMessage("Round saved successfully.");
      await load();
    } catch (error) {
      if (shouldQueueRoundingRequest(error)) {
        try {
          await queueRoundingCompletion(task.id, residentId, payload, queueOwner);
          setSuccessMessage("Connection lost. Round queued for sync and will upload automatically.");
          setTask(null);
        } catch (queueError) {
          setLoadError(queueError instanceof Error ? queueError.message : "Could not preserve the observation in the Outbox. Keep this draft open.");
        }
      } else {
        setLoadError(error instanceof Error ? error.message : "Could not complete round.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const taskQueuedLocally = Boolean(task && roundingSync.queuedTaskIdSet.has(task.id));

  const emptyCopy = useMemo(
    () =>
      describeCaregiverResidentRoundEmptyState({
        facilityName,
        taskQueuedLocally,
      }),
    [facilityName, taskQueuedLocally],
  );

  const cadenceReminder = useMemo(
    () => (facilityName && !task && !taskQueuedLocally ? describeLiveBoardCadenceReminder(facilityName) : null),
    [facilityName, task, taskQueuedLocally],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading resident round…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/caregiver/rounds">
          <Button
            variant="outline"
            className="min-h-[44px] border-border bg-card text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to rounds
          </Button>
        </Link>
        {task?.derived_status ? (
          <Badge variant="outline" className="border-border text-foreground">
            {task.derived_status.replaceAll("_", " ")}
          </Badge>
        ) : null}
      </div>

      {loadError ? (
        <Card className="border-destructive/30 bg-destructive/10 text-foreground">
          <CardContent className="py-4 text-sm">{loadError}</CardContent>
        </Card>
      ) : null}

      {successMessage ? (
        <Card className="border-success/30 bg-success/10 text-foreground">
          <CardContent className="py-4 text-sm">{successMessage}</CardContent>
        </Card>
      ) : null}

      {!task || taskQueuedLocally ? (
        <div className="space-y-4">
          <CaregiverRoundsEmptyNotice copy={emptyCopy} cadenceReminder={cadenceReminder} />
          <Link href="/caregiver/rounds">
            <Button className="min-h-[44px] bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0">
              Return to live queue
            </Button>
          </Link>
        </div>
      ) : (
        <QuickObservationForm
          residentName={residentName}
          dueLabel={`Due at ${new Date(task.due_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${facilityId ? ` · Facility ${facilityId.slice(-4)}` : ""}`}
          facilityId={facilityId}
          submitting={submitting}
          onSubmit={submitRound}
        />
      )}
    </div>
  );
}
