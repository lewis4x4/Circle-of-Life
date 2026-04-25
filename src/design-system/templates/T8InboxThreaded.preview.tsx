"use client";

import { T8InboxThreaded } from "./T8InboxThreaded";

const FIXED_NOW = new Date("2026-04-24T16:00:00-04:00");

export function T8InboxThreadedPreview() {
  return (
    <T8InboxThreaded
      title="Family messages"
      subtitle="Awaiting reply"
      queue={[
        {
          id: "m1",
          title: "Smith family — medication question",
          preview: "Can you confirm Aria received her 8AM dose today?",
          meta: "Oakridge ALF · 14m ago",
          unread: true,
        },
        {
          id: "m2",
          title: "Jones family — visit confirmation",
          preview: "Confirming Saturday 2 PM visit. Park at side lot?",
          meta: "Plantation · 41m ago",
        },
        {
          id: "m3",
          title: "Garcia family — care plan questions",
          preview: "We'd like a care plan review meeting next week.",
          meta: "Homewood Lodge · 2h ago",
        },
      ]}
      renderThread={(item) =>
        item ? (
          <article aria-label={`Thread: ${item.title}`} className="flex flex-col gap-3">
            <header>
              <h2 className="text-base font-semibold text-text-primary">{item.title}</h2>
              <p className="text-xs text-text-muted">{item.meta}</p>
            </header>
            <div className="rounded-sm border border-border bg-surface-subtle p-3 text-sm text-text-secondary">
              {item.preview}
            </div>
            <textarea
              aria-label="Reply"
              placeholder="Type a reply…"
              className="min-h-24 rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text-primary"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-sm border border-border bg-surface-elevated px-3 text-xs font-medium text-text-secondary hover:border-border-strong"
              >
                Save draft
              </button>
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-sm border border-brand-primary bg-surface-elevated px-3 text-xs font-semibold text-text-primary hover:bg-surface"
              >
                Send reply
              </button>
            </div>
          </article>
        ) : (
          <p className="text-sm text-text-muted">Select a message to view the thread.</p>
        )
      }
      contextRail={
        <section className="rounded-md border border-border bg-surface">
          <header className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-caps text-text-muted">
            Context
          </header>
          <dl className="flex flex-col px-4 py-2 text-xs text-text-secondary">
            <div className="flex justify-between border-b border-border py-1">
              <dt>Resident</dt>
              <dd className="text-text-primary">A. Smith</dd>
            </div>
            <div className="flex justify-between border-b border-border py-1">
              <dt>Facility</dt>
              <dd className="text-text-primary">Oakridge ALF</dd>
            </div>
            <div className="flex justify-between py-1">
              <dt>Care plan</dt>
              <dd className="text-text-primary">Tier 3</dd>
            </div>
          </dl>
        </section>
      }
      audit={{
        auditHref: "/admin/audit-log",
        updatedAt: "2026-04-24T15:57:00-04:00",
        now: FIXED_NOW,
      }}
    />
  );
}
