"use client";

import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { filterCitedSuggestions } from "./filter-citations";
import type { CopilotAction, CopilotSuggestion } from "./types";

export type CopilotDrawerProps = {
  open: boolean;
  onClose: () => void;
  suggestions: unknown[];
  onAction?: (action: CopilotAction, suggestion: CopilotSuggestion) => void;
  emptyCopy?: string;
  className?: string;
};

export function CopilotDrawer({
  open,
  onClose,
  suggestions,
  onAction,
  emptyCopy = "No cite-backed suggestions in scope right now.",
  className,
}: CopilotDrawerProps) {
  const cited = useMemo(() => filterCitedSuggestions(suggestions), [suggestions]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!open) return null;

  const selected = cited.find((s) => s.id === selectedId) ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Copilot suggestions"
      className={cn(
        "fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-popover",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold tracking-tight text-text-primary">
            Copilot
          </h2>
          <p className="text-xs text-text-muted">
            All suggestions are cite-backed. Actions write to the Copilot audit log.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Copilot drawer"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface-elevated text-xs text-text-secondary hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          ×
        </button>
      </header>

      <div className="flex-1 overflow-auto">
        {cited.length === 0 ? (
          <p className="px-4 py-6 text-xs text-text-muted">{emptyCopy}</p>
        ) : (
          <ul
            aria-label="Copilot suggestions"
            className="flex flex-col divide-y divide-border"
          >
            {cited.map((suggestion) => {
              const isOpen = selected?.id === suggestion.id;
              return (
                <li key={suggestion.id} className="flex flex-col gap-2 px-4 py-3">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setSelectedId(isOpen ? null : suggestion.id)}
                    className="text-left"
                  >
                    <p className="text-sm font-semibold text-text-primary">
                      {suggestion.title}
                    </p>
                    <p className="mt-1 text-xs text-text-secondary">
                      {suggestion.body}
                    </p>
                  </button>
                  <p className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                    <span className="inline-flex items-center rounded-sm border border-brand-accent px-1.5 py-0.5 text-xs font-semibold text-brand-accent">
                      cite-backed ({suggestion.citations.length})
                    </span>
                    <span>{suggestion.recordType}</span>
                    <span aria-hidden="true">·</span>
                    <span>{suggestion.facilityId}</span>
                    <span aria-hidden="true">·</span>
                    <span>{suggestion.modelVersion}</span>
                  </p>
                  {isOpen && (
                    <>
                      <ul className="flex flex-col gap-1 rounded-sm border border-border bg-surface-subtle p-2 text-xs text-text-secondary">
                        {suggestion.citations.map((citation, index) => (
                          <li key={`${citation.source}-${citation.id}-${index}`}>
                            <span className="font-semibold text-text-primary">
                              {citation.source}:{citation.id}
                            </span>
                            <span aria-hidden="true"> — </span>
                            <span>{citation.excerpt}</span>
                          </li>
                        ))}
                      </ul>
                      <div
                        role="group"
                        aria-label={`Actions for ${suggestion.title}`}
                        className="flex flex-wrap gap-2 pt-1"
                      >
                        <ActionButton
                          label="ACK"
                          tone="primary"
                          onClick={() => onAction?.("ack", suggestion)}
                        />
                        <ActionButton
                          label="Act"
                          tone="secondary"
                          onClick={() => onAction?.("act", suggestion)}
                        />
                        <ActionButton
                          label="Dismiss"
                          tone="muted"
                          onClick={() => onAction?.("dismiss", suggestion)}
                        />
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone: "primary" | "secondary" | "muted";
  onClick: () => void;
}) {
  const toneClass =
    tone === "primary"
      ? "border-brand-primary bg-surface-elevated text-text-primary"
      : tone === "secondary"
        ? "border-brand-accent bg-surface-elevated text-brand-accent"
        : "border-border bg-surface-elevated text-text-muted";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center rounded-sm border px-3 text-xs font-semibold hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary",
        toneClass,
      )}
    >
      {label}
    </button>
  );
}
