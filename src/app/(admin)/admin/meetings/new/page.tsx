"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, NotebookPen } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  asStringArray,
  fetchActorContext,
  linesToArray,
  type MeetingTemplateRow,
  type QueryError,
  type QueryResult,
} from "@/lib/office/meetings";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

type RawTemplate = Omit<MeetingTemplateRow, "default_agenda"> & { default_agenda: unknown };

/** Local datetime-local input value for "now rounded up to the next half hour". */
function defaultScheduleValue(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + (30 - (d.getMinutes() % 30)) % 30, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminNewMeetingPage() {
  const supabase = createClient();
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();
  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  const [templates, setTemplates] = useState<MeetingTemplateRow[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [scheduledLocal, setScheduledLocal] = useState(defaultScheduleValue());
  const [agendaText, setAgendaText] = useState("");
  const [attendeesText, setAttendeesText] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!facilityReady) return;
    let cancelled = false;
    void (async () => {
      const res = (await supabase
        .from("meeting_templates" as never)
        .select("id, name, description, cadence, default_agenda")
        .eq("facility_id", selectedFacilityId as string)
        .is("deleted_at", null)
        .order("name", { ascending: true })
        .limit(50)) as unknown as QueryResult<RawTemplate>;
      if (!cancelled && !res.error) {
        setTemplates(
          (res.data ?? []).map((t) => ({ ...t, default_agenda: asStringArray(t.default_agenda) })),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, selectedFacilityId, facilityReady]);

  const applyTemplate = useCallback(
    (id: string) => {
      setTemplateId(id);
      const template = templates.find((t) => t.id === id);
      if (!template) return;
      if (!title.trim()) setTitle(template.name);
      if (!agendaText.trim()) setAgendaText(template.default_agenda.join("\n"));
    },
    [templates, title, agendaText],
  );

  const createMeeting = useCallback(async () => {
    if (!facilityReady) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setNotice("Meeting title is required.");
      return;
    }
    const scheduledAt = new Date(scheduledLocal);
    if (Number.isNaN(scheduledAt.getTime())) {
      setNotice("Enter a valid date and time.");
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Sign in required.");
      const res = (await supabase
        .from("meetings" as never)
        .insert({
          organization_id: actor.organizationId,
          facility_id: selectedFacilityId as string,
          template_id: templateId || null,
          title: trimmedTitle,
          scheduled_at: scheduledAt.toISOString(),
          agenda: linesToArray(agendaText),
          attendees: linesToArray(attendeesText),
          chaired_by: actor.userId,
          created_by: actor.userId,
          updated_by: actor.userId,
        } as never)
        .select("id")
        .single()) as unknown as { data: { id: string } | null; error: QueryError | null };
      if (res.error) throw new Error(res.error.message);
      if (!res.data?.id) throw new Error("Meeting creation returned no id.");
      router.push(`/admin/meetings/${res.data.id}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not create meeting.");
      setSaving(false);
    }
  }, [
    supabase,
    router,
    facilityReady,
    selectedFacilityId,
    templateId,
    title,
    scheduledLocal,
    agendaText,
    attendeesText,
  ]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6 max-w-2xl">
        <header className="mb-2 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
              <NotebookPen className="h-8 w-8 text-info shrink-0" aria-hidden />
              New meeting
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Pick a template to prefill the agenda, or start blank.
            </p>
          </div>
          <Link
            href="/admin/meetings"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "gap-2 font-medium text-[10px] uppercase tracking-wider",
            )}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Hub
          </Link>
        </header>

        {!facilityReady ? (
          <p className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-warning">
            Select a facility first — meetings are per-facility records.
          </p>
        ) : (
          <div className="rounded-[var(--radius)] border border-border bg-card p-5 space-y-4">
            {notice ? (
              <div
                className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
                role="status"
              >
                {notice}
              </div>
            ) : null}

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Template (optional)
              <select
                value={templateId}
                onChange={(e) => applyTemplate(e.target.value)}
                className="rounded-lg border border-input bg-card px-2.5 py-2 text-sm text-foreground"
              >
                <option value="">No template — blank meeting</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.cadence.replace(/_/g, " ")})
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                placeholder="e.g. Morning standup — Oakridge"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Scheduled (your local time)
              <input
                type="datetime-local"
                value={scheduledLocal}
                onChange={(e) => setScheduledLocal(e.target.value)}
                className="rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Agenda (one item per line)
              <textarea
                value={agendaText}
                onChange={(e) => setAgendaText(e.target.value)}
                rows={6}
                className="rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                placeholder={"Census & moves\nOvernight incidents\nStaffing\nOpen action items"}
              />
            </label>

            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Attendees (one per line)
              <textarea
                value={attendeesText}
                onChange={(e) => setAttendeesText(e.target.value)}
                rows={3}
                className="rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                placeholder={"Administrator\nDON\nDietary manager"}
              />
            </label>

            <div className="flex justify-end">
              <Button type="button" disabled={saving} onClick={() => void createMeeting()}>
                {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden /> : null}
                Create meeting
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
