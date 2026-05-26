"use client";

import Link from "next/link";
import { ArrowRight, DatabaseZap } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SourceReadinessCallout } from "@/lib/reporting-source-readiness";

type SourceReadinessCalloutProps = {
  copy: SourceReadinessCallout;
  className?: string;
};

export function SourceReadinessCallout({
  copy,
  className,
}: SourceReadinessCalloutProps) {
  return (
    <section
      className={cn(
        "rounded-lg border border-amber-300/70 bg-amber-50/80 p-4 text-amber-950 shadow-sm dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100",
        className,
      )}
      aria-label={copy.title}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-400/70 bg-background/70 dark:border-amber-800/80 dark:bg-amber-950/40">
          <DatabaseZap className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold tracking-tight">{copy.title}</h2>
            <p className="max-w-3xl text-sm leading-relaxed text-amber-900/85 dark:text-amber-100/85">
              {copy.description}
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {copy.actions.map((action) => (
              <div
                key={action.href}
                className="rounded-md border border-amber-300/60 bg-background/80 p-3 dark:border-amber-900/70 dark:bg-background/40"
              >
                <p className="text-sm font-medium text-foreground">{action.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {action.description}
                </p>
                <Link
                  href={action.href}
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "sm" }),
                    "mt-3 h-8 px-0 text-xs font-medium text-amber-900 hover:bg-transparent hover:text-amber-950 dark:text-amber-200 dark:hover:text-amber-100",
                  )}
                >
                  {action.ctaLabel}
                  <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
