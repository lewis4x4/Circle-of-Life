"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Users2 } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { fetchActorContext } from "@/lib/office/meetings";
import { type QueryResult, type TeamSpaceRow } from "@/lib/office/teams";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export default function AdminTeamSpacesPage() {
  const supabase = createClient();

  const [spaces, setSpaces] = useState<TeamSpaceRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [teamId, setTeamId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = (await supabase
        .from("team_spaces" as never)
        .select("id, name, description, is_active, created_by, created_at")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(200)) as unknown as QueryResult<TeamSpaceRow>;
      if (res.error) throw new Error(res.error.message);
      setSpaces(res.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load team spaces.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const createSpace = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const { error } = await supabase.rpc("create_team_with_lead" as never, { p_id: teamId, p_name: name.trim(), p_description: description.trim() || null } as never);
      if (error) throw new Error(error.message);
      setTeamId(crypto.randomUUID());
      setName("");
      setDescription("");
      setShowForm(false);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to create the space.");
    } finally {
      setSaving(false);
    }
  }, [supabase, name, description, teamId, load]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <header className="mb-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
              <Users2 className="h-8 w-8 text-info shrink-0" aria-hidden />
              Team spaces
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Shared spaces for a department or project. Members can read pages shared into the
              space; the author still owns and edits each page.
            </p>
          </div>
          <Button type="button" onClick={() => setShowForm((v) => !v)} className="gap-2">
            <Plus className="h-4 w-4" aria-hidden />
            {showForm ? "Close" : "New space"}
          </Button>
        </header>

        {notice ? (
          <p className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-6 py-3 text-sm text-danger">
            {notice}
          </p>
        ) : null}

        {showForm ? (
          <div className="grid gap-2 rounded-[var(--radius)] border border-border bg-card p-4">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Space name (e.g. Nursing leadership)"
              aria-label="Space name"
              className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              aria-label="Description"
              className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
            <Button type="button" disabled={saving || !name.trim()} onClick={() => void createSpace()} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Create space
            </Button>
          </div>
        ) : null}

        {isLoading ? <AdminTableLoadingState /> : null}
        {!isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {!isLoading && !loadError ? (
          spaces.length === 0 ? (
            <p className="text-sm text-muted-foreground pl-2">
              No spaces yet — create one to start collaborating.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {spaces.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/admin/teams/${s.id}`}
                    className={cn(
                      "block px-[13px] py-2 rounded-[9px] border border-border bg-card",
                      "hover:bg-muted/40 hover:-translate-y-px transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)]",
                    )}
                  >
                    <span className="font-semibold text-foreground">{s.name}</span>
                    {s.description ? (
                      <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </div>
  );
}
