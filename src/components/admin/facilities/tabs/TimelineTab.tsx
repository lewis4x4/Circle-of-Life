"use client";

import React, { useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { useFacilityTimeline } from "@/hooks/useFacilityTimeline";
import { TIMELINE_EVENT_TYPES } from "@/lib/admin/facilities/facility-constants";
import {
  TIMELINE_TAB_NO_EVENTS_COPY,
  createDefaultTimelineEventForm,
} from "@/lib/facilities/timeline-tab-display-copy";
import type { TimelineEventInput } from "@/lib/validation/facility-admin";
import { DateInput } from "@/components/ui/date-input";
import { cn } from "@/lib/utils";

interface TimelineTabProps {
  facilityId: string;
}

const TYPE_LABEL: Record<string, string> = {
  opened: "Opened",
  ownership_change: "Ownership change",
  administrator_change: "Administrator change",
  renovation: "Renovation",
  survey: "Survey",
  license_renewal: "License renewal",
  insurance_renewal: "Insurance renewal",
  capacity_change: "Capacity change",
  vendor_change: "Vendor change",
  rate_change: "Rate change",
  policy_change: "Policy change",
  incident_major: "Major incident",
  recognition: "Recognition",
  other: "Other",
};

const inputCls = "mt-1 w-full rounded-[8px] border border-border bg-background px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

export function TimelineTab({ facilityId }: TimelineTabProps) {
  const { events, isLoading, error, createEvent } = useFacilityTimeline(facilityId);
  const [filter, setFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<TimelineEventInput>(() => createDefaultTimelineEventForm());

  const filtered = useMemo(() => {
    if (filter === "all") return events;
    return events.filter((e) => e.event_type === filter);
  }, [events, filter]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await createEvent(form);
      setShowForm(false);
      setForm(createDefaultTimelineEventForm());
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 justify-between items-center">
        <select
          className="rounded-[8px] border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All event types</option>
          {TIMELINE_EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t] ?? t}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-2 rounded-[8px] bg-primary px-3 py-2 text-sm text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          Add event
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-[8px] border border-border bg-muted/10 p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-foreground">
              Date
              <DateInput
                aria-label="Event date"
                className={cn("mt-1", inputCls)}
                value={form.event_date}
                onValueChange={(v) => setForm((f) => ({ ...f, event_date: v }))}
                required
                emptyHint={null}
              />
            </label>
            <label className="text-sm text-foreground">
              Type
              <select
                className={inputCls}
                value={form.event_type}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    event_type: e.target.value as TimelineEventInput["event_type"],
                  }))
                }
              >
                {TIMELINE_EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t] ?? t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="text-sm text-foreground block">
            Title
            <input
              className={inputCls}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
              minLength={3}
            />
          </label>
          <label className="text-sm text-foreground block">
            Description
            <textarea
              className={inputCls}
              rows={3}
              value={form.description ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value || undefined }))}
            />
          </label>
          <button type="submit" disabled={saving} className="rounded-[8px] bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">
            {saving ? "Saving…" : "Save event"}
          </button>
        </form>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{TIMELINE_TAB_NO_EVENTS_COPY}</p>
      ) : (
        <ol className="relative border-l border-border ml-3 space-y-6">
          {filtered.map((ev) => (
            <li key={ev.id} className="ml-6">
              <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-border bg-primary" />
              <time className="text-xs text-muted-foreground tabular-nums">{ev.event_date}</time>
              <h4 className="font-semibold text-foreground">{ev.title}</h4>
              <p className="text-xs text-muted-foreground">{TYPE_LABEL[ev.event_type] ?? ev.event_type}</p>
              {ev.description && <p className="text-sm mt-1 text-foreground">{ev.description}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
