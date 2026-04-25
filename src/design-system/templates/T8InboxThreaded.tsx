"use client";

import { useState } from "react";

import { type AuditFooterProps } from "../components/AuditFooter";
import { PageShell } from "../components/PageShell";
import { cn } from "@/lib/utils";

export type T8QueueItem = {
  id: string;
  title: string;
  preview?: string;
  meta?: string;
  unread?: boolean;
};

export type T8InboxThreadedProps = {
  title: string;
  subtitle?: string;
  queue: T8QueueItem[];
  /** Render the thread detail given the selected item; receive the item or null. */
  renderThread: (item: T8QueueItem | null) => React.ReactNode;
  /** Right rail context (resident card, related links, etc.). */
  contextRail?: React.ReactNode;
  initialSelectedId?: string;
  audit: AuditFooterProps;
};

export function T8InboxThreaded({
  title,
  subtitle,
  queue,
  renderThread,
  contextRail,
  initialSelectedId,
  audit,
}: T8InboxThreadedProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId ?? queue[0]?.id ?? null,
  );
  const selected = queue.find((q) => q.id === selectedId) ?? null;

  return (
    <PageShell
      title={title}
      subtitle={subtitle}
      audit={audit}
      rightRail={contextRail}
    >
      <div className="flex flex-col gap-4 lg:flex-row">
        <nav aria-label="Inbox queue" className="w-full shrink-0 rounded-md border border-border bg-surface lg:w-72">
          <header className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-caps text-text-muted">
            Queue · {queue.length}
          </header>
          {queue.length === 0 ? (
            <p className="px-4 py-3 text-xs text-text-muted">Queue is empty.</p>
          ) : (
            <ul className="flex flex-col">
              {queue.map((item) => {
                const active = item.id === selectedId;
                return (
                  <li key={item.id} className="border-b border-border last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      aria-current={active ? "true" : undefined}
                      aria-label={`Open thread: ${item.title}`}
                      className={cn(
                        "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors",
                        active
                          ? "bg-surface-elevated text-text-primary"
                          : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        {item.unread && (
                          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-info" />
                        )}
                        <span className="text-sm font-semibold text-text-primary">
                          {item.title}
                        </span>
                      </span>
                      {item.preview && (
                        <span className="line-clamp-2 text-xs text-text-secondary">
                          {item.preview}
                        </span>
                      )}
                      {item.meta && (
                        <span className="text-xs text-text-muted">{item.meta}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <section
          aria-label="Thread detail"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface p-4 min-h-72"
        >
          {renderThread(selected)}
        </section>
      </div>
    </PageShell>
  );
}
