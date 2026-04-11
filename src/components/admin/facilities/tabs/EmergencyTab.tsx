"use client";

import React, { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { useFacilityEmergencyContacts } from "@/hooks/useFacilityEmergencyContacts";
import {
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABELS,
} from "@/lib/admin/facilities/facility-constants";
import type { EmergencyContactInput } from "@/lib/validation/facility-admin";

interface EmergencyTabProps {
  facilityId: string;
}

export function EmergencyTab({ facilityId }: EmergencyTabProps) {
  const { contacts, isLoading, error, createContact } = useFacilityEmergencyContacts(facilityId);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<EmergencyContactInput>({
    contact_category: "other",
    contact_name: "",
    phone_primary: "",
    sort_order: 0,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await createContact(form);
      setShowForm(false);
      setForm({
        contact_category: "other",
        contact_name: "",
        phone_primary: "",
        sort_order: 0,
      });
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Failed to save");
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
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  const grouped = contacts.reduce<Record<string, typeof contacts>>((acc, c) => {
    const k = c.contact_category;
    if (!acc[k]) acc[k] = [];
    acc[k].push(c);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          County and vendor emergency numbers for this site. Owner/org_admin can add entries.
        </p>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700"
        >
          <Plus className="h-4 w-4" />
          Add contact
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-muted-foreground">Category</span>
              <select
                className="mt-1 w-full rounded border px-2 py-2"
                value={form.contact_category}
                onChange={(e) =>
                  setForm((f) => ({ ...f, contact_category: e.target.value as EmergencyContactInput["contact_category"] }))
                }
              >
                {CONTACT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CONTACT_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Name / label</span>
              <input
                className="mt-1 w-full rounded border px-2 py-2"
                value={form.contact_name}
                onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
                required
              />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Primary phone</span>
              <input
                className="mt-1 w-full rounded border px-2 py-2"
                value={form.phone_primary}
                onChange={(e) => setForm((f) => ({ ...f, phone_primary: e.target.value }))}
                required
              />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Secondary phone</span>
              <input
                className="mt-1 w-full rounded border px-2 py-2"
                value={form.phone_secondary ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, phone_secondary: e.target.value || undefined }))}
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save contact"}
          </button>
        </form>
      )}

      <div className="space-y-6">
        {Object.entries(grouped).map(([cat, list]) => (
          <div key={cat} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-800">
              {CONTACT_CATEGORY_LABELS[cat as keyof typeof CONTACT_CATEGORY_LABELS] ?? cat}
            </div>
            <ul className="divide-y">
              {list.map((c) => (
                <li key={c.id} className="px-4 py-3 flex flex-wrap gap-2 justify-between">
                  <div>
                    <p className="font-medium">{c.contact_name}</p>
                    <p className="text-sm text-muted-foreground">{c.phone_primary}</p>
                    {c.phone_secondary && (
                      <p className="text-xs text-muted-foreground">Alt: {c.phone_secondary}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
