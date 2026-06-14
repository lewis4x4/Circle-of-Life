"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AtSign } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import {
  SUBJECT_LABELS,
  commentUserLabel,
  type CommentRow,
  type CommentUserMini,
  type QueryResult,
} from "@/lib/office/comments";
import { fetchActorContext } from "@/lib/office/meetings";
import { createClient } from "@/lib/supabase/client";

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function subjectHref(c: CommentRow): string | null {
  if (c.subject_type === "workspace_page") return `/admin/workspace/${c.subject_id}`;
  if (c.subject_type === "team_space") return `/admin/teams/${c.subject_id}`;
  return null;
}

export default function AdminMentionsPage() {
  const supabase = createClient();

  const [comments, setComments] = useState<CommentRow[]>([]);
  const [users, setUsers] = useState<CommentUserMini[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const usersRes = (await supabase
        .from("user_profiles")
        .select("id, full_name, email")
        .eq("organization_id", actor.organizationId)
        .is("deleted_at", null)
        .limit(500)) as unknown as QueryResult<CommentUserMini>;
      if (!usersRes.error) setUsers(usersRes.data ?? []);

      const res = (await supabase
        .from("workspace_comments" as never)
        .select("id, subject_type, subject_id, author_user_id, body, mentioned_user_ids, created_at")
        .contains("mentioned_user_ids", [actor.userId])
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(200)) as unknown as QueryResult<CommentRow>;
      if (res.error) throw new Error(res.error.message);
      setComments(res.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load your mentions.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6 max-w-3xl">
        <header className="mb-2">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
            <AtSign className="h-8 w-8 text-info shrink-0" aria-hidden />
            My mentions
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Comments where a colleague tagged you.
          </p>
        </header>

        {isLoading ? <AdminTableLoadingState /> : null}
        {!isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {!isLoading && !loadError ? (
          comments.length === 0 ? (
            <p className="text-sm text-muted-foreground pl-2">No mentions yet.</p>
          ) : (
            <ul className="space-y-2">
              {comments.map((c) => {
                const href = subjectHref(c);
                const inner = (
                  <div className="rounded-[9px] border border-border bg-card px-[13px] py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {commentUserLabel(c.author_user_id, users)}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {SUBJECT_LABELS[c.subject_type]}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {ET_FMT.format(new Date(c.created_at))} ET
                      </span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{c.body}</p>
                  </div>
                );
                return (
                  <li key={c.id}>
                    {href ? (
                      <Link href={href} className="block hover:opacity-90 transition-opacity">
                        {inner}
                      </Link>
                    ) : (
                      inner
                    )}
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </div>
    </div>
  );
}
