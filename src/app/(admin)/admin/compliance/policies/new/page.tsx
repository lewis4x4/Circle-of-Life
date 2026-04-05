"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  "resident_rights",
  "admission",
  "care_delivery",
  "medication",
  "incident_reporting",
  "infection_control",
  "emergency_preparedness",
  "staffing",
  "dietary",
  "maintenance",
  "privacy_hipaa",
  "grievance",
  "other",
] as const;

export default function NewPolicyPage() {
  const router = useRouter();
  const { selectedFacilityId } = useFacilityStore();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [content, setContent] = useState("");
  const [publishNow, setPublishNow] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setError("Select a facility.");
      return;
    }
    if (!title.trim() || !content.trim()) {
      setError("Title and content are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Not signed in.");
        return;
      }
      const fac = await supabase.from("facilities").select("organization_id").eq("id", selectedFacilityId).single();
      if (fac.error || !fac.data?.organization_id) {
        setError("Could not resolve organization.");
        return;
      }
      const now = new Date().toISOString();
      const { data, error: insErr } = await supabase
        .from("policy_documents")
        .insert({
          facility_id: selectedFacilityId,
          organization_id: fac.data.organization_id,
          title: title.trim(),
          category,
          content: content.trim(),
          status: publishNow ? "published" : "draft",
          published_at: publishNow ? now : null,
          published_by: publishNow ? user.id : null,
          requires_acknowledgment: true,
          acknowledgment_due_days: 10,
          created_by: user.id,
          updated_by: user.id,
        })
        .select("id")
        .single();
      if (insErr || !data) {
        setError(insErr?.message ?? "Could not save.");
        return;
      }
      router.push(`/admin/compliance/policies/${data.id}/edit`);
    } finally {
      setBusy(false);
    }
  }

  if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
    return (
      <p className="text-sm text-slate-500">
        Select a facility first.{" "}
        <Link href="/admin/compliance/policies" className="underline">
          Back
        </Link>
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/admin/compliance/policies" className="text-sm text-slate-600 hover:underline dark:text-slate-400">
          ← Policies
        </Link>
        <h1 className="mt-2 font-display text-2xl font-semibold text-slate-900 dark:text-slate-100">New policy</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Document</CardTitle>
          <CardDescription>Draft first, or publish to start the acknowledgment clock.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(e) => void submit(e)}>
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat">Category</Label>
              <select
                id="cat"
                className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="content">Content (Markdown or plain text)</Label>
              <textarea
                id="content"
                className="min-h-[200px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                required
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} />
              Publish immediately (starts acknowledgment period)
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
              <Link href="/admin/compliance/policies" className={cn(buttonVariants({ variant: "outline" }))}>
                Cancel
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
