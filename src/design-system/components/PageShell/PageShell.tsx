import { AuditFooter, type AuditFooterProps } from "../AuditFooter";
import { TopBar } from "../TopBar";
import { cn } from "@/lib/utils";

export type PageShellProps = {
  title: string;
  subtitle?: string;
  scope?: React.ReactNode;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  topBarExtras?: React.ReactNode;
  /** Full-width chrome under the title (hub strips). */
  belowHeader?: React.ReactNode;
  children: React.ReactNode;
  rightRail?: React.ReactNode;
  audit: AuditFooterProps;
  className?: string;
};

export function PageShell({
  title,
  subtitle,
  scope,
  filters,
  actions,
  topBarExtras,
  belowHeader,
  children,
  rightRail,
  audit,
  className,
}: PageShellProps) {
  const hasRightRail = rightRail != null;

  return (
    <div
      className={cn(
        "flex flex-col gap-5 bg-app text-text-primary",
        className,
      )}
    >
      <TopBar
        title={title}
        subtitle={subtitle}
        scope={scope}
        actions={actions}
        extras={topBarExtras}
      />

      {belowHeader != null ? <div className="px-4">{belowHeader}</div> : null}

      {filters != null && (
        <section
          aria-label="Filters"
          className="rounded-md border border-border bg-surface px-4 py-3"
        >
          {filters}
        </section>
      )}

      <div
        className={cn(
          "grid gap-5",
          hasRightRail
            ? "grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px]"
            : "grid-cols-1",
        )}
      >
        <main id="page-shell-main" className="min-w-0">
          {children}
        </main>

        {hasRightRail && (
          <aside
            aria-label="Right rail"
            className="flex flex-col gap-4 min-w-0"
          >
            {rightRail}
          </aside>
        )}
      </div>

      <AuditFooter {...audit} />
    </div>
  );
}
