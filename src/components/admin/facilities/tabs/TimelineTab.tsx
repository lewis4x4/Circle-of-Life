"use client";

import React, { useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { useFacilityTimeline } from "@/hooks/useFacilityTimeline";
import { TIMELINE_EVENT_TYPES } from "@/lib/admin/facilities/facility-constants";
import type { TimelineEventInput } from "@/lib/validation/facility-admin";

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

export function TimelineTab({ facilityId }: TimelineTabProps) {
  const { events, isLoading, error, createEvent } = useFacilityTimeline(facilityId);
  const [filter, setFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<TimelineEventInput>({
    event_date: new Date().toISOString().slice(0, 10),
    event_type: "other",
    title: "",
    description: "",
  });

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
      setForm({
        event_date: new Date().toISOString().slice(0, 10),
        event_type: "other",
        title: "",
        description: "",
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
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
          className="rounded border px-3 py-2 text-sm"
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
          className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm text-white"
        >
          <Plus className="h-4 w-4" />
          Add event
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-lg border bg-white p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Date
              <input
                type="date"
                className="mt-1 w-full rounded border px-2 py-2"
                value={form.event_date}
                onChange={(e) => setForm((f) => ({ ...f, event_date: e.target.value }))}
                required
              />
            </label>
            <label className="text-sm">
              Type
              <select
                className="mt-1 w-full rounded border px-2 py-2"
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
          <label className="text-sm block">
            Title
            <input
              className="mt-1 w-full rounded border px-2 py-2"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
              minLength={3}
            />
          </label>
          <label className="text-sm block">
            Description
            <textarea
              className="mt-1 w-full rounded border px-2 py-2"
              rows={3}
              value={form.description ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value || undefined }))}
            />
          </label>
          <button type="submit" disabled={saving} className="rounded bg-teal-600 px-4 py-2 text-sm text-white">
            {saving ? "Saving…" : "Save event"}
          </button>
        </form>
      )}

      <ol className="relative border-l border-gray-200 ml-3 space-y-6">
        {filtered.map((ev) => (
          <li key={ev.id} className="ml-6">
            <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-white bg-teal-500" />
            <time className="text-xs text-muted-foreground">{ev.event_date}</time>
            <h4 className="font-semibold">{ev.title}</h4>
            <p className="text-xs text-muted-foreground">{TYPE_LABEL[ev.event_type] ?? ev.event_type}</p>
            {ev.description && <p className="text-sm mt-1">{ev.description}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
