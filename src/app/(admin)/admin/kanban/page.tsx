"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, KanbanSquare, Loader2, Plus, Trash2 } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { fetchActorContext } from "@/lib/office/meetings";
import {
  KANBAN_COLUMNS,
  nextColumn,
  oceStatusToColumn,
  prevColumn,
  priorityTone,
  type CardStatus,
  type OceTaskMini,
  type QueryResult,
  type WorkspaceCardRow,
} from "@/lib/office/kanban";
import { createClient } from "@/lib/supabase/client";

const DAY_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
});

export default function AdminKanbanPage() {
  const supabase = createClient();

  const [cards, setCards] = useState<WorkspaceCardRow[]>([]);
  const [oceTasks, setOceTasks] = useState<OceTaskMini[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");

      const cardsRes = (await supabase
        .from("workspace_cards" as never)
        .select("id, title, details, status, position, due_date, source_oce_instance_id")
        .eq("owner_user_id", actor.userId)
        .is("deleted_at", null)
        .order("position")
        .limit(300)) as unknown as QueryResult<WorkspaceCardRow>;
      if (cardsRes.error) throw new Error(cardsRes.error.message);
      setCards(cardsRes.data ?? []);

      const oceRes = (await supabase
        .from("operation_task_instances" as never)
        .select("id, template_name, priority, status, due_at, assigned_shift_date")
        .eq("assigned_to", actor.userId)
        .in("status", ["pending", "in_progress"])
        .is("deleted_at", null)
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(100)) as unknown as QueryResult<OceTaskMini>;
      if (!oceRes.error) setOceTasks(oceRes.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load your board.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const addCard = useCallback(async () => {
    if (!newTitle.trim()) return;
    setSaving(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const pos = cards.filter((c) => c.status === "todo").length;
      const { error } = await supabase.from("workspace_cards" as never).insert({
        organization_id: actor.organizationId,
        owner_user_id: actor.userId,
        title: newTitle.trim(),
        status: "todo",
        position: pos,
        created_by: actor.userId,
        updated_by: actor.userId,
      } as never);
      if (error) throw new Error(error.message);
      setNewTitle("");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to add the card.");
    } finally {
      setSaving(false);
    }
  }, [supabase, newTitle, cards, load]);

  const moveCard = useCallback(
    async (card: WorkspaceCardRow, status: CardStatus) => {
      setBusyId(card.id);
      setNotice(null);
      try {
        const actor = await fetchActorContext(supabase);
        const { error } = await supabase
          .from("workspace_cards" as never)
          .update({ status, updated_by: actor?.userId } as never)
          .eq("id", card.id);
        if (error) throw new Error(error.message);
        await load();
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Failed to move the card.");
      } finally {
        setBusyId(null);
      }
    },
    [supabase, load],
  );

  const removeCard = useCallback(
    async (card: WorkspaceCardRow) => {
      setBusyId(card.id);
      setNotice(null);
      try {
        const actor = await fetchActorContext(supabase);
        const { error } = await supabase
          .from("workspace_cards" as never)
          .update({ deleted_at: new Date().toISOString(), updated_by: actor?.userId } as never)
          .eq("id", card.id);
        if (error) throw new Error(error.message);
        await load();
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Failed to delete the card.");
      } finally {
        setBusyId(null);
      }
    },
    [supabase, load],
  );

  const oceByColumn = useMemo(() => {
    const map: Record<CardStatus, OceTaskMini[]> = { todo: [], in_progress: [], done: [] };
    for (const t of oceTasks) map[oceStatusToColumn(t.status)].push(t);
    return map;
  }, [oceTasks]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <header className="mb-2">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
            <KanbanSquare className="h-8 w-8 text-info shrink-0" aria-hidden />
            My board
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            A private kanban for your own work. Your assigned Operations Cadence tasks appear here
            read-only — complete those in the Operations queue, which stays the system of record.
          </p>
        </header>

        {notice ? (
          <p className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-6 py-3 text-sm text-danger">
            {notice}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addCard();
            }}
            placeholder="Add a card to To do…"
            aria-label="New card title"
            className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground min-w-[260px]"
          />
          <Button type="button" disabled={saving || !newTitle.trim()} onClick={() => void addCard()} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
            Add
          </Button>
        </div>

        {isLoading ? <AdminTableLoadingState /> : null}
        {!isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {!isLoading && !loadError ? (
          <div className="grid gap-4 lg:grid-cols-3">
            {KANBAN_COLUMNS.map((col) => {
              const colCards = cards.filter((c) => c.status === col.id);
              const colOce = oceByColumn[col.id];
              return (
                <section
                  key={col.id}
                  aria-label={col.label}
                  className="space-y-2 rounded-[var(--radius)] border border-border bg-card/40 p-3"
                >
                  <div className="flex items-center justify-between px-1">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      {col.label}
                    </h3>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {colCards.length + colOce.length}
                    </span>
                  </div>

                  {colOce.map((t) => (
                    <div
                      key={`oce-${t.id}`}
                      className="rounded-[9px] border border-info/30 bg-info/5 px-[13px] py-2 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground truncate">{t.template_name}</span>
                        <StatusPill tone="info">OCE</StatusPill>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusPill tone={priorityTone(t.priority)}>{t.priority}</StatusPill>
                        <span className="text-xs text-muted-foreground">
                          {t.due_at ? `due ${DAY_FMT.format(new Date(t.due_at))}` : DAY_FMT.format(new Date(t.assigned_shift_date))}
                        </span>
                      </div>
                    </div>
                  ))}

                  {colCards.map((card) => {
                    const left = prevColumn(card.status);
                    const right = nextColumn(card.status);
                    return (
                      <div
                        key={card.id}
                        className="rounded-[9px] border border-border bg-card px-[13px] py-2 space-y-1"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium text-foreground">{card.title}</span>
                          <button
                            type="button"
                            aria-label="Delete card"
                            disabled={busyId === card.id}
                            onClick={() => void removeCard(card)}
                            className="text-muted-foreground hover:text-danger transition-colors"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                        {card.due_date ? (
                          <span className="text-xs text-muted-foreground">
                            due {DAY_FMT.format(new Date(`${card.due_date}T12:00:00`))}
                          </span>
                        ) : null}
                        <div className="flex items-center justify-between pt-1">
                          <button
                            type="button"
                            aria-label="Move left"
                            disabled={!left || busyId === card.id}
                            onClick={() => left && void moveCard(card, left)}
                            className="text-muted-foreground enabled:hover:text-foreground disabled:opacity-30 transition-colors"
                          >
                            <ChevronLeft className="h-4 w-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            aria-label="Move right"
                            disabled={!right || busyId === card.id}
                            onClick={() => right && void moveCard(card, right)}
                            className="text-muted-foreground enabled:hover:text-foreground disabled:opacity-30 transition-colors"
                          >
                            <ChevronRight className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {colCards.length + colOce.length === 0 ? (
                    <p className="px-1 py-4 text-center text-xs text-muted-foreground">Empty</p>
                  ) : null}
                </section>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
