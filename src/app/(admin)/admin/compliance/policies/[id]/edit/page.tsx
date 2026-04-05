"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export default function EditPolicyPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("");
  const [ackInfo, setAckInfo] = useState<{ acknowledged: number; eligible: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data, error: qErr } = await supabase
      .from("policy_documents")
      .select("id, title, content, status, facility_id, requires_acknowledgment, published_at")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (qErr || !data) {
      setError(qErr?.message ?? "Not found");
      setLoading(false);
      return;
    }
    setTitle(data.title);
    setContent(data.content);
    setStatus(data.status);
    setError(null);

    if (data.status === "published" && data.requires_acknowledgment) {
      const { count: ackCount } = await supabase
        .from("policy_acknowledgments")
        .select("id", { count: "exact", head: true })
        .eq("policy_document_id", id);

      const { data: ufaRows } = await supabase
        .from("user_facility_access")
        .select("user_id")
        .eq("facility_id", data.facility_id)
        .is("revoked_at", null);

      const userIds = Array.from(new Set((ufaRows ?? []).map((r) => r.user_id)));
      let eligible = 0;
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from("user_profiles").select("id, app_role").in("id", userIds);
        const staffRoles = new Set([
          "owner",
          "org_admin",
          "facility_admin",
          "nurse",
          "caregiver",
          "dietary",
          "maintenance_role",
        ]);
        eligible = (profiles ?? []).filter((p) => staffRoles.has(p.app_role as string)).length;
      }
      setAckInfo({ acknowledged: ackCount ?? 0, eligible });
    } else {
      setAckInfo(null);
    }

    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!id || status !== "draft") return;
    setSaving(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error: upErr } = await supabase
        .from("policy_documents")
        .update({ title: title.trim(), content: content.trim(), updated_by: user?.id ?? null })
        .eq("id", id);
      if (upErr) setError(upErr.message);
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const now = new Date().toISOString();
      const { error: upErr } = await supabase
        .from("policy_documents")
        .update({
          status: "published",
          published_at: now,
          published_by: user?.id ?? null,
          updated_by: user?.id ?? null,
        })
        .eq("id", id);
      if (upErr) setError(upErr.message);
      else await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  if (error && !title) {
    return (
      <div>
        <p className="text-red-600">{error}</p>
        <Link href="/admin/compliance/policies" className={cn(buttonVariants({ variant: "outline" }), "mt-4")}>
          Back
        </Link>
      </div>
    );
  }

  const readOnly = status === "published" || status === "archived";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/admin/compliance/policies" className="text-sm text-slate-600 hover:underline dark:text-slate-400">
          ← Policies
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="font-display text-2xl font-semibold text-slate-900 dark:text-slate-100">Edit policy</h1>
          <Badge>{status}</Badge>
        </div>
      </div>

      {ackInfo ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Acknowledgments</CardTitle>
            <CardDescription>
              {ackInfo.acknowledged} of {ackInfo.eligible} eligible staff have acknowledged (live denominator).
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="content">Content</Label>
            <textarea
              id="content"
              className="min-h-[220px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={readOnly}
            />
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {!readOnly ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={saving} onClick={() => void save()}>
                {saving ? "Saving…" : "Save draft"}
              </Button>
              <Button type="button" variant="secondary" disabled={saving} onClick={() => void publish()}>
                Publish
              </Button>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Published policies are read-only here. Create a new version from the list when you need changes.</p>
          )}
          <Button type="button" variant="outline" onClick={() => router.push("/admin/compliance/policies")}>
            Done
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
