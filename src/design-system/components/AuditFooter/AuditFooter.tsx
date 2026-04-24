import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { cn } from "@/lib/utils";

export type AuditFooterProps = {
  auditHref: string;
  updatedAt: Date | string;
  timezone?: string;
  live?: boolean;
  now?: Date;
  className?: string;
};

const DEFAULT_TIMEZONE = "America/New_York";

export function AuditFooter({
  auditHref,
  updatedAt,
  timezone = DEFAULT_TIMEZONE,
  live = true,
  now,
  className,
}: AuditFooterProps) {
  const updatedDate = typeof updatedAt === "string" ? new Date(updatedAt) : updatedAt;
  const reference = now ?? new Date();
  const relative = formatRelative(updatedDate, reference);
  const tzLabel = formatInTimeZone(updatedDate, timezone, "zzz");
  const absoluteLabel = formatInTimeZone(updatedDate, timezone, "yyyy-MM-dd HH:mm");
  const statusLabel = live ? "Live" : "Offline";

  return (
    <footer
      role="contentinfo"
      aria-label="Audit footer"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-subtle px-4 py-3 text-xs text-text-secondary",
        className,
      )}
    >
      <Link
        href={auditHref}
        className="font-medium text-brand-primary hover:text-brand-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary rounded-sm"
      >
        Audit Trail
      </Link>

      <div className="flex items-center gap-4">
        <span
          role="status"
          aria-live="polite"
          className="flex items-center gap-2"
        >
          <span
            aria-hidden="true"
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              live ? "bg-success" : "bg-neutral",
            )}
          />
          <span className="font-medium text-text-primary">{statusLabel}</span>
        </span>

        <span aria-label={`Updated ${relative} at ${absoluteLabel} ${tzLabel}`}>
          Updated {relative}
        </span>

        <span className="tracking-wide text-text-muted" aria-label="Timezone">
          {tzLabel}
        </span>
      </div>
    </footer>
  );
}

function formatRelative(updated: Date, now: Date): string {
  const diffMs = Math.max(0, now.getTime() - updated.getTime());
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
