import Link from "next/link";
import { cn } from "@/lib/utils";

export type ActionQueueItem = {
  id: string;
  icon?: React.ReactNode;
  label: string;
  sublabel?: string;
  count: number;
  href: string;
};

export type ActionQueueProps = {
  items: ActionQueueItem[];
  emptyCopy?: string;
  className?: string;
};

export function ActionQueue({
  items,
  emptyCopy = "No pending actions",
  className,
}: ActionQueueProps) {
  if (items.length === 0) {
    return (
      <p className={cn("text-xs text-text-muted", className)}>{emptyCopy}</p>
    );
  }

  return (
    <ul
      aria-label="Action queue"
      className={cn("flex flex-col divide-y divide-border", className)}
    >
      {items.map((item) => (
        <li key={item.id} className="group">
          <Link
            href={item.href}
            className="flex items-center gap-3 rounded-sm px-3 py-2 text-sm text-text-primary transition-colors hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            {item.icon && (
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-surface text-text-secondary">
                {item.icon}
              </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate font-medium">{item.label}</span>
              {item.sublabel && (
                <span className="truncate text-xs text-text-secondary">
                  {item.sublabel}
                </span>
              )}
            </span>
            <CountBadge count={item.count} />
            <span aria-hidden="true" className="text-text-muted">
              ›
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function CountBadge({ count }: { count: number }) {
  const label = count > 99 ? "99+" : String(count);
  const tone = count > 0 ? "danger" : "neutral";
  return (
    <span
      data-tone={tone}
      aria-label={`${count} items`}
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums",
        tone === "danger"
          ? "bg-danger text-text-inverse"
          : "bg-surface-elevated text-text-muted",
      )}
    >
      {label}
    </span>
  );
}
