/**
 * V2DashboardLoading — route-level loading skeleton for the UI-V2 admin
 * surface. Quiet Operator skeleton pattern: animated `bg-muted` bars on
 * `bg-card` cards with `border-border` and `rounded-lg`. No hardcoded
 * slate/zinc — semantic tokens only. The wrapper announces politely
 * with `role="status"` so SR users hear the load without interruption.
 */
export default function V2DashboardLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading dashboard"
      className="flex flex-col gap-4 p-4"
    >
      <span className="h-6 w-1/3 animate-pulse rounded-md bg-muted" />
      <span className="h-3 w-1/4 animate-pulse rounded-md bg-muted" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className="h-24 animate-pulse rounded-lg border border-border bg-card"
          />
        ))}
      </div>
      <span className="h-48 animate-pulse rounded-lg border border-border bg-card" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
