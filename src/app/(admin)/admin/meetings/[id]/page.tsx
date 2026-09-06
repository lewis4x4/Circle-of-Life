"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, ClipboardList, Loader2, NotebookPen } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import {
  asStringArray,
  fetchActorContext,
  meetingStatusTone,
  type ActionItemRow,
  type MeetingRow,
  type MeetingStatus,
  type QueryError,
  type QueryResult,
} from "@/lib/office/meetings";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type RawMeeting = Omit<MeetingRow, "agenda" | "attendees"> & {
  agenda: unknown;
  attendees: unknown;
  facility_id: string;
};

type ProfileOption = { id: string; full_name: string };

function formatEt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function todayIsoEt(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export default function AdminMeetingDetailPage() {
  const supabase = createClient();
  const params = useParams<{ id: string }>();
  const meetingId = params.id;

  const [meeting, setMeeting] = useState<(MeetingRow & { facility_id: string }) | null>(null);
  const [actionItems, setActionItems] = useState<ActionItemRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const minutesBaseline = useRef<string | null>(null);
  const minutesHydratedFor = useRef<string | null>(null);
  const [actionId, setActionId] = useState(() => crypto.randomUUID());
  const [minutesDraft, setMinutesDraft] = useState("");
  const [savingMinutes, setSavingMinutes] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const [newItemDescription, setNewItemDescription] = useState("");
  const [newItemAssignee, setNewItemAssignee] = useState("");
  const [newItemDueDate, setNewItemDueDate] = useState(todayIsoEt());
  const [savingItem, setSavingItem] = useState(false);
  const [itemBusyId, setItemBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const meetingQ = supabase
        .from("meetings" as never)
        .select(
          "id, facility_id, template_id, title, scheduled_at, status, agenda, minutes, attendees",
        )
        .eq("id", meetingId)
        .is("deleted_at", null)
        .maybeSingle();
      const itemsQ = supabase
        .from("meeting_action_items" as never)
        .select("id, meeting_id, description, assigned_to, due_date, status, oce_task_instance_id")
        .eq("meeting_id", meetingId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      const profilesQ = supabase
        .from("user_profiles")
        .select("id, full_name")
        .is("deleted_at", null)
        .eq("is_active", true)
        .order("full_name", { ascending: true })
        .limit(200);

      const [meetingRes, itemsRes, profilesRes] = await Promise.all([
        meetingQ as unknown as Promise<{ data: RawMeeting | null; error: QueryError | null }>,
        itemsQ as unknown as Promise<QueryResult<ActionItemRow>>,
        profilesQ as unknown as Promise<QueryResult<ProfileOption>>,
      ]);
      if (meetingRes.error) throw new Error(meetingRes.error.message);
      if (itemsRes.error) throw new Error(itemsRes.error.message);
      if (profilesRes.error) throw new Error(profilesRes.error.message);
      if (!meetingRes.data) throw new Error("Meeting not found or not accessible.");

      const raw = meetingRes.data;
      setMeeting({
        ...raw,
        agenda: asStringArray(raw.agenda),
        attendees: asStringArray(raw.attendees),
      });
      if (minutesHydratedFor.current !== meetingId) { setMinutesDraft(raw.minutes ?? ""); minutesBaseline.current = raw.minutes; minutesHydratedFor.current = meetingId; }
      setActionItems(itemsRes.data ?? []);
      setProfiles(profilesRes.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load meeting.");
      setMeeting(null);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, meetingId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateMeeting = useCallback(
    async (patch: Record<string, unknown>, busySetter: (v: boolean) => void) => {
      busySetter(true);
      setNotice(null);
      try {
        const actor = await fetchActorContext(supabase);
        if (!actor) throw new Error("Sign in required.");
        let query = supabase.from("meetings" as never)
          .update({ ...patch, updated_by: actor.userId } as never).eq("id", meetingId).is("deleted_at", null);
        if ("minutes" in patch) query = minutesBaseline.current === null ? query.is("minutes", null) : query.eq("minutes", minutesBaseline.current);
        const res = await query.select("id").single();
        if (res.error) throw new Error("Meeting changed or could not be saved. Your draft is preserved; reload in another tab to compare before retrying.");
        if ("minutes" in patch) minutesBaseline.current = patch.minutes as string | null;
        await load();
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Update failed.");
      } finally {
        busySetter(false);
      }
    },
    [supabase, meetingId, load],
  );

  const saveMinutes = useCallback(
    () => updateMeeting({ minutes: minutesDraft.trim() || null }, setSavingMinutes),
    [updateMeeting, minutesDraft],
  );

  const setStatus = useCallback(
    (status: MeetingStatus) => updateMeeting({ status }, setStatusBusy),
    [updateMeeting],
  );

  const addActionItem = useCallback(async () => {
    if (!meeting) return;
    const description = newItemDescription.trim();
    if (!description) {
      setNotice("Action item description is required.");
      return;
    }
    if (!newItemDueDate) {
      setNotice("Due date is required so the OCE task can be scheduled.");
      return;
    }
    setSavingItem(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Sign in required.");

      const response = await fetch(`/api/admin/meetings/${meeting.id}/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        id: actionId, description, assigned_to: newItemAssignee || null, due_date: newItemDueDate,
      }) });
      const result = await response.json();
      if (!response.ok || result.id !== actionId) throw new Error(result.error ?? "Action save was not acknowledged.");
      setActionId(crypto.randomUUID());

      setNewItemDescription("");
      setNewItemAssignee("");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not add action item.");
    } finally {
      setSavingItem(false);
    }
  }, [supabase, meeting, newItemDescription, newItemAssignee, newItemDueDate, actionId, load]);

  const completeActionItem = useCallback(
    async (item: ActionItemRow) => {
      setItemBusyId(item.id);
      setNotice(null);
      try {
        const actor = await fetchActorContext(supabase);
        if (!actor) throw new Error("Sign in required.");
        const { error: completionError } = await supabase.from("meeting_action_items" as never)
          .update({ status: "completed", updated_by: actor.userId } as never)
          .eq("id", item.id).is("deleted_at", null).select("id").single();
        if (completionError) throw new Error(completionError.message);
        await load();
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Could not complete action item.");
      } finally {
        setItemBusyId(null);
      }
    },
    [supabase, load],
  );

  const profileName = useCallback(
    (id: string | null) => {
      if (!id) return "Unassigned";
      return profiles.find((p) => p.id === id)?.full_name ?? "Assigned user";
    },
    [profiles],
  );

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6 max-w-4xl">
        <header className="mb-2 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
              <NotebookPen className="h-8 w-8 text-info shrink-0" aria-hidden />
              <span className="truncate">{meeting?.title ?? "Meeting"}</span>
            </h2>
            {meeting ? (
              <p className="text-sm text-muted-foreground mt-1">
                {formatEt(meeting.scheduled_at)} ET
              </p>
            ) : null}
          </div>
          <Link
            href="/admin/meetings"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "gap-2 font-medium text-[10px] uppercase tracking-wider shrink-0",
            )}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Hub
          </Link>
        </header>

        {notice ? (
          <div
            className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
            role="status"
          >
            {notice}
          </div>
        ) : null}

        {isLoading ? <AdminTableLoadingState /> : null}
        {!isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {!isLoading && !loadError && meeting ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={meetingStatusTone(meeting.status)}>
                {meeting.status.replace(/_/g, " ")}
              </StatusPill>
              {meeting.status === "scheduled" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={statusBusy}
                  onClick={() => void setStatus("in_progress")}
                >
                  Start meeting
                </Button>
              ) : null}
              {meeting.status === "scheduled" || meeting.status === "in_progress" ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    disabled={statusBusy}
                    onClick={() => void setStatus("completed")}
                  >
                    Complete
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={statusBusy}
                    onClick={() => void setStatus("cancelled")}
                  >
                    Cancel meeting
                  </Button>
                </>
              ) : null}
            </div>

            <section className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[var(--radius)] border border-border bg-card p-4 space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Agenda</h3>
                {meeting.agenda.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No agenda items.</p>
                ) : (
                  <ol className="list-decimal pl-5 space-y-1 text-sm text-foreground">
                    {meeting.agenda.map((item, idx) => (
                      <li key={`${idx}-${item}`}>{item}</li>
                    ))}
                  </ol>
                )}
              </div>
              <div className="rounded-[var(--radius)] border border-border bg-card p-4 space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Attendees</h3>
                {meeting.attendees.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No attendees recorded.</p>
                ) : (
                  <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
                    {meeting.attendees.map((name, idx) => (
                      <li key={`${idx}-${name}`}>{name}</li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="rounded-[var(--radius)] border border-border bg-card p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Minutes</h3>
              <p className="text-xs text-muted-foreground">
                Stored on the meeting record and audit-logged — survey evidence for QA and safety
                committee documentation.
              </p>
              <textarea
                value={minutesDraft}
                onChange={(e) => setMinutesDraft(e.target.value)}
                rows={8}
                className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                placeholder="Discussion notes, decisions, follow-ups…"
                aria-label="Meeting minutes"
              />
              <p className="text-xs text-muted-foreground" role="status">{savingMinutes ? "Saving minutes…" : minutesDraft.trim() !== (meeting?.minutes ?? "").trim() ? "Unsaved minutes" : "Minutes saved"}</p>
              <div className="flex justify-end">
                <Button type="button" size="sm" disabled={savingMinutes} onClick={() => void saveMinutes()}>
                  {savingMinutes ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden /> : null}
                  Save minutes
                </Button>
              </div>
            </section>

            <section className="rounded-[var(--radius)] border border-border bg-card p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-warning" aria-hidden />
                Action items
                <span className="text-sm font-normal text-muted-foreground tabular-nums">
                  {actionItems.length}
                </span>
              </h3>
              <p className="text-xs text-muted-foreground">
                Each action item is created as an operations task instance, so the existing OCE
                escalation chasing applies until it is completed.
              </p>

              <div className="grid gap-3 md:grid-cols-[1fr_220px_150px_auto] md:items-end">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Description
                  <input
                    value={newItemDescription}
                    onChange={(e) => setNewItemDescription(e.target.value)}
                    className="rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                    placeholder="e.g. Post updated fire drill schedule"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Assignee
                  <select
                    value={newItemAssignee}
                    onChange={(e) => setNewItemAssignee(e.target.value)}
                    className="rounded-lg border border-input bg-card px-2.5 py-2 text-sm text-foreground"
                  >
                    <option value="">Unassigned</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Due date
                  <input
                    type="date"
                    value={newItemDueDate}
                    onChange={(e) => setNewItemDueDate(e.target.value)}
                    className="rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                  />
                </label>
                <Button type="button" size="sm" disabled={savingItem} onClick={() => void addActionItem()}>
                  {savingItem ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden /> : null}
                  Add
                </Button>
              </div>

              {actionItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">No action items yet.</p>
              ) : (
                <ul className="space-y-2">
                  {actionItems.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-col gap-2 min-h-[36px] px-[13px] py-2 rounded-[9px] border border-border bg-card lg:flex-row lg:items-center lg:justify-between"
                    >
                      <div className="flex flex-col gap-1 min-w-0 flex-1">
                        <span
                          className={cn(
                            "font-medium text-foreground",
                            item.status === "completed" && "line-through text-muted-foreground",
                          )}
                        >
                          {item.description}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {profileName(item.assigned_to)}
                          {item.due_date ? ` · due ${item.due_date}` : ""}
                          {item.oce_task_instance_id ? " · Tracked in operations" : ""}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {item.status === "open" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={itemBusyId !== null}
                            onClick={() => void completeActionItem(item)}
                          >
                            {itemBusyId === item.id ? (
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
                            ) : (
                              <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                            )}
                            Complete
                          </Button>
                        ) : null}
                        <StatusPill tone={item.status === "open" ? "warning" : "muted"}>
                          {item.status}
                        </StatusPill>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
