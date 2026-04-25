"use client";

import { useState } from "react";

import { CopilotButton } from "./CopilotButton";
import { CopilotDrawer } from "./CopilotDrawer";
import fixtureSuggestions from "./__fixtures__/suggestions.json";
import type { CopilotAction, CopilotSuggestion } from "./types";

const UNCITED = {
  id: "bad-1",
  title: "Missing citations",
  body: "Suggestion without citations — should be dropped.",
  recordId: "x",
  recordType: "x",
  facilityId: "x",
  generatedAt: "2026-04-24T15:58:00-04:00",
  modelVersion: "v1",
  citations: [],
};

export function CopilotButtonPreview() {
  const [log, setLog] = useState<string[]>([]);
  const [openFor, setOpenFor] = useState<"closed" | "empty" | "with" | "selected">("closed");

  function record(action: CopilotAction, suggestion: CopilotSuggestion) {
    setLog((prev) => [
      ...prev,
      `${action}:${suggestion.id}@${new Date().toISOString()}`,
    ]);
  }

  return (
    <div className="flex flex-col gap-4">
      <PreviewSection state="closed" title="Closed — button only">
        <CopilotButton suggestions={fixtureSuggestions} onAction={record} />
      </PreviewSection>

      <PreviewSection state="openEmpty" title="Open drawer — all uncited filtered out">
        <button
          type="button"
          onClick={() => setOpenFor("empty")}
          className="inline-flex h-8 items-center rounded-sm border border-border bg-surface-elevated px-3 text-xs font-medium text-text-secondary hover:border-border-strong"
        >
          Open empty drawer
        </button>
        <CopilotDrawer
          open={openFor === "empty"}
          onClose={() => setOpenFor("closed")}
          suggestions={[UNCITED]}
          onAction={record}
        />
      </PreviewSection>

      <PreviewSection state="openWithSuggestions" title="Open drawer — cited fixture">
        <button
          type="button"
          onClick={() => setOpenFor("with")}
          className="inline-flex h-8 items-center rounded-sm border border-border bg-surface-elevated px-3 text-xs font-medium text-text-secondary hover:border-border-strong"
        >
          Open drawer
        </button>
        <CopilotDrawer
          open={openFor === "with"}
          onClose={() => setOpenFor("closed")}
          suggestions={fixtureSuggestions}
          onAction={record}
        />
      </PreviewSection>

      {log.length > 0 && (
        <PreviewSection state="openSuggestionSelected" title="Action log">
          <pre className="rounded-sm border border-border bg-surface-subtle p-2 text-xs text-text-muted">
            {log.join("\n")}
          </pre>
        </PreviewSection>
      )}
    </div>
  );
}

function PreviewSection({
  title,
  state,
  children,
}: {
  title: string;
  state: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      data-state={state}
      className="rounded-md border border-border bg-surface"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-caps text-text-muted">
          {state}
        </span>
        <span className="text-xs text-text-secondary">{title}</span>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
