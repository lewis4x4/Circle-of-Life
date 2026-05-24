"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ChevronLeft, ChevronRight, Menu, MessageSquare, Plus, Search, Star, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const NLQ_PATH = "/admin/executive/nlq";
const COLLAPSED_STORAGE_KEY = "haven-sidebar-collapsed";
const SIDEBAR_ID = "haven-sidebar";
const THREAD_LIMIT = 200;

type ThreadRow = {
  id: string;
  title: string;
  message_count: number | null;
  last_message_at: string | null;
  created_at: string | null;
  pinned_at: string | null;
};

type SearchThreadRow = {
  session_id: string;
};

type ThreadSection = {
  key: string;
  label: string;
  threads: ThreadRow[];
};

type ConversationSidebarProps = {
  currentSessionId?: string | null;
  onNewConversation?: () => void;
};

function readCollapsedState(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function threadSortValue(thread: ThreadRow): number {
  const timestamp = thread.last_message_at ?? thread.created_at;
  return timestamp ? new Date(timestamp).getTime() : 0;
}

function sortThreads(threads: ThreadRow[]): ThreadRow[] {
  return [...threads].sort((a, b) => {
    if (a.pinned_at && !b.pinned_at) return -1;
    if (!a.pinned_at && b.pinned_at) return 1;
    return threadSortValue(b) - threadSortValue(a);
  });
}

function includesQuery(thread: ThreadRow, query: string): boolean {
  if (!query) return true;
  return thread.title.toLowerCase().includes(query.toLowerCase());
}

function groupThreads(threads: ThreadRow[]): ThreadSection[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;

  const sections: ThreadSection[] = [
    { key: "today", label: "Today", threads: [] },
    { key: "yesterday", label: "Yesterday", threads: [] },
    { key: "this-week", label: "This week", threads: [] },
    { key: "earlier", label: "Earlier", threads: [] },
  ];

  for (const thread of threads) {
    const value = threadSortValue(thread);
    if (value >= todayStart) {
      sections[0].threads.push(thread);
    } else if (value >= yesterdayStart) {
      sections[1].threads.push(thread);
    } else if (value >= weekStart) {
      sections[2].threads.push(thread);
    } else {
      sections[3].threads.push(thread);
    }
  }

  return sections.filter((section) => section.threads.length > 0);
}

export function ConversationSidebar({ currentSessionId, onNewConversation }: ConversationSidebarProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(readCollapsedState);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const deferredSearch = useDeferredValue(debouncedSearch);
  const [searchResults, setSearchResults] = useState<{ query: string; ids: string[] }>({ query: "", ids: [] });
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const refetchTimer = useRef<number | null>(null);
  const clickTimer = useRef<number | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty("--haven-sidebar-width", collapsed ? "56px" : "280px");
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsed));
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchValue.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchValue]);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setUserId(data.user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const fetchThreadRows = useCallback(async (ids?: string[]) => {
    let query = supabase
      .from("exec_nlq_sessions" as never)
      .select("id,title,message_count,last_message_at,created_at,pinned_at" as never)
      .is("deleted_at" as never, null)
      .is("archived_at" as never, null);

    if (ids?.length) {
      query = query.in("id" as never, ids as never);
    } else {
      query = query.limit(THREAD_LIMIT).order("pinned_at" as never, { ascending: false, nullsFirst: false }).order("last_message_at" as never, { ascending: false, nullsFirst: false });
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as unknown as ThreadRow[];
  }, [supabase]);

  const refetchThreads = useCallback(async () => {
    try {
      const rows = await fetchThreadRows();
      setThreads(sortThreads(rows));
    } catch {
      // Keep the current optimistic state; page-level auth/error UI owns hard failures.
    }
  }, [fetchThreadRows]);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) return;
    refetchTimer.current = window.setTimeout(() => {
      refetchTimer.current = null;
      void refetchThreads();
    }, 500);
  }, [refetchThreads]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refetchThreads(), 0);
    return () => window.clearTimeout(timer);
  }, [refetchThreads]);

  useEffect(() => {
    return () => {
      if (clickTimer.current) window.clearTimeout(clickTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`nlq-threads:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "exec_nlq_sessions", filter: `user_id=eq.${userId}` },
        () => scheduleRefetch(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
      if (refetchTimer.current) {
        window.clearTimeout(refetchTimer.current);
        refetchTimer.current = null;
      }
    };
  }, [scheduleRefetch, supabase, userId]);

  const filteredThreads = useMemo(() => {
    const query = deferredSearch.toLowerCase();
    const rpcMatches = new Set(searchResults.query === deferredSearch ? searchResults.ids : []);
    return sortThreads(threads.filter((thread) => includesQuery(thread, query) || rpcMatches.has(thread.id)));
  }, [deferredSearch, searchResults, threads]);

  useEffect(() => {
    if (!deferredSearch || filteredThreads.length >= 3) return;
    let cancelled = false;

    void (async () => {
      try {
        const { data, error } = await supabase.rpc("search_nlq_threads" as never, {
          p_query: deferredSearch,
          p_limit: 20,
        } as never);
        if (cancelled || error || !data) return;

        const rpcRows = (data as unknown as SearchThreadRow[]).filter((row) => row.session_id);
        const ids = rpcRows.map((row) => row.session_id);
        const existingIds = new Set(threads.map((thread) => thread.id));
        const missingIds = ids.filter((id) => !existingIds.has(id));
        if (!missingIds.length && deferredSearch === searchResults.query && ids.join("|") === searchResults.ids.join("|")) return;
        setSearchResults({ query: deferredSearch, ids });
        let missingRows: ThreadRow[] = [];

        if (missingIds.length) {
          missingRows = await fetchThreadRows(missingIds);
          if (cancelled) return;
        }

        const byId = new Map([...threads, ...missingRows].map((thread) => [thread.id, thread]));
        const ranked = ids.flatMap((id) => {
          const thread = byId.get(id);
          return thread ? [thread] : [];
        });

        if (missingRows.length) {
          setThreads((prev) => {
            const next = new Map(prev.map((thread) => [thread.id, thread]));
            for (const thread of ranked) next.set(thread.id, thread);
            return sortThreads([...next.values()]);
          });
        }
      } catch {
        // Preserve current client-side results if the cross-message search path fails.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [deferredSearch, fetchThreadRows, filteredThreads.length, searchResults, supabase, threads]);

  const activateThread = useCallback((threadId: string) => {
    setMobileOpen(false);
    router.replace(`${NLQ_PATH}?session=${threadId}`, { scroll: false });
  }, [router]);

  const scheduleActivateThread = useCallback((threadId: string) => {
    if (clickTimer.current) window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      activateThread(threadId);
    }, 180);
  }, [activateThread]);

  const startNewConversation = useCallback(() => {
    setMobileOpen(false);
    if (onNewConversation) {
      onNewConversation();
      return;
    }
    router.replace(NLQ_PATH, { scroll: false });
  }, [onNewConversation, router]);

  const commitRename = useCallback(async (threadId: string, rawTitle: string) => {
    const title = rawTitle.trim();
    const previous = threads;
    setRenamingId(null);
    if (!title) return;

    setThreads((prev) => prev.map((thread) => (thread.id === threadId ? { ...thread, title } : thread)));
    const { error } = await supabase.rpc("rename_nlq_thread" as never, {
      p_session_id: threadId,
      p_title: title,
    } as never);

    if (error) setThreads(previous);
    void refetchThreads();
  }, [refetchThreads, supabase, threads]);

  const togglePin = useCallback(async (thread: ThreadRow) => {
    const previous = threads;
    const nextPinned = !thread.pinned_at;
    const optimisticPinnedAt = nextPinned ? new Date().toISOString() : null;

    setThreads((prev) => sortThreads(prev.map((item) => (
      item.id === thread.id ? { ...item, pinned_at: optimisticPinnedAt } : item
    ))));

    const { error } = await supabase.rpc("set_nlq_thread_pinned" as never, {
      p_session_id: thread.id,
      p_pinned: nextPinned,
    } as never);

    if (error) setThreads(previous);
    void refetchThreads();
  }, [refetchThreads, supabase, threads]);

  const confirmDelete = useCallback(async (thread: ThreadRow) => {
    if (!window.confirm(`Delete “${thread.title}”?`)) return;
    const previous = threads;
    setThreads((prev) => prev.filter((item) => item.id !== thread.id));
    if (currentSessionId === thread.id) {
      router.replace(NLQ_PATH, { scroll: false });
    }

    const { error } = await supabase.rpc("delete_nlq_thread" as never, {
      p_session_id: thread.id,
    } as never);

    if (error) setThreads(previous);
    void refetchThreads();
  }, [currentSessionId, refetchThreads, router, supabase, threads]);

  const visibleThreads = filteredThreads;
  const pinnedThreads = visibleThreads.filter((thread) => Boolean(thread.pinned_at));
  const dateSections = groupThreads(visibleThreads.filter((thread) => !thread.pinned_at));
  const focusableThreadIds = visibleThreads.map((thread) => thread.id);

  const focusThreadByIndex = useCallback((index: number) => {
    const id = focusableThreadIds[index];
    if (!id) return;
    const target = document.querySelector<HTMLElement>(`[data-thread-id="${id}"]`);
    target?.focus();
  }, [focusableThreadIds]);

  const handleListKeyDown = useCallback((event: KeyboardEvent<HTMLUListElement>) => {
    if (!focusableThreadIds.length) return;
    const activeElement = document.activeElement as HTMLElement | null;
    const currentId = activeElement?.dataset.threadId ?? activeElement?.closest<HTMLElement>("[data-thread-id]")?.dataset.threadId;
    const currentIndex = currentId ? focusableThreadIds.indexOf(currentId) : -1;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusThreadByIndex(currentIndex >= 0 ? Math.min(currentIndex + 1, focusableThreadIds.length - 1) : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusThreadByIndex(currentIndex >= 0 ? Math.max(currentIndex - 1, 0) : focusableThreadIds.length - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusThreadByIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusThreadByIndex(focusableThreadIds.length - 1);
    } else if (event.key === "Enter" && currentId) {
      event.preventDefault();
      activateThread(currentId);
    } else if (event.key === "Delete" && currentId) {
      event.preventDefault();
      const thread = threads.find((item) => item.id === currentId);
      if (thread) void confirmDelete(thread);
    }
  }, [activateThread, confirmDelete, focusThreadByIndex, focusableThreadIds, threads]);

  const renderThread = (thread: ThreadRow, forceExpanded = false) => {
    const isActive = currentSessionId === thread.id;
    const messageCount = thread.message_count ?? 0;
    const isRenaming = renamingId === thread.id;
    const itemCollapsed = collapsed && !forceExpanded;

    return (
      <li key={thread.id} role="option" aria-selected={isActive} className="group relative">
        {isRenaming ? (
          <div className="flex h-10 items-center gap-2 rounded-md bg-muted/30 px-2">
            {thread.pinned_at ? <Star className="size-3 shrink-0 fill-amber-500 text-amber-500" aria-hidden /> : null}
            <input
              autoFocus
              defaultValue={thread.title}
              onBlur={(event) => void commitRename(thread.id, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitRename(thread.id, event.currentTarget.value);
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setRenamingId(null);
                }
              }}
              className="min-w-0 flex-1 rounded-sm border border-input bg-background px-1 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label="Rename conversation"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => scheduleActivateThread(thread.id)}
            onDoubleClick={(event) => {
              event.preventDefault();
              if (clickTimer.current) {
                window.clearTimeout(clickTimer.current);
                clickTimer.current = null;
              }
              setRenamingId(thread.id);
            }}
            aria-current={isActive ? "page" : undefined}
            data-state={isActive ? "active" : "inactive"}
            data-thread-id={thread.id}
            className={cn(
              "flex h-10 items-center gap-2 rounded-md px-2 text-[13px]",
              "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "data-[state=active]:bg-secondary data-[state=active]:font-medium data-[state=active]:text-foreground",
              "data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-muted/40 data-[state=inactive]:hover:text-foreground",
              itemCollapsed && "justify-center px-1",
            )}
          >
            {thread.pinned_at ? (
              <Star className="size-3 shrink-0 fill-amber-500 text-amber-500" aria-hidden />
            ) : itemCollapsed ? (
              <MessageSquare className="size-3.5 shrink-0" aria-hidden />
            ) : null}
            <span className={cn("min-w-0 flex-1 truncate", itemCollapsed && "sr-only")}>
              {thread.title}
            </span>
            <span className={cn("text-[10px] tabular-nums text-muted-foreground", itemCollapsed && "sr-only")}>{messageCount}</span>
          </button>
        )}
        {!isRenaming && !itemCollapsed ? (
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-card/95 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void togglePin(thread);
              }}
              aria-label={thread.pinned_at ? "Unpin" : "Pin"}
              className={thread.pinned_at ? "text-amber-500" : undefined}
            >
              <Star className={cn("size-3", thread.pinned_at && "fill-current")} aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void confirmDelete(thread);
              }}
              aria-label="Delete"
            >
              <Trash2 className="size-3" aria-hidden />
            </Button>
          </div>
        ) : null}
      </li>
    );
  };

  const renderSection = (section: ThreadSection, forceExpanded = false) => {
    const showSectionLabels = forceExpanded || !collapsed;
    return (
      <section key={section.key} className="space-y-1.5">
        {showSectionLabels ? (
          <p className="px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{section.label}</p>
        ) : null}
        <ul role="listbox" aria-label={section.label === "Pinned" ? "Pinned conversations" : "Conversations"} className="space-y-1" onKeyDown={handleListKeyDown}>
          {section.threads.map((thread) => renderThread(thread, forceExpanded))}
        </ul>
      </section>
    );
  };

  const sidebarBody = (forceExpanded = false) => {
    const showExpanded = forceExpanded || !collapsed;
    return (
      <aside
        id={forceExpanded ? `${SIDEBAR_ID}-mobile` : SIDEBAR_ID}
        aria-label="Haven Insight conversations"
        className={cn(
          "flex h-full flex-col border-border bg-card text-card-foreground",
          forceExpanded ? "w-full" : collapsed ? "w-[56px]" : "w-[280px]",
        )}
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-3">
          {showExpanded ? (
            <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight text-foreground">Conversations</h2>
          ) : (
            <MessageSquare className="mx-auto size-4 text-muted-foreground" aria-hidden />
          )}
          {!forceExpanded ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setCollapsed((value) => !value)}
              aria-expanded={!collapsed}
              aria-controls={SIDEBAR_ID}
              aria-label={collapsed ? "Expand conversations sidebar" : "Collapse conversations sidebar"}
            >
              {collapsed ? <ChevronRight className="size-3" aria-hidden /> : <ChevronLeft className="size-3" aria-hidden />}
            </Button>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn("w-full gap-2", showExpanded ? "justify-start" : "justify-center px-0")}
            onClick={startNewConversation}
            aria-label="New conversation"
          >
            <Plus className="size-3.5" aria-hidden />
            {showExpanded ? "New conversation" : <span className="sr-only">New conversation</span>}
          </Button>

          {showExpanded ? (
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="Search conversations"
                className="h-9 w-full rounded-[var(--radius)] border border-input bg-background pl-8 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="Search conversations"
              />
            </label>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {threads.length === 0 ? (
              <div role="status" aria-live="polite" className={cn("flex h-full flex-col items-center justify-center text-center", showExpanded ? "px-4" : "px-1")}>
                <MessageSquare className="mb-2 size-5 text-muted-foreground" aria-hidden />
                {showExpanded ? (
                  <>
                    <p className="text-sm font-medium text-foreground">No conversations yet</p>
                    <p className="mt-1 text-[12px] leading-snug text-muted-foreground">Ask Haven a question to start your first thread.</p>
                  </>
                ) : null}
              </div>
            ) : visibleThreads.length === 0 ? (
              <div role="status" aria-live="polite" className="px-2 py-8 text-center text-[12px] text-muted-foreground">
                No matching conversations.
              </div>
            ) : (
              <div className="space-y-4">
                {pinnedThreads.length ? renderSection({ key: "pinned", label: "Pinned", threads: pinnedThreads }, forceExpanded) : null}
                {dateSections.map((section) => renderSection(section, forceExpanded))}
              </div>
            )}
          </div>
        </div>
      </aside>
    );
  };

  return (
    <>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger
          className={cn(
            "absolute right-0 top-0 z-40 lg:hidden inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-[12px] font-medium",
            "text-foreground transition-colors hover:bg-secondary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          aria-label="Open Haven Insight conversations"
        >
          <Menu className="size-4" aria-hidden />
          Conversations
        </SheetTrigger>
        <SheetContent side="left" className="w-[280px] p-0" showCloseButton={false}>
          <SheetHeader className="sr-only">
            <SheetTitle>Conversations</SheetTitle>
          </SheetHeader>
          {sidebarBody(true)}
        </SheetContent>
      </Sheet>

      <div className="absolute inset-y-0 left-0 z-30 hidden border-r border-border lg:block">
        {sidebarBody(false)}
      </div>
    </>
  );
}
