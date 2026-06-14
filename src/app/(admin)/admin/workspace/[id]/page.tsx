"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, History, Loader2, Send, ShieldAlert } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { fetchActorContext } from "@/lib/office/meetings";
import {
  templateLabel,
  type QueryResult,
  type WorkspacePageRow,
  type WorkspacePageVersionRow,
} from "@/lib/office/workspace";
import {
  PUBLISH_AUDIENCES,
  publishStatusTone,
  type PublishRequestRow,
} from "@/lib/office/publish";
import { createClient } from "@/lib/supabase/client";
import { CommentsThread } from "@/components/office/comments-thread";

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default function AdminWorkspacePageDetail() {
  const supabase = createClient();
  const params = useParams<{ id: string }>();
  const pageId = params.id;

  const [page, setPage] = useState<WorkspacePageRow | null>(null);
  const [versions, setVersions] = useState<WorkspacePageVersionRow[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);

  const [breakGlassReason, setBreakGlassReason] = useState("");
  const [breakGlassBusy, setBreakGlassBusy] = useState(false);

  const [publishRequest, setPublishRequest] = useState<PublishRequestRow | null>(null);
  const [showPublish, setShowPublish] = useState(false);
  const [pubAudience, setPubAudience] = useState("company_wide");
  const [pubRationale, setPubRationale] = useState("");
  const [publishing, setPublishing] = useState(false);

  const [mySpaces, setMySpaces] = useState<{ id: string; name: string }[]>([]);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      setUserId(actor.userId);

      const profileRes = (await supabase
        .from("user_profiles")
        .select("app_role")
        .eq("id", actor.userId)
        .single()) as unknown as { data: { app_role: string } | null; error: { message: string } | null };
      setRole(profileRes.data?.app_role ?? null);

      const res = (await supabase
        .from("workspace_pages" as never)
        .select("id, owner_user_id, title, body, template_kind, visibility, team_space_id, version, updated_at, created_at")
        .eq("id", pageId)
        .is("deleted_at", null)
        .limit(1)) as unknown as QueryResult<WorkspacePageRow>;
      if (res.error) throw new Error(res.error.message);
      const found = (res.data ?? [])[0] ?? null;
      setPage(found);
      if (found) {
        setTitle(found.title);
        setBody(found.body);
        const vRes = (await supabase
          .from("workspace_page_versions" as never)
          .select("id, version, title, body, created_at")
          .eq("page_id", pageId)
          .order("version", { ascending: false })
          .limit(50)) as unknown as QueryResult<WorkspacePageVersionRow>;
        if (!vRes.error) setVersions(vRes.data ?? []);

        const prRes = (await supabase
          .from("workspace_publish_requests" as never)
          .select(
            "id, page_id, requested_by, title, body, target_audience, rationale, status, reviewer_id, review_notes, reviewed_at, published_document_id, created_at",
          )
          .eq("page_id", pageId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(1)) as unknown as QueryResult<PublishRequestRow>;
        if (!prRes.error) setPublishRequest((prRes.data ?? [])[0] ?? null);

        if (found.owner_user_id === actor.userId) {
          const spacesRes = (await supabase
            .from("team_spaces" as never)
            .select("id, name")
            .is("deleted_at", null)
            .order("name")) as unknown as QueryResult<{ id: string; name: string }>;
          if (!spacesRes.error) setMySpaces(spacesRes.data ?? []);
        }
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load the page.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase, pageId]);

  useEffect(() => {
    void load();
  }, [load]);

  const isOwner = !!page && !!userId && page.owner_user_id === userId;
  const canBreakGlass = !page && (role === "owner" || role === "org_admin");

  const save = useCallback(async () => {
    if (!page || !isOwner) return;
    setSaving(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const nextVersion = page.version + 1;
      const { error: vErr } = await supabase.from("workspace_page_versions" as never).insert({
        organization_id: actor.organizationId,
        page_id: page.id,
        owner_user_id: actor.userId,
        version: nextVersion,
        title: title.trim() || "Untitled",
        body,
        created_by: actor.userId,
      } as never);
      if (vErr) throw new Error(vErr.message);
      const { error: pErr } = await supabase
        .from("workspace_pages" as never)
        .update({
          title: title.trim() || "Untitled",
          body,
          version: nextVersion,
          updated_by: actor.userId,
        } as never)
        .eq("id", page.id);
      if (pErr) throw new Error(pErr.message);
      setNotice("Saved.");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }, [supabase, page, isOwner, title, body, load]);

  const submitPublish = useCallback(async () => {
    if (!page || !isOwner) return;
    setPublishing(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const { error } = await supabase.from("workspace_publish_requests" as never).insert({
        organization_id: actor.organizationId,
        page_id: page.id,
        requested_by: actor.userId,
        title: title.trim() || "Untitled",
        body,
        target_audience: pubAudience,
        rationale: pubRationale.trim() || null,
        created_by: actor.userId,
        updated_by: actor.userId,
      } as never);
      if (error) throw new Error(error.message);
      setShowPublish(false);
      setPubRationale("");
      setNotice("Submitted for review.");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to submit for review.");
    } finally {
      setPublishing(false);
    }
  }, [supabase, page, isOwner, title, body, pubAudience, pubRationale, load]);

  const shareToSpace = useCallback(
    async (teamSpaceId: string) => {
      if (!page || !isOwner) return;
      setSharing(true);
      setNotice(null);
      try {
        const actor = await fetchActorContext(supabase);
        const isUnshare = teamSpaceId === "";
        const { error } = await supabase
          .from("workspace_pages" as never)
          .update({
            visibility: isUnshare ? "private" : "team",
            team_space_id: isUnshare ? null : teamSpaceId,
            updated_by: actor?.userId,
          } as never)
          .eq("id", page.id);
        if (error) throw new Error(error.message);
        setNotice(isUnshare ? "Page is private again." : "Shared to the team space.");
        await load();
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Failed to update sharing.");
      } finally {
        setSharing(false);
      }
    },
    [supabase, page, isOwner, load],
  );

  const submitBreakGlass = useCallback(async () => {
    if (breakGlassReason.trim().length < 5) {
      setNotice("Enter a reason (at least 5 characters) for break-glass access.");
      return;
    }
    setBreakGlassBusy(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const { error } = await supabase.from("workspace_breakglass_grants" as never).insert({
        organization_id: actor.organizationId,
        resource_type: "workspace_page",
        resource_id: pageId,
        accessor_user_id: actor.userId,
        reason: breakGlassReason.trim(),
      } as never);
      if (error) throw new Error(error.message);
      setBreakGlassReason("");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Break-glass failed.");
    } finally {
      setBreakGlassBusy(false);
    }
  }, [supabase, breakGlassReason, pageId, load]);

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

        {!isLoading && !loadError && !page && canBreakGlass ? (
          <section className="rounded-[var(--radius)] border border-warning/40 bg-warning/10 p-6 space-y-3">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-warning" aria-hidden />
              Private page — break-glass access
            </h2>
            <p className="text-sm text-muted-foreground">
              This page belongs to another employee. As an owner/administrator you may access it
              for a documented reason. Your access and reason are permanently audit-logged.
            </p>
            <textarea
              value={breakGlassReason}
              onChange={(e) => setBreakGlassReason(e.target.value)}
              rows={3}
              placeholder="Reason for accessing this private page (required)"
              className="w-full rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
            <Button
              type="button"
              variant="destructive"
              disabled={breakGlassBusy || breakGlassReason.trim().length < 5}
              onClick={() => void submitBreakGlass()}
              className="gap-2"
            >
              {breakGlassBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldAlert className="h-4 w-4" aria-hidden />}
              Break glass &amp; open
            </Button>
          </section>
        ) : null}

        {!isLoading && !loadError && !page && !canBreakGlass ? (
          <p className="rounded-[var(--radius)] border border-border bg-card px-6 py-4 text-sm text-muted-foreground">
            This page is private or unavailable.
          </p>
        ) : null}

        {!isLoading && !loadError && page ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <StatusPill tone={page.visibility === "private" ? "muted" : "info"}>
                  {page.visibility}
                </StatusPill>
                <StatusPill tone="muted">{templateLabel(page.template_kind)}</StatusPill>
                <span className="text-xs text-muted-foreground tabular-nums">v{page.version}</span>
                {!isOwner ? <StatusPill tone="warning">break-glass view</StatusPill> : null}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2 font-medium text-[10px] uppercase tracking-wider"
                onClick={() => setShowHistory((v) => !v)}
              >
                <History className="h-4 w-4" aria-hidden />
                {showHistory ? "Hide history" : `History (${versions.length})`}
              </Button>
            </div>

            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              readOnly={!isOwner}
              aria-label="Page title"
              className="w-full rounded-[9px] border border-border bg-background px-3 py-2 text-xl font-semibold text-foreground"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              readOnly={!isOwner}
              rows={18}
              aria-label="Page body"
              className="w-full rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground font-mono leading-relaxed"
            />
            {isOwner ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" disabled={saving} onClick={() => void save()} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  Save
                </Button>
                {!publishRequest || publishRequest.status === "rejected" ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowPublish((v) => !v)}
                    className="gap-2"
                  >
                    <Send className="h-4 w-4" aria-hidden />
                    Publish to group
                  </Button>
                ) : null}
              </div>
            ) : null}

            {isOwner && mySpaces.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-[9px] border border-border bg-muted/30 px-[13px] py-2">
                <label htmlFor="share-space" className="text-sm text-muted-foreground">
                  Team space:
                </label>
                <select
                  id="share-space"
                  value={page.team_space_id ?? ""}
                  disabled={sharing}
                  onChange={(e) => void shareToSpace(e.target.value)}
                  className="rounded-[9px] border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                >
                  <option value="">Private (not shared)</option>
                  {mySpaces.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {sharing ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden /> : null}
              </div>
            ) : null}

            {publishRequest ? (
              <div className="rounded-[9px] border border-border bg-muted/30 px-[13px] py-2 text-sm">
                <span className="text-muted-foreground">Publish status: </span>
                <StatusPill tone={publishStatusTone(publishRequest.status)}>
                  {publishRequest.status}
                </StatusPill>
                {publishRequest.review_notes ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Reviewer note: {publishRequest.review_notes}
                  </p>
                ) : null}
              </div>
            ) : null}

            {isOwner && showPublish ? (
              <div className="space-y-2 rounded-[var(--radius)] border border-border bg-card p-4">
                <p className="text-sm text-muted-foreground">
                  Submit this page for facility_admin / DON review. On approval it publishes into
                  the Knowledge Base for the selected audience.
                </p>
                <select
                  value={pubAudience}
                  onChange={(e) => setPubAudience(e.target.value)}
                  aria-label="Target audience"
                  className="w-full rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  {PUBLISH_AUDIENCES.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
                <textarea
                  value={pubRationale}
                  onChange={(e) => setPubRationale(e.target.value)}
                  rows={2}
                  placeholder="Why should this be published? (optional)"
                  className="w-full rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
                <Button
                  type="button"
                  disabled={publishing}
                  onClick={() => void submitPublish()}
                  className="gap-2"
                >
                  {publishing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                  Submit for review
                </Button>
              </div>
            ) : null}

            {showHistory ? (
              <section className="space-y-2 border-t border-border pt-4">
                <h3 className="text-sm font-semibold text-foreground">Version history</h3>
                {versions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No prior versions.</p>
                ) : (
                  <ul className="space-y-2">
                    {versions.map((v) => (
                      <li key={v.id} className="rounded-[9px] border border-border bg-card px-[13px] py-2">
                        <button
                          type="button"
                          onClick={() => setExpandedVersion(expandedVersion === v.id ? null : v.id)}
                          aria-expanded={expandedVersion === v.id}
                          className="flex w-full items-center justify-between gap-2 text-left"
                        >
                          <span className="font-medium text-foreground">
                            v{v.version} — {v.title}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {ET_FMT.format(new Date(v.created_at))} ET
                          </span>
                        </button>
                        {expandedVersion === v.id ? (
                          <pre className="mt-2 whitespace-pre-wrap border-t border-border pt-2 text-sm text-muted-foreground">
                            {v.body || "(empty)"}
                          </pre>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : null}

            <div className="border-t border-border pt-4">
              <CommentsThread subjectType="workspace_page" subjectId={page.id} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
