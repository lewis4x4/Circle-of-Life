"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Inbox, Loader2, X } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { fetchActorContext } from "@/lib/office/meetings";
import {
  audienceLabel,
  isReviewerRole,
  publishStatusTone,
  wordCount,
  type PublishRequestRow,
  type QueryResult,
} from "@/lib/office/publish";
import { createClient } from "@/lib/supabase/client";

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default function AdminPublishQueuePage() {
  const supabase = createClient();

  const [requests, setRequests] = useState<PublishRequestRow[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const profileRes = (await supabase
        .from("user_profiles")
        .select("app_role")
        .eq("id", actor.userId)
        .single()) as unknown as { data: { app_role: string } | null };
      setRole(profileRes.data?.app_role ?? null);

      const res = (await supabase
        .from("workspace_publish_requests" as never)
        .select(
          "id, page_id, requested_by, title, body, target_audience, rationale, status, reviewer_id, review_notes, reviewed_at, published_document_id, created_at",
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(200)) as unknown as QueryResult<PublishRequestRow>;
      if (res.error) throw new Error(res.error.message);
      setRequests(res.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load the publish queue.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = useCallback(
    async (req: PublishRequestRow) => {
      setBusyId(req.id);
      setNotice(null);
      try {
        const actor = await fetchActorContext(supabase);
        if (!actor) throw new Error("Could not resolve your profile.");
        const docRes = (await supabase
          .from("documents")
          .insert({
            workspace_id: actor.organizationId,
            title: req.title,
            raw_text: req.body,
            source: "workspace_publish",
            audience: req.target_audience,
            status: "published",
            uploaded_by: req.requested_by,
            approved_by: actor.userId,
            approved_at: new Date().toISOString(),
            word_count: wordCount(req.body),
          } as never)
          .select("id")
          .single()) as unknown as { data: { id: string } | null; error: { message: string } | null };
        if (docRes.error) throw new Error(docRes.error.message);
        const { error: upErr } = await supabase
          .from("workspace_publish_requests" as never)
          .update({
            status: "published",
            reviewer_id: actor.userId,
            reviewed_at: new Date().toISOString(),
            review_notes: notes[req.id]?.trim() || null,
            published_document_id: docRes.data?.id ?? null,
            updated_by: actor.userId,
          } as never)
          .eq("id", req.id);
        if (upErr) throw new Error(upErr.message);
        setNotice("Published to the Knowledge Base.");
        await load();
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Failed to publish.");
      } finally {
        setBusyId(null);
      }
    },
    [supabase, notes, load],
  );

  const reject = useCallback(
    async (req: PublishRequestRow) => {
      setBusyId(req.id);
      setNotice(null);
      try {
        const actor = await fetchActorContext(supabase);
        if (!actor) throw new Error("Could not resolve your profile.");
        const { error } = await supabase
          .from("workspace_publish_requests" as never)
          .update({
            status: "rejected",
            reviewer_id: actor.userId,
            reviewed_at: new Date().toISOString(),
            review_notes: notes[req.id]?.trim() || null,
            updated_by: actor.userId,
          } as never)
          .eq("id", req.id);
        if (error) throw new Error(error.message);
        await load();
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Failed to reject.");
      } finally {
        setBusyId(null);
      }
    },
    [supabase, notes, load],
  );

  const canReview = isReviewerRole(role);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6 max-w-4xl">
        <header className="mb-2 space-y-2">
          <Link
            href="/admin/workspace"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            My workspace
          </Link>
          <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
            <Inbox className="h-8 w-8 text-info shrink-0" aria-hidden />
            Publish queue
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Facility_admin / DON review of staff pages submitted for the Knowledge Base. Approve to
            publish for the requested audience, or reject with a note.
          </p>
        </header>

        {notice ? (
          <p className="rounded-[var(--radius)] border border-border bg-muted/40 px-6 py-3 text-sm text-foreground">
            {notice}
          </p>
        ) : null}

        {isLoading ? <AdminTableLoadingState /> : null}
        {!isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {!isLoading && !loadError ? (
          requests.length === 0 ? (
            <p className="text-sm text-muted-foreground pl-2">No publish requests.</p>
          ) : (
            <ul className="space-y-2">
              {requests.map((r) => (
                <li key={r.id} className="rounded-[var(--radius)] border border-border bg-card px-[13px] py-2">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                      aria-expanded={expanded === r.id}
                      className="flex-1 text-left min-w-0"
                    >
                      <span className="font-semibold text-foreground truncate block">{r.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {audienceLabel(r.target_audience)} · {ET_FMT.format(new Date(r.created_at))} ET ·{" "}
                        {wordCount(r.body)} words
                      </span>
                    </button>
                    <StatusPill tone={publishStatusTone(r.status)}>{r.status}</StatusPill>
                  </div>

                  {expanded === r.id ? (
                    <div className="mt-2 space-y-2 border-t border-border pt-2">
                      {r.rationale ? (
                        <p className="text-xs text-muted-foreground">Rationale: {r.rationale}</p>
                      ) : null}
                      <pre className="whitespace-pre-wrap text-sm text-muted-foreground max-h-64 overflow-auto">
                        {r.body || "(empty)"}
                      </pre>
                      {canReview && r.status === "submitted" ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={notes[r.id] ?? ""}
                            onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                            placeholder="Reviewer note (optional)"
                            aria-label="Reviewer note"
                            className="w-full rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                          />
                          <div className="flex gap-2">
                            <Button type="button" disabled={busyId === r.id} onClick={() => void approve(r)} className="gap-2">
                              {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                              Approve &amp; publish
                            </Button>
                            <Button type="button" variant="outline" disabled={busyId === r.id} onClick={() => void reject(r)} className="gap-2 text-danger">
                              <X className="h-4 w-4" aria-hidden />
                              Reject
                            </Button>
                          </div>
                        </div>
                      ) : null}
                      {r.review_notes ? (
                        <p className="text-xs text-muted-foreground">Reviewer note: {r.review_notes}</p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </div>
  );
}
