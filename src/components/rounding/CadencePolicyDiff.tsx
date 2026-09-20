import { policyDiff } from "@/lib/rounding/cadence-policy-diff";

export function CadencePolicyDiff({ before, after }: { before: Record<string, unknown>[]; after: Record<string, unknown>[] }) {
  const changes = policyDiff(before, after);
  return changes.length ? <ul className="space-y-2 text-sm">{changes.map((change) => <li key={change.key}>
    <p className="font-medium">{change.label}</p>
    <p className="text-muted-foreground">Was: {change.before}</p>
    <p>Proposed: {change.after}</p>
  </li>)}</ul> : <p className="text-sm text-muted-foreground">No policy differences.</p>;
}
