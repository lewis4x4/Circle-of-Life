"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { resolveAckFacilityId } from "@/lib/pending-policies";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function CaregiverPolicyAckPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const supabase = createClient();
  const { loading: authLoading, user } = useHavenAuth();

  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [already, setAlready] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    if (authLoading) return;
    try {
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
  }, [authLoading, supabase, id, user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function acknowledge() {
    setSubmitting(true);
    setError(null);
    try {
      if (!user) {
        setError("Not signed in.");
        return;
      }
      const facId = await resolveAckFacilityId(supabase, user.id);
      const { data: pol } = await supabase
        .from("policy_documents")
        .select("facility_id, organization_id")
        .eq("id", id)
        .single();
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
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading…
      </div>
    );
  }

  if (error && !title) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">{error}</p>
        <Link
          href="/caregiver/policies"
          className="text-sm text-primary underline transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
        >
          Back to list
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link
        href="/caregiver/policies"
        className="text-sm text-muted-foreground transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
      >
        ← Pending policies
      </Link>
      <Card className="border-border bg-card text-card-foreground">
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription className="text-muted-foreground">
            Read the full policy, then acknowledge below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="whitespace-pre-wrap rounded-lg border border-border bg-muted p-4 text-sm leading-relaxed text-foreground">
            {content}
          </div>
          {already ? (
            <p className="text-sm text-success">You have already acknowledged this policy.</p>
          ) : (
            <Button
              type="button"
              className="min-h-[44px] w-full bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
              disabled={submitting}
              onClick={() => void acknowledge()}
            >
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              I have read and understood this policy
            </Button>
          )}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
