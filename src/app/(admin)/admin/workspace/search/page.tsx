"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileText, HardDrive, KanbanSquare, Loader2, Search, Sparkles } from "lucide-react";

import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { fetchActorContext } from "@/lib/office/meetings";
import { rankPages, type RankedPage, type SearchablePage } from "@/lib/office/workspace-search";
import { type QueryResult } from "@/lib/office/workspace";
import { createClient } from "@/lib/supabase/client";

type FileHit = { id: string; name: string; folder: string };
type CardHit = { id: string; title: string; status: string };

export default function AdminWorkspaceSearchPage() {
  const supabase = createClient();

  const [pages, setPages] = useState<SearchablePage[]>([]);
  const [files, setFiles] = useState<FileHit[]>([]);
  const [cards, setCards] = useState<CardHit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<RankedPage[] | null>(null);
  const [thinking, setThinking] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const pagesRes = (await supabase
        .from("workspace_pages" as never)
        .select("id, title, body, updated_at")
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(500)) as unknown as QueryResult<SearchablePage>;
      if (pagesRes.error) throw new Error(pagesRes.error.message);
      setPages(pagesRes.data ?? []);

      const filesRes = (await supabase
        .from("workspace_files" as never)
        .select("id, name, folder")
        .eq("owner_user_id", actor.userId)
        .is("deleted_at", null)
        .limit(500)) as unknown as QueryResult<FileHit>;
      if (!filesRes.error) setFiles(filesRes.data ?? []);

      const cardsRes = (await supabase
        .from("workspace_cards" as never)
        .select("id, title, status")
        .eq("owner_user_id", actor.userId)
        .is("deleted_at", null)
        .limit(500)) as unknown as QueryResult<CardHit>;
      if (!cardsRes.error) setCards(cardsRes.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load your workspace.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const q = query.trim().toLowerCase();
  const pageHits = useMemo(
    () =>
      q
        ? pages.filter(
            (p) => p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q),
          )
        : [],
    [pages, q],
  );
  const fileHits = useMemo(
    () => (q ? files.filter((f) => f.name.toLowerCase().includes(q)) : []),
    [files, q],
  );
  const cardHits = useMemo(
    () => (q ? cards.filter((c) => c.title.toLowerCase().includes(q)) : []),
    [cards, q],
  );

  const ask = useCallback(() => {
    if (!question.trim()) return;
    setThinking(true);
    // Local, RLS-scoped retrieval over the user's own notes — no external send.
    const ranked = rankPages(pages, question, 3);
    setAnswer(ranked);
    setThinking(false);
  }, [question, pages]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6 max-w-3xl">
        <header className="mb-2 space-y-2">
          <Link
            href="/admin/workspace"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            My workspace
          </Link>
          <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
            <Search className="h-8 w-8 text-info shrink-0" aria-hidden />
            Search my workspace
          </h2>
        </header>

        {loadError ? <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} /> : null}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, files, and cards…"
            aria-label="Search workspace"
            className="w-full rounded-[9px] border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground"
          />
        </div>

        {isLoading ? <p className="text-sm text-muted-foreground">Loading your workspace…</p> : null}

        {q ? (
          <div className="space-y-4">
            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Pages ({pageHits.length})
              </h3>
              {pageHits.length === 0 ? (
                <p className="text-sm text-muted-foreground">No matching pages.</p>
              ) : (
                <ul className="space-y-1">
                  {pageHits.slice(0, 30).map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/admin/workspace/${p.id}`}
                        className="flex items-center gap-2 px-[13px] py-2 rounded-[9px] border border-border bg-card hover:bg-muted/40 transition-colors"
                      >
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                        <span className="font-medium text-foreground truncate">{p.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Files ({fileHits.length})
              </h3>
              {fileHits.length === 0 ? (
                <p className="text-sm text-muted-foreground">No matching files.</p>
              ) : (
                <ul className="space-y-1">
                  {fileHits.slice(0, 30).map((f) => (
                    <li key={f.id} className="flex items-center gap-2 px-[13px] py-2 rounded-[9px] border border-border bg-card">
                      <HardDrive className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                      <span className="font-medium text-foreground truncate">{f.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{f.folder}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Cards ({cardHits.length})
              </h3>
              {cardHits.length === 0 ? (
                <p className="text-sm text-muted-foreground">No matching cards.</p>
              ) : (
                <ul className="space-y-1">
                  {cardHits.slice(0, 30).map((c) => (
                    <li key={c.id} className="flex items-center gap-2 px-[13px] py-2 rounded-[9px] border border-border bg-card">
                      <KanbanSquare className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                      <span className="font-medium text-foreground truncate">{c.title}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{c.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}

        <section className="space-y-3 rounded-[var(--radius)] border border-border bg-card/60 p-4">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-info" aria-hidden />
            Ask Grace about my notes
          </h3>
          <p className="text-sm text-muted-foreground">
            Ask a question and Grace finds the most relevant of <strong>your</strong> notes. This
            searches your private notes only — nothing is shared or sent off-platform.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") ask();
              }}
              placeholder="e.g. What did I note about fall risk?"
              aria-label="Ask about my notes"
              className="flex-1 min-w-[240px] rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
            <Button type="button" disabled={thinking || !question.trim()} onClick={ask} className="gap-2">
              {thinking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
              Ask
            </Button>
          </div>

          {answer ? (
            answer.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing in your notes seems to match that. Try different words.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">From your notes:</p>
                <ul className="space-y-2">
                  {answer.map((r) => (
                    <li key={r.page.id} className="rounded-[9px] border border-border bg-card px-[13px] py-2">
                      <Link href={`/admin/workspace/${r.page.id}`} className="font-medium text-foreground hover:underline">
                        {r.page.title}
                      </Link>
                      <p className="mt-0.5 text-sm text-muted-foreground">{r.snippet}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : null}
        </section>
      </div>
    </div>
  );
}
