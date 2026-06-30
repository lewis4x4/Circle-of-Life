"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";

export default function EditPolicyPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const { user } = useHavenAuth();
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

      const { data: facRow } = await supabase
        .from("facilities")
        .select("organization_id")
        .eq("id", data.facility_id)
        .maybeSingle();

      const { data: ufaRows } = await supabase
        .from("user_facility_access")
        .select("user_id")
        .eq("facility_id", data.facility_id)
        .is("revoked_at", null);

      const eligibleIds = new Set<string>((ufaRows ?? []).map((r) => r.user_id));

      const orgId = facRow?.organization_id;
      if (orgId) {
        const { data: orgWide } = await supabase
          .from("user_profiles")
          .select("id")
          .eq("organization_id", orgId)
          .in("app_role", ["owner", "org_admin"]);
        for (const row of orgWide ?? []) {
          eligibleIds.add(row.id);
        }
      }

      const userIds = Array.from(eligibleIds);
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

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (error && !title) {
    return (
      <div className="space-y-4">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" onClick={() => router.push("/admin/compliance/policies")}>
          Back
        </Button>
      </div>
    );
  }

  const readOnly = status === "published" || status === "archived";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <RecordDetailHeader
        title="Edit policy"
        statusChips={<Badge>{status}</Badge>}
        backLink={{ label: "Policies", href: "/admin/compliance/policies" }}
      />

      {ackInfo ? (
        <RecordDetailSection title="Acknowledgments">
          <p className="text-sm text-muted-foreground">
            {ackInfo.acknowledged} of {ackInfo.eligible} eligible staff have acknowledged (live denominator).
          </p>
        </RecordDetailSection>
      ) : null}

      <RecordDetailSection title="Policy content">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="content">Content</Label>
            <textarea
              id="content"
              className="min-h-[220px] w-full rounded-[8px] border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={readOnly}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
            <p className="text-sm text-muted-foreground">Published policies are read-only here. Create a new version from the list when you need changes.</p>
          )}
          <Button type="button" variant="outline" onClick={() => router.push("/admin/compliance/policies")}>
            Done
          </Button>
        </div>
      </RecordDetailSection>
    </div>
  );
}
