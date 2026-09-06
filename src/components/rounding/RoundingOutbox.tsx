"use client";

import Link from "next/link";
import { useRoundingOfflineSync } from "@/hooks/useRoundingOfflineSync";

export function RoundingOutbox() {
  const sync = useRoundingOfflineSync();
  if (!sync.pendingCount && !sync.lastError) return null;
  return <details className="m-3 rounded-lg border border-border bg-card p-3 text-sm">
    <summary className="cursor-pointer font-medium">My Outbox · {sync.pendingCount ? `${sync.pendingCount} unsent observations` : "status unavailable"}</summary>
    <p className="my-2">These observations belong to your account. Conflicts remain here until reconciled with a supervisor.</p>
    {sync.lastError && <p role="alert" className="text-destructive">{sync.lastError}</p>}
    <ul className="my-2 space-y-3">
      {sync.items?.map((item) => <li key={item.id} className="border-t border-border pt-2">
        <Link className="underline" href={`/caregiver/rounds/${item.residentId}?taskId=${item.taskId}`}>Open observation task</Link>
        <p>{new Date(item.payload.observedAt ?? item.queuedAt).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" })} · {item.payload.quickStatus.replaceAll("_", " ")}</p>
        {item.payload.note && <p className="whitespace-pre-wrap">{item.payload.note}</p>}
        <p>{item.lastError ?? "Pending upload"}</p>
      </li>)}
    </ul>
    <button className="rounded border border-border px-3 py-2" type="button" disabled={!sync.online || sync.isSyncing} onClick={() => void sync.flush()}>
      {sync.isSyncing ? "Sending…" : "Retry pending observations"}
    </button>
  </details>;
}
