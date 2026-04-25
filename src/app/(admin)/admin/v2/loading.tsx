export default function V2DashboardLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading dashboard"
      className="flex flex-col gap-4 p-4"
    >
      <span className="h-6 w-1/3 animate-pulse rounded-sm bg-surface-elevated" />
      <span className="h-3 w-1/4 animate-pulse rounded-sm bg-surface-elevated" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className="h-24 animate-pulse rounded-md border border-border bg-surface"
          />
        ))}
      </div>
      <span className="h-48 animate-pulse rounded-md border border-border bg-surface" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
