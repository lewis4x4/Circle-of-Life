/** Compare stored policy, including nested overrides; database identities are not policy. */
const METADATA = new Set(["id", "created_at", "created_by", "updated_at", "updated_by", "deleted_at", "organization_id", "facility_id", "cadence_version_id", "escalation_version_id", "cadence_template_version_id", "escalation_template_version_id"]);

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !METADATA.has(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}
export function policyText(value: unknown): string {
  if (value == null) return "Inherit / not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map(policyText).join("; ") : "None";
  if (typeof value === "object") return Object.entries(value).filter(([key]) => !METADATA.has(key)).map(([key, child]) => `${key.replaceAll("_", " ")}: ${policyText(child)}`).join(", ");
  return String(value).replaceAll("_", " ");
}
export function policyDiff(before: Record<string, unknown>[], after: Record<string, unknown>[]) {
  const keyOf = (row: Record<string, unknown>, index: number) => String(row.window_key ?? row.rung_key ?? row.shift_key ?? row.signal_key ?? index);
  const old = new Map(before.map((row, index) => [keyOf(row, index), row]));
  const next = new Map(after.map((row, index) => [keyOf(row, index), row]));
  return [...new Set([...old.keys(), ...next.keys()])].flatMap((key) => {
    const left = old.get(key); const right = next.get(key);
    return [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])].filter((field) => !METADATA.has(field) && JSON.stringify(stable(left?.[field])) !== JSON.stringify(stable(right?.[field]))).map((field) => ({ key: `${key}:${field}`, label: `${String(right?.label ?? left?.label ?? key)} · ${field.replaceAll("_", " ")}`, before: left ? policyText(left[field]) : "Not present", after: right ? policyText(right[field]) : "Removed" }));
  });
}
