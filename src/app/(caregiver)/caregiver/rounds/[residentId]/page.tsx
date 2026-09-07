"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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

type RetryOwner = NonNullable<CompletionPayload["retryOwner"]>;
type PendingRound = {
  payload: CompletionPayload;
  task: TaskApiRow;
  residentId: string;
  owner: RetryOwner;
  busy: boolean;
  reasonRequired: boolean;
  error: string | null;
};
// Match the drawer lifecycle: retain uncertain clinical requests in this tab only,
// partitioned by original signed session and task. Never persist drafts to storage.
const pendingRounds = new Map<string, PendingRound>();
const acknowledgedRounds = new Map<string, string>();
const listeners = new Set<() => void>();
function publish() { listeners.forEach((listener) => listener()); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function ownerKey(owner: RetryOwner) {
  return JSON.stringify([owner.userId, owner.sessionId, owner.organizationId, owner.facilityId]);
}
function roundKey(owner: RetryOwner, residentId: string, taskId: string) {
  return `${ownerKey(owner)}:${residentId}:${taskId}`;
}
async function currentOwner(organizationId: string, facilityId: string): Promise<RetryOwner> {
  const { data, error } = await createClient().rpc("haven_current_edge_actor" as never);
  const actor = data as { user_id?: string; session_id?: string; organization_id?: string } | null;
  if (error || !actor?.user_id || !actor.session_id || actor.organization_id !== organizationId || !facilityId) {
    throw new Error("Current account authorization is unavailable. Sign in to record observations.");
  }
  return { userId: actor.user_id, sessionId: actor.session_id, organizationId, facilityId };
}

async function assertOriginalSession(owner: RetryOwner) {
  // This is an identity guard, not authorization. The server validates retryOwner
  // against the verified actor. Reading the local session also works offline.
  const { data, error } = await createClient().auth.getSession();
  const session = data.session;
  let sessionId: unknown;
  try {
    const encoded = session?.access_token.split(".")[1] ?? "";
    sessionId = (JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/"))) as { session_id?: unknown }).session_id;
  } catch { /* Missing or malformed session identity fails closed below. */ }
  if (error || session?.user.id !== owner.userId || sessionId !== owner.sessionId) {
    throw new Error("The account or session changed. Sign in as the original operator to retry this observation.");
  }
}

export default function CaregiverResidentRoundPage() {
  const supabase = useMemo(() => createClient(), []);
  const roundingSync = useRoundingOfflineSync();
  const params = useParams<{ residentId: string }>();
  const searchParams = useSearchParams();
  const residentId = params?.residentId ?? "";
  const taskIdFromQuery = searchParams.get("taskId");
  const [owner, setOwner] = useState<RetryOwner | null>(null);
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [facilityName, setFacilityName] = useState<string | null>(null);
  const [residentName, setResidentName] = useState("Resident");
  const [task, setTask] = useState<TaskApiRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const routeScope = `${residentId}:${taskIdFromQuery ?? ""}`;
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const activeScope = useRef<string | null>(null);
  const key = owner && task ? roundKey(owner, residentId, task.id) : "";
  const pending = useSyncExternalStore(subscribe, () => pendingRounds.get(key), () => undefined);
  const successMessage = useSyncExternalStore(subscribe, () => acknowledgedRounds.get(key), () => undefined);
  const submitting = pending?.busy ?? false;

  useEffect(() => {
    let active = true;
    let generation = 0;
    async function load() {
      const attempt = ++generation;
      const isCurrent = () => active && attempt === generation;
      activeScope.current = null;
      setLoading(true);
      setOwner(null);
      setLoadError(null);
      try {
        if (!isBrowserSupabaseConfigured()) throw new Error("Supabase is not configured.");
        const resolved = await loadCaregiverFacilityContext(supabase);
        if (!resolved.ok) throw new Error(resolved.error);
        const nextOwner = await currentOwner(resolved.ctx.organizationId, resolved.ctx.facilityId);
        const response = await fetch(
          `/api/rounding/tasks?facilityId=${encodeURIComponent(nextOwner.facilityId)}&residentId=${encodeURIComponent(residentId)}&limit=20`,
          { cache: "no-store" },
        );
        const json = (await response.json()) as { error?: string; tasks?: TaskApiRow[] };
        if (!response.ok) throw new Error(json.error ?? "Could not load resident rounds");
        if (!isCurrent()) return;
        const retained = [...pendingRounds.values()].find((round) =>
          ownerKey(round.owner) === ownerKey(nextOwner) && round.residentId === residentId &&
          (!taskIdFromQuery || round.task.id === taskIdFromQuery));
        const tasks = json.tasks ?? [];
        const selected = retained?.task ?? (taskIdFromQuery
          ? tasks.find((candidate) => candidate.id === taskIdFromQuery)
          : tasks.find((candidate) => !candidate.derived_status.startsWith("completed_"))) ?? null;
        setOwner(nextOwner);
        setFacilityId(nextOwner.facilityId);
        setFacilityName(resolved.ctx.facilityName);
        setTask(selected);
        setResidentName(displayName(selected?.residents) || "Resident");
        setLoadedScope(routeScope);
        activeScope.current = selected ? roundKey(nextOwner, residentId, selected.id) : null;
      } catch (error) {
        if (!isCurrent()) return;
        setTask(null);
        setLoadError(error instanceof Error ? error.message : "Could not load resident round.");
        setLoadedScope(routeScope);
      } finally {
        if (isCurrent()) setLoading(false);
      }
    }
    void load();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "TOKEN_REFRESHED" && event !== "INITIAL_SESSION") {
        activeScope.current = null;
        setOwner(null);
        void Promise.resolve().then(load);
      }
    });
    return () => { active = false; activeScope.current = null; subscription.unsubscribe(); };
  }, [residentId, routeScope, supabase, taskIdFromQuery]);

  async function submitRound(draft: CompletionPayload) {
    if (!task || !owner || activeScope.current !== key || acknowledgedRounds.has(key)) return;
    const previous = pendingRounds.get(key);
    if (previous?.busy) return;
    const payload: CompletionPayload = previous ? {
      ...previous.payload,
      ...(previous.reasonRequired ? { lateReason: draft.lateReason?.trim() || null } : {}),
    } : { ...draft, requestId: crypto.randomUUID(), observedAt: new Date().toISOString(), retryOwner: owner };
    const round: PendingRound = { payload, owner, task, residentId, busy: true, reasonRequired: false, error: null };
    pendingRounds.set(key, round);
    publish();
    let reasonRequired = false;
    function acknowledge(message: string) {
      acknowledgedRounds.set(key, message);
      pendingRounds.delete(key);
      publish();
    }
    async function preserve() {
      // The queue validates the signed-in user too; the retained payload carries
      // the original session and facility for server-side retry validation.
      await assertOriginalSession(round.owner);
      await queueRoundingCompletion(round.task.id, round.residentId, payload, {
        ownerUserId: round.owner.userId, organizationId: round.owner.organizationId, facilityId: round.owner.facilityId,
      });
    }
    try {
      await assertOriginalSession(owner);
      if (activeScope.current !== key) throw new Error("Observation retained. Reopen this round to retry.");
      if (!navigator.onLine) {
        await preserve();
        acknowledge("Round queued for sync. It will upload automatically when the device reconnects.");
        return;
      }
      if (ownerKey(await currentOwner(owner.organizationId, owner.facilityId)) !== ownerKey(owner)) {
        throw new Error("The account or session changed. Sign in as the original operator to retry this observation.");
      }
      if (activeScope.current !== key) throw new Error("Observation retained. Reopen this round to retry.");
      const response = await fetch(`/api/rounding/tasks/${round.task.id}/complete`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const json = (await response.json()) as { error?: string; ok?: boolean; reasonRequired?: boolean };
      if (response.status === 409) {
        await preserve();
        acknowledge("This observation conflicts with a saved completion. It is retained in the Outbox for reconciliation.");
        return;
      }
      if (!response.ok) {
        reasonRequired = response.status === 400 && json.reasonRequired === true;
        throw new Error(json.error ?? "Could not complete round");
      }
      if (json.ok !== true) throw new Error("Save acknowledgment was incomplete. Retry the original observation.");
      acknowledge("Round saved successfully.");
    } catch (error) {
      let failure = error;
      if (shouldQueueRoundingRequest(error)) {
        try {
          await preserve();
          acknowledge("Connection lost. Round queued for sync and will upload automatically.");
          return;
        } catch (queueError) { failure = queueError; }
      }
      pendingRounds.set(key, { ...round, busy: false, reasonRequired,
        error: failure instanceof Error ? failure.message : "Could not preserve the observation. Keep this draft open." });
      publish();
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

  if (loading || loadedScope !== routeScope) {
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

      {loadError || pending?.error ? (
        <Card className="border-destructive/30 bg-destructive/10 text-foreground">
          <CardContent className="py-4 text-sm">{loadError ?? pending?.error}</CardContent>
        </Card>
      ) : null}

      {successMessage ? (
        <Card className="border-success/30 bg-success/10 text-foreground">
          <CardContent className="py-4 text-sm">{successMessage}</CardContent>
        </Card>
      ) : null}

      {!task || !owner || successMessage || (!pending && (taskQueuedLocally || task.derived_status.startsWith("completed_"))) ? (
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
          key={key}
          pendingPayload={pending?.payload}
          reasonRequired={pending?.reasonRequired}
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
