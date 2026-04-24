import { cn } from "@/lib/utils";
import { CopilotButtonStub } from "./CopilotButtonStub";

export type TopBarProps = {
  title: string;
  subtitle?: string;
  scope?: React.ReactNode;
  actions?: React.ReactNode;
  extras?: React.ReactNode;
  copilot?: { visible: boolean; label?: string };
  notifications?: { count: number; href?: string };
  userMenu?: React.ReactNode;
  className?: string;
};

export function TopBar({
  title,
  subtitle,
  scope,
  actions,
  extras,
  copilot,
  notifications,
  userMenu,
  className,
}: TopBarProps) {
  return (
    <header
      role="banner"
      aria-label="Page top bar"
      className={cn(
        "flex flex-col gap-3 border-b border-border bg-surface px-4 py-3 md:flex-row md:items-start md:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">
          {title}
        </h1>
        {subtitle != null && (
          <p className="text-sm text-text-secondary">{subtitle}</p>
        )}
        {scope != null && <div className="mt-2 flex flex-wrap gap-2">{scope}</div>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {extras}
        {actions != null && (
          <div
            role="group"
            aria-label="Page actions"
            className="flex flex-wrap items-center gap-2"
          >
            {actions}
          </div>
        )}
        {copilot?.visible && (
          <CopilotButtonStub label={copilot.label ?? "Copilot"} />
        )}
        {notifications != null && (
          <NotificationsStub count={notifications.count} href={notifications.href} />
        )}
        {userMenu}
      </div>
    </header>
  );
}

function NotificationsStub({ count, href }: { count: number; href?: string }) {
  const label = count > 0 ? `Notifications, ${count} unread` : "Notifications";
  const Tag = href ? "a" : "button";
  return (
    <Tag
      {...(href ? { href } : { type: "button" })}
      aria-label={label}
      className="relative inline-flex h-8 items-center justify-center rounded-sm border border-border bg-surface-elevated px-2 text-xs font-medium text-text-secondary hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
    >
      Bell
      {count > 0 && (
        <span
          data-testid="notifications-badge"
          aria-hidden="true"
          className="ml-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-xs font-semibold text-text-inverse"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Tag>
  );
}
