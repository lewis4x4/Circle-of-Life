"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileText, UserMinus, UserPlus, Users2 } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { fetchActorContext } from "@/lib/office/meetings";
import {
  userLabel,
  type OrgUserMini,
  type QueryResult,
  type TeamSharedPageRow,
  type TeamSpaceMemberRow,
  type TeamSpaceRow,
} from "@/lib/office/teams";
import { createClient } from "@/lib/supabase/client";

export default function AdminTeamSpaceDetail() {
  const supabase = createClient();
  const params = useParams<{ id: string }>();
  const spaceId = params.id;

  const [space, setSpace] = useState<TeamSpaceRow | null>(null);
  const [members, setMembers] = useState<TeamSpaceMemberRow[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgUserMini[]>([]);
  const [pages, setPages] = useState<TeamSharedPageRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addUserId, setAddUserId] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");

      const spaceRes = (await supabase
        .from("team_spaces" as never)
        .select("id, name, description, is_active, created_by, created_at")
        .eq("id", spaceId)
        .is("deleted_at", null)
        .limit(1)) as unknown as QueryResult<TeamSpaceRow>;
      if (spaceRes.error) throw new Error(spaceRes.error.message);
      setSpace((spaceRes.data ?? [])[0] ?? null);

      const membersRes = (await supabase
        .from("team_space_members" as never)
        .select("id, team_space_id, user_id, space_role, created_at")
        .eq("team_space_id", spaceId)
        .is("deleted_at", null)
        .order("created_at")) as unknown as QueryResult<TeamSpaceMemberRow>;
      if (membersRes.error) throw new Error(membersRes.error.message);
      setMembers(membersRes.data ?? []);

      const usersRes = (await supabase
        .from("user_profiles")
        .select("id, full_name, email, app_role")
        .eq("organization_id", actor.organizationId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("full_name")
        .limit(500)) as unknown as QueryResult<OrgUserMini>;
      if (!usersRes.error) setOrgUsers(usersRes.data ?? []);

      const pagesRes = (await supabase
        .from("workspace_pages" as never)
        .select("id, title, owner_user_id, updated_at")
        .eq("team_space_id", spaceId)
        .eq("visibility", "team")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })) as unknown as QueryResult<TeamSharedPageRow>;
      if (!pagesRes.error) setPages(pagesRes.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load the space.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase, spaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const memberUserIds = useMemo(() => new Set(members.map((m) => m.user_id)), [members]);
  const addableUsers = useMemo(
    () => orgUsers.filter((u) => !memberUserIds.has(u.id)),
    [orgUsers, memberUserIds],
  );

  const addMember = useCallback(async () => {
    if (!addUserId) return;
    setBusy(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const { error } = await supabase.from("team_space_members" as never).insert({
        organization_id: actor.organizationId,
        team_space_id: spaceId,
        user_id: addUserId,
        space_role: "member",
        created_by: actor.userId,
      } as never);
      if (error) throw new Error(error.message);
      setAddUserId("");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to add member.");
    } finally {
      setBusy(false);
    }
  }, [supabase, addUserId, spaceId, load]);

  const removeMember = useCallback(
    async (member: TeamSpaceMemberRow) => {
      setBusy(true);
      setNotice(null);
      try {
        const { error } = await supabase
          .from("team_space_members" as never)
          .update({ deleted_at: new Date().toISOString() } as never)
          .eq("id", member.id);
        if (error) throw new Error(error.message);
        await load();
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Failed to remove member.");
      } finally {
        setBusy(false);
      }
    },
    [supabase, load],
  );

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6 max-w-4xl">
        <header className="mb-2 space-y-2">
          <Link
            href="/admin/teams"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Team spaces
          </Link>
        </header>

        {notice ? (
          <p className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-6 py-3 text-sm text-danger">
            {notice}
          </p>
        ) : null}

        {isLoading ? <AdminTableLoadingState /> : null}
        {!isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {!isLoading && !loadError && !space ? (
          <p className="rounded-[var(--radius)] border border-border bg-card px-6 py-4 text-sm text-muted-foreground">
            This space is unavailable or you are not a member.
          </p>
        ) : null}

        {!isLoading && !loadError && space ? (
          <>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
                <Users2 className="h-8 w-8 text-info shrink-0" aria-hidden />
                {space.name}
              </h2>
              {space.description ? (
                <p className="text-sm text-muted-foreground mt-1">{space.description}</p>
              ) : null}
            </div>

            <section className="space-y-3">
              <h3 className="text-lg font-semibold text-foreground">
                Members
                <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                  {members.length}
                </span>
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={addUserId}
                  onChange={(e) => setAddUserId(e.target.value)}
                  aria-label="Add member"
                  className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Add member…</option>
                  {addableUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name || u.email} ({u.app_role})
                    </option>
                  ))}
                </select>
                <Button type="button" disabled={busy || !addUserId} onClick={() => void addMember()} className="gap-2">
                  <UserPlus className="h-4 w-4" aria-hidden />
                  Add
                </Button>
              </div>
              <ul className="space-y-2">
                {members.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-2 px-[13px] py-2 rounded-[9px] border border-border bg-card"
                  >
                    <span className="font-medium text-foreground">{userLabel(m.user_id, orgUsers)}</span>
                    <div className="flex items-center gap-2">
                      <StatusPill tone={m.space_role === "lead" ? "info" : "muted"}>
                        {m.space_role}
                      </StatusPill>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-2 text-danger"
                        disabled={busy}
                        onClick={() => void removeMember(m)}
                      >
                        <UserMinus className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="space-y-3 border-t border-border pt-4">
              <h3 className="text-lg font-semibold text-foreground">
                Shared pages
                <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                  {pages.length}
                </span>
              </h3>
              {pages.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No pages shared yet. Open a page in your workspace and share it to this space.
                </p>
              ) : (
                <ul className="space-y-2">
                  {pages.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/admin/workspace/${p.id}`}
                        className="flex items-center gap-2 px-[13px] py-2 rounded-[9px] border border-border bg-card hover:bg-muted/40 transition-colors"
                      >
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                        <span className="font-medium text-foreground truncate">{p.title}</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {userLabel(p.owner_user_id, orgUsers)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
