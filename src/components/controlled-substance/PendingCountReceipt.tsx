import type { SavedControlledCount } from "@/lib/medications/controlled-count-batch";
export function PendingCountReceipt({ counts, medicationLabels }: { counts: SavedControlledCount[]; medicationLabels: Map<string, string> }) {
  return <div className="my-3 max-h-48 overflow-auto rounded border border-zinc-700 p-3"><p className="text-sm font-semibold">Verify these saved counts before signing</p><ul className="space-y-2 text-xs">{counts.map((count) => <li key={count.id}><span className="block">{medicationLabels.get(count.resident_medication_id) ?? `Medication record: ${count.resident_medication_id}`}</span><span>{count.count_date} {count.shift}: expected {count.expected_count}, counted {count.actual_count}</span></li>)}</ul></div>;
}
