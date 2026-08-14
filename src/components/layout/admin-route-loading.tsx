/**
 * AdminRouteLoading — shared route-level skeleton for admin surfaces.
 * Quiet Operator pattern: animated `bg-muted` bars and `bg-card` cards.
 */
export default function AdminRouteLoading({ inset = true }: { inset?: boolean } = {}) {
  return (
    <div
      data-testid="admin-route-loading"
      role="status"
      aria-live="polite"
      aria-label="Loading page"
      className={`animate-pulse space-y-6${inset ? " p-6" : ""}`}
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
      <span className="sr-only">Loading page…</span>
    </div>
  );
}
