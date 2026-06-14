"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageSquare, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import {
  commentUserLabel,
  type CommentRow,
  type CommentSubjectType,
  type CommentUserMini,
  type QueryResult,
} from "@/lib/office/comments";
import { fetchActorContext } from "@/lib/office/meetings";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type Props = {
  subjectType: CommentSubjectType;
  subjectId: string;
};

export function CommentsThread({ subjectType, subjectId }: Props) {
  const supabase = createClient();

  const [comments, setComments] = useState<CommentRow[]>([]);
  const [users, setUsers] = useState<CommentUserMini[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const usersRes = (await supabase
        .from("user_profiles")
        .select("id, full_name, email")
        .eq("organization_id", actor.organizationId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("full_name")
        .limit(500)) as unknown as QueryResult<CommentUserMini>;
      if (!usersRes.error) setUsers(usersRes.data ?? []);

      const res = (await supabase
        .from("workspace_comments" as never)
        .select("id, subject_type, subject_id, author_user_id, body, mentioned_user_ids, created_at")
        .eq("subject_type", subjectType)
        .eq("subject_id", subjectId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(300)) as unknown as QueryResult<CommentRow>;
      if (res.error) throw new Error(res.error.message);
      setComments(res.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load comments.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase, subjectType, subjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = useCallback(async () => {
    if (!body.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const { error: insErr } = await supabase.from("workspace_comments" as never).insert({
        organization_id: actor.organizationId,
        subject_type: subjectType,
        subject_id: subjectId,
        author_user_id: actor.userId,
        body: body.trim(),
        mentioned_user_ids: mentions,
        created_by: actor.userId,
        updated_by: actor.userId,
      } as never);
      if (insErr) throw new Error(insErr.message);
      setBody("");
      setMentions([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post the comment.");
    } finally {
      setSaving(false);
    }
  }, [supabase, body, mentions, subjectType, subjectId, load]);

  const toggleMention = useCallback((id: string) => {
    setMentions((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  }, []);

  return (
    <section className="space-y-3" aria-label="Comments">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" aria-hidden />
        Comments
        <span className="text-xs font-normal text-muted-foreground tabular-nums">{comments.length}</span>
      </h3>

      {error ? (
        <p className="rounded-[9px] border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ul className="space-y-2">
          {comments.length === 0 ? (
            <li className="text-sm text-muted-foreground">No comments yet.</li>
          ) : (
            comments.map((c) => (
              <li key={c.id} className="rounded-[9px] border border-border bg-card px-[13px] py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {commentUserLabel(c.author_user_id, users)}
                  </span>
                  <span className="text-xs text-muted-foreground">{ET_FMT.format(new Date(c.created_at))} ET</span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{c.body}</p>
                {c.mentioned_user_ids.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {c.mentioned_user_ids.map((id) => (
                      <StatusPill key={id} tone="info">@{commentUserLabel(id, users)}</StatusPill>
                    ))}
                  </div>
                ) : null}
              </li>
            ))
          )}
        </ul>
      )}

      <div className="space-y-2 rounded-[9px] border border-border bg-card p-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Add a comment…"
          aria-label="New comment"
          className="w-full rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
        {users.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              Notify{mentions.length > 0 ? ` (${mentions.length})` : ""}
            </summary>
            <div className="mt-2 flex max-h-40 flex-wrap gap-1 overflow-auto">
              {users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  aria-pressed={mentions.includes(u.id)}
                  onClick={() => toggleMention(u.id)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    mentions.includes(u.id)
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground border border-border hover:bg-muted",
                  )}
                >
                  @{u.full_name || u.email}
                </button>
              ))}
            </div>
          </details>
        ) : null}
        <Button type="button" disabled={saving || !body.trim()} onClick={() => void post()} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          Comment
        </Button>
      </div>
    </section>
  );
}
