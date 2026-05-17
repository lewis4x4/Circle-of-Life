/**
 * FamilyLoading — route-level loading skeleton for the family portal.
 * Quiet Operator skeleton: animated `bg-muted` bars on `bg-card` rows
 * with `border-border` and `rounded-lg`. The family theme remaps the
 * semantic tokens to the warm cream palette via the `.light` wrapper,
 * so the skeleton renders correctly in both shells without re-coloring.
 */
export default function FamilyLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className="animate-pulse space-y-4 p-4"
    >
      <div className="h-8 w-40 rounded-md bg-muted" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-20 rounded-lg border border-border bg-card"
          />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
