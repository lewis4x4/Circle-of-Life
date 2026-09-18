"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  addWitness,
  describeWitnessError,
  fetchWitnessCandidates,
  fetchWitnessTasksForIncident,
  removeWitness,
  witnessChoiceLabel,
  witnessSummaryLine,
  type WitnessTask,
} from "@/lib/care-events/witness";
import { formatClockTime } from "@/lib/care-events/admin-copy";
import { createClient } from "@/lib/supabase/client";

export type CareEventWitnessesProps = {
  careEventId: string;
  incidentId: string | null;
  facilityId: string;
  timeZone: string;
  /** Completion is the Administrator's; a read-only role sees the list only. */
  canManage: boolean;
};

/**
 * Section 3 of the paper incident form on the Administrator's card: who was
 * asked, what they answered, and the two controls the paper form's blank lines
 * stood in for — add a witness the roster missed, withdraw one nobody answered.
 *
 * A statement that has been given is never removable here; the database refuses
 * it too. Testimony stays on the record.
 */
export function CareEventWitnesses({ careEventId, incidentId, facilityId, timeZone, canManage }: CareEventWitnessesProps) {
  const supabase = useMemo(() => createClient(), []);
  const [tasks, setTasks] = useState<WitnessTask[] | null>(null);
  const [candidates, setCandidates] = useState<Array<{ userId: string; name: string }>>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!incidentId) {
      setTasks([]);
      return;
    }
    try {
      setTasks(await fetchWitnessTasksForIncident(supabase, incidentId));
    } catch (caught) {
      setError(describeWitnessError(caught));
      setTasks([]);
    }
  }, [supabase, incidentId]);

  useEffect(() => {
    if (!incidentId) {
      setTasks([]);
      return;
    }
    let current = true;
    setTasks(null);
    fetchWitnessTasksForIncident(supabase, incidentId)
      .then((next) => {
        if (current) setTasks(next);
      })
      .catch((caught) => {
        if (!current) return;
        setError(describeWitnessError(caught));
        setTasks([]);
      });
    return () => {
      current = false;
    };
  }, [supabase, incidentId]);

  async function openAdd() {
    setError(null);
    setAdding(true);
    if (candidates.length === 0) {
      try {
        setCandidates(await fetchWitnessCandidates(supabase, facilityId));
      } catch (caught) {
        setError(describeWitnessError(caught));
      }
    }
  }

  async function add(userId: string) {
    setError(null);
    setBusy(true);
    try {
      await addWitness(supabase, careEventId, userId);
      setAdding(false);
      await load();
    } catch (caught) {
      setError(describeWitnessError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove(followupId: string) {
    setError(null);
    setBusy(true);
    try {
      await removeWitness(supabase, followupId, "withdrawn_by_administrator");
      await load();
    } catch (caught) {
      setError(describeWitnessError(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!incidentId) {
    return <p className="text-sm text-muted-foreground">A Note has no incident record, so no witness statement is asked for.</p>;
  }

  if (tasks === null) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        Loading witness statements
      </p>
    );
  }

  const alreadyAsked = new Set(tasks.map((task) => task.assignedTo).filter((id): id is string => Boolean(id)));
  const addable = candidates.filter((candidate) => !alreadyAsked.has(candidate.userId));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{witnessSummaryLine(tasks)}</p>

      {tasks.length > 0 ? (
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{task.assignedToName ?? "Not assigned"}</p>
                <p className="text-sm text-muted-foreground">
                  {task.completedAt
                    ? `${witnessChoiceLabel(task.choice)} · ${formatClockTime(task.completedAt, timeZone) ?? "time not recorded"}`
                    : "Waiting for their answer"}
                </p>
                {task.note ? <p className="mt-1 text-sm text-foreground">{task.note}</p> : null}
              </div>
              {canManage && !task.completedAt ? (
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void remove(task.id)}>
                  <X className="size-4" aria-hidden />
                  Withdraw
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canManage ? (
        adding ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Who else was there?</p>
            {addable.length === 0 ? (
              <p className="text-sm text-muted-foreground">Everyone on this facility&rsquo;s roster has already been asked.</p>
            ) : (
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {addable.map((candidate) => (
                  <li key={candidate.userId}>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full justify-start"
                      disabled={busy}
                      onClick={() => void add(candidate.userId)}
                    >
                      {candidate.name}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void openAdd()}>
            <Plus className="size-4" aria-hidden />
            Add a witness
          </Button>
        )
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
