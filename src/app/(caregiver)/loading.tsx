/**
 * CaregiverLoading — route-level loading skeleton for the caregiver
 * surface. Quiet Operator skeleton: animated `bg-muted` bars on
 * `bg-card` rows with `border-border` and `rounded-lg`.
 */
export default function CaregiverLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className="animate-pulse space-y-4 p-4"
    >
      <div className="h-8 w-40 rounded-md bg-muted" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-lg border border-border bg-card"
          />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
