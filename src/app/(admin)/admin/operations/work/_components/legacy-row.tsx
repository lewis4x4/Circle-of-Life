"use client";

import { useEffect, useRef, useState } from "react";
import type { OperationTask } from "@/lib/operations/types";
import { CONTROL } from "./work-inputs";

export function LegacyRow({
  task,
  actorName,
}: {
  task: OperationTask;
  actorName: string;
}) {
  const [status, setStatus] = useState<string>(task.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  const complete = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function run(action: "start" | "complete") {
    if (busy || status === "completed") return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/operations/tasks/${task.id}/${action}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const body = await response.json();
      if (!active.current) return;
      if (!response.ok) throw new Error(body.error ?? "Legacy action failed");
      if (typeof body.status !== "string")
        throw new Error(
          "Action saved but current status unavailable. Open legacy operations before retrying.",
        );
      setStatus(body.status);
    } catch (failure) {
      if (active.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Legacy action unavailable",
        );
    } finally {
      if (active.current) {
        setBusy(false);
        requestAnimationFrame(() =>
          complete.current?.focus({ preventScroll: true }),
        );
      }
    }
  }
  return (
    <li className="space-y-2 rounded-md border border-border p-4">
      <h3 className="font-semibold">{task.template_name}</h3>
      <p>Status: {status}</p>
      <p>Current person: {actorName}</p>
      <div className="flex flex-wrap gap-2">
        <button
          ref={complete}
          type="button"
          className={CONTROL}
          disabled={busy}
          aria-disabled={status === "completed"}
          onClick={() => void run("complete")}
        >
          Complete legacy task
        </button>
        {status === "pending" ? (
          <button
            type="button"
            className={CONTROL}
            disabled={busy}
            onClick={() => void run("start")}
          >
            Start legacy task
          </button>
        ) : null}
        <a
          className={`${CONTROL} inline-flex items-center`}
          href="/admin/operations"
        >
          Other legacy actions
        </a>
      </div>
      {busy ? <p role="status">Saving legacy task…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </li>
  );
}
