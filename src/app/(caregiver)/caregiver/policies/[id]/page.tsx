"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { resolveAckFacilityId } from "@/lib/pending-policies";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function CaregiverPolicyAckPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [already, setAlready] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Not signed in.");
        return;
      }
      const { data: pol, error: pErr } = await supabase
        .from("policy_documents")
        .select("id, title, content, facility_id, organization_id, status")
        .eq("id", id)
        .eq("status", "published")
        .is("deleted_at", null)
        .maybeSingle();

      if (pErr || !pol) {
        setError("Policy not found or not published.");
        return;
      }
      setTitle(pol.title);
      setContent(pol.content);

      const { data: existing } = await supabase
        .from("policy_acknowledgments")
        .select("id")
        .eq("policy_document_id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      setAlready(!!existing);
    } finally {
      setLoading(false);
    }
  }, [supabase, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function acknowledge() {
    setSubmitting(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Not signed in.");
        return;
      }
      const facId = await resolveAckFacilityId(supabase, user.id);
      const { data: pol } = await supabase.from("policy_documents").select("facility_id, organization_id").eq("id", id).single();
      if (!pol || !facId || pol.facility_id !== facId) {
        setError("This policy is not assigned to your facility access.");
        return;
      }
      const { error: insErr } = await supabase.from("policy_acknowledgments").insert({
        policy_document_id: id,
        user_id: user.id,
        facility_id: pol.facility_id,
        organization_id: pol.organization_id,
      });
      if (insErr) {
        setError(insErr.message);
        return;
      }
      router.push("/caregiver/policies");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading…
      </div>
    );
  }

  if (error && !title) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-red-400">{error}</p>
        <Link href="/caregiver/policies" className="text-sm text-amber-400 underline">
          Back to list
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link href="/caregiver/policies" className="text-sm text-zinc-400 hover:text-zinc-200">
        ← Pending policies
      </Link>
      <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription className="text-zinc-400">Read the full policy, then acknowledge below.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-900/50 p-4 text-sm leading-relaxed text-zinc-200">
            {content}
          </div>
          {already ? (
            <p className="text-sm text-emerald-400">You have already acknowledged this policy.</p>
          ) : (
            <Button
              type="button"
              className="w-full bg-amber-700 hover:bg-amber-600"
              disabled={submitting}
              onClick={() => void acknowledge()}
            >
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              I have read and understood this policy
            </Button>
          )}
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
