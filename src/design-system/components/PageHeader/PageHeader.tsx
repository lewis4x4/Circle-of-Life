import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type PageHeaderProps = {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/** Page masthead — h1 + optional subtitle + right actions. No Card wrapper (Quiet Operator). */
export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 md:flex-row md:items-end md:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-3">
        <h1 className="text-[2rem] font-semibold tracking-tight text-foreground md:text-[2.75rem] md:leading-[1.1]">
          {title}
        </h1>
        {subtitle ? (
          <div className="max-w-2xl text-pretty text-base font-medium leading-relaxed text-muted-foreground">
            {subtitle}
          </div>
        ) : null}
      </div>
      {actions != null ? (
        <div className="flex shrink-0 flex-row flex-wrap items-center justify-start gap-2 sm:justify-end">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
