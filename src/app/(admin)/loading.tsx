/**
 * AdminLoading — route-level loading skeleton for the admin surface.
 * Quiet Operator skeleton pattern: animated `bg-muted` bars and
 * `bg-card` cards with `border-border` and `rounded-lg`. Polite live
 * region so screen readers hear the load without interruption.
 */
export default function AdminLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className="animate-pulse space-y-6 p-6"
    >
      <div className="h-8 w-48 rounded-md bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-28 rounded-lg border border-border bg-card"
          />
        ))}
      </div>
      <div className="h-64 rounded-lg border border-border bg-card" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
