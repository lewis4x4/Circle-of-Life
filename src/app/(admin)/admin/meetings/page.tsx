"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, ClipboardList, Loader2, NotebookPen, Plus } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button, buttonVariants } from "@/components/ui/button";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { MonolithicWatermark } from "@/components/ui/monolithic-watermark";
import { MotionItem, MotionList } from "@/components/ui/motion-list";
import { StatusPill } from "@/components/ui/status-pill";
import { V2Card } from "@/components/ui/v2-card";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  asStringArray,
  fetchActorContext,
  linesToArray,
  meetingStatusTone,
  type MeetingRow,
  type MeetingTemplateRow,
  type QueryError,
  type QueryResult,
} from "@/lib/office/meetings";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

type RawMeeting = Omit<MeetingRow, "agenda" | "attendees"> & {
  agenda: unknown;
  attendees: unknown;
};

type RawTemplate = Omit<MeetingTemplateRow, "default_agenda"> & { default_agenda: unknown };

function formatEt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export default function AdminMeetingsHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();

  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [templates, setTemplates] = useState<MeetingTemplateRow[]>([]);
  const [openActionItems, setOpenActionItems] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateCadence, setTemplateCadence] = useState("weekly");
  const [templateAgenda, setTemplateAgenda] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  const load = useCallback(async () => {
    if (!facilityReady) {
      setMeetings([]);
      setTemplates([]);
      setOpenActionItems(0);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const meetingsQ = supabase
        .from("meetings" as never)
        .select("id, template_id, title, scheduled_at, status, agenda, minutes, attendees")
        .eq("facility_id", selectedFacilityId as string)
        .is("deleted_at", null)
        .order("scheduled_at", { ascending: false })
        .limit(100);
      const templatesQ = supabase
        .from("meeting_templates" as never)
        .select("id, name, description, cadence, default_agenda")
        .eq("facility_id", selectedFacilityId as string)
        .is("deleted_at", null)
        .order("name", { ascending: true })
        .limit(50);
      const actionsQ = supabase
        .from("meeting_action_items" as never)
        .select("id", { count: "exact", head: true })
        .eq("facility_id", selectedFacilityId as string)
        .eq("status", "open")
        .is("deleted_at", null);

      const [meetingsRes, templatesRes, actionsRes] = await Promise.all([
        meetingsQ as unknown as Promise<QueryResult<RawMeeting>>,
        templatesQ as unknown as Promise<QueryResult<RawTemplate>>,
        actionsQ as unknown as Promise<{ count: number | null; error: QueryError | null }>,
      ]);
      if (meetingsRes.error) throw new Error(meetingsRes.error.message);
      if (templatesRes.error) throw new Error(templatesRes.error.message);
      if (actionsRes.error) throw new Error(actionsRes.error.message);

      setMeetings(
        (meetingsRes.data ?? []).map((m) => ({
          ...m,
          agenda: asStringArray(m.agenda),
          attendees: asStringArray(m.attendees),
        })),
      );
      setTemplates(
        (templatesRes.data ?? []).map((t) => ({
          ...t,
          default_agenda: asStringArray(t.default_agenda),
        })),
      );
      setOpenActionItems(actionsRes.count ?? 0);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load meetings.");
      setMeetings([]);
      setTemplates([]);
    } finally {
      setIsLoading(false);
    }
  }, [supabase, selectedFacilityId, facilityReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const upcoming = useMemo(
    () =>
      meetings.filter(
        (m) => m.status === "scheduled" && new Date(m.scheduled_at).getTime() >= Date.now() - 60 * 60 * 1000,
      ).length,
    [meetings],
  );

  const completedThisMonth = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return meetings.filter(
      (m) => m.status === "completed" && new Date(m.scheduled_at).getTime() >= monthStart,
    ).length;
  }, [meetings]);

  const createTemplate = useCallback(async () => {
    const name = templateName.trim();
    if (!name) {
      setNotice("Template name is required.");
      return;
    }
    if (!facilityReady) return;
    setSavingTemplate(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Sign in required.");
      const res = (await supabase.from("meeting_templates" as never).insert({
        organization_id: actor.organizationId,
        facility_id: selectedFacilityId as string,
        name,
        cadence: templateCadence,
        default_agenda: linesToArray(templateAgenda),
        created_by: actor.userId,
        updated_by: actor.userId,
      } as never)) as { error: QueryError | null };
      if (res.error) throw new Error(res.error.message);
      setTemplateName("");
      setTemplateAgenda("");
      setShowTemplateForm(false);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not create template.");
    } finally {
      setSavingTemplate(false);
    }
  }, [supabase, facilityReady, selectedFacilityId, templateName, templateCadence, templateAgenda, load]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
              <NotebookPen className="h-8 w-8 text-info shrink-0" aria-hidden />
              Meeting hub
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Recurring meeting templates, agendas, in-app minutes, and action items that become
              escalation-chased operations tasks. Replaces the standup call log spreadsheet.
              Per-facility, RLS-scoped; minutes are audit-logged.
            </p>
          </div>
          <Link
            href="/admin/meetings/new"
            className={cn(
              buttonVariants({ size: "default" }),
              "shrink-0 gap-2 font-medium text-[10px] uppercase tracking-wider",
              !facilityReady && "pointer-events-none opacity-50",
            )}
            aria-disabled={!facilityReady}
          >
            <Plus className="h-4 w-4" aria-hidden />
            New meeting
          </Link>
        </header>

        {!facilityReady ? (
          <p className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-warning">
            Select a facility first — meetings are per-facility records.
          </p>
        ) : null}

        {notice ? (
          <div
            className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
            role="status"
          >
            {notice}
          </div>
        ) : null}

        {facilityReady ? (
          <KineticGrid className="grid-cols-1 sm:grid-cols-3 gap-4 mb-2" staggerMs={60}>
            {[
              { label: "Upcoming meetings", value: upcoming, icon: CalendarClock },
              { label: "Completed this month", value: completedThisMonth, icon: NotebookPen },
              { label: "Open action items", value: openActionItems, icon: ClipboardList },
            ].map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.label} className="h-[120px]">
                  <V2Card hoverColor="blue" className="p-5">
                    <MonolithicWatermark
                      value={card.value}
                      className="text-muted-foreground/10 opacity-50"
                    />
                    <div className="relative z-10 flex h-full flex-col justify-center gap-1">
                      <h3 className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5" aria-hidden /> {card.label}
                      </h3>
                      <p className="text-3xl font-mono tracking-tighter text-foreground tabular-nums">
                        {card.value}
                      </p>
                    </div>
                  </V2Card>
                </div>
              );
            })}
          </KineticGrid>
        ) : null}

        {facilityReady && isLoading ? <AdminTableLoadingState /> : null}
        {facilityReady && !isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {facilityReady && !isLoading && !loadError ? (
          <>
            <section aria-labelledby="meetings-templates-heading" className="space-y-3">
              <div className="flex items-center justify-between gap-3 px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
                <h3 id="meetings-templates-heading" className="text-lg font-semibold text-foreground">
                  Templates
                  <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                    {templates.length}
                  </span>
                </h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="font-medium text-[10px] uppercase tracking-wider"
                  onClick={() => setShowTemplateForm((v) => !v)}
                >
                  {showTemplateForm ? "Close" : "New template"}
                </Button>
              </div>

              {showTemplateForm ? (
                <div className="rounded-[var(--radius)] border border-border bg-card p-4 space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      Template name
                      <input
                        value={templateName}
                        onChange={(e) => setTemplateName(e.target.value)}
                        className="rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                        placeholder="e.g. Morning standup, QA committee, Safety committee"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      Cadence
                      <select
                        value={templateCadence}
                        onChange={(e) => setTemplateCadence(e.target.value)}
                        className="rounded-lg border border-input bg-card px-2.5 py-2 text-sm text-foreground"
                      >
                        {["daily", "weekly", "biweekly", "monthly", "quarterly", "ad_hoc"].map((c) => (
                          <option key={c} value={c}>
                            {c.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    Default agenda (one item per line)
                    <textarea
                      value={templateAgenda}
                      onChange={(e) => setTemplateAgenda(e.target.value)}
                      rows={4}
                      className="rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                      placeholder={"Census & moves\nOvernight incidents\nStaffing\nAction item review"}
                    />
                  </label>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      disabled={savingTemplate}
                      onClick={() => void createTemplate()}
                    >
                      {savingTemplate ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden /> : null}
                      Save template
                    </Button>
                  </div>
                </div>
              ) : null}

              {templates.length === 0 && !showTemplateForm ? (
                <p className="text-sm text-muted-foreground pl-2">
                  No templates yet. Create standup, QA, and safety committee templates so meetings
                  start with a consistent agenda.
                </p>
              ) : null}
              {templates.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-3">
                  {templates.map((t) => (
                    <div key={t.id} className="rounded-[var(--radius)] border border-border bg-card p-4 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground truncate">{t.name}</span>
                        <StatusPill tone="muted">{t.cadence.replace(/_/g, " ")}</StatusPill>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t.default_agenda.length} agenda item{t.default_agenda.length === 1 ? "" : "s"}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            <section aria-labelledby="meetings-list-heading" className="space-y-3">
              <div className="flex items-center justify-between gap-3 px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
                <h3 id="meetings-list-heading" className="text-lg font-semibold text-foreground">
                  Meetings
                  <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                    {meetings.length}
                  </span>
                </h3>
              </div>
              {meetings.length === 0 ? (
                <AdminEmptyState
                  title="No meetings recorded yet"
                  description="Create the first meeting — agendas, minutes, and action items live here instead of the call log spreadsheet."
                />
              ) : (
                <MotionList className="space-y-3">
                  {meetings.map((m) => (
                    <MotionItem key={m.id}>
                      <Link
                        href={`/admin/meetings/${m.id}`}
                        className="flex flex-col gap-2 min-h-[36px] px-[13px] py-2 rounded-[9px] border border-border bg-card hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] lg:flex-row lg:items-center lg:justify-between w-full"
                      >
                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                          <span className="font-semibold text-foreground truncate">{m.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatEt(m.scheduled_at)} ET · {m.agenda.length} agenda item
                            {m.agenda.length === 1 ? "" : "s"}
                            {m.minutes ? " · minutes recorded" : ""}
                          </span>
                        </div>
                        <StatusPill tone={meetingStatusTone(m.status)}>{m.status.replace(/_/g, " ")}</StatusPill>
                      </Link>
                    </MotionItem>
                  ))}
                </MotionList>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
