import type { SavedControlledCount } from "@/lib/medications/controlled-count-batch";
export function PendingCountReceipt({ counts, medicationNames }: { counts: SavedControlledCount[]; medicationNames: Map<string, string> }) {
  return <div className="my-3 max-h-48 overflow-auto rounded border border-zinc-700 p-3"><p className="text-sm font-semibold">Verify these saved counts before signing</p><ul className="space-y-2 text-xs">{counts.map((count) => <li key={count.id}>{medicationNames.get(count.resident_medication_id) ?? "Medication record"} · {count.count_date} {count.shift}: expected {count.expected_count}, counted {count.actual_count}</li>)}</ul></div>;
}
