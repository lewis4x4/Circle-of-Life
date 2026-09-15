"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ServiceWorkerUpdateBannerProps = {
  onReload: () => void;
  className?: string;
};

/**
 * Quiet Operator banner when a newer Haven build is available (COL-397).
 */
export function ServiceWorkerUpdateBanner({
  onReload,
  className,
}: ServiceWorkerUpdateBannerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed bottom-0 left-0 right-0 z-[100] border-t border-border bg-muted/95 px-4 py-3 shadow-lg backdrop-blur-sm safe-bottom",
        className,
      )}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-foreground">
          <span className="font-semibold">New version available.</span>{" "}
          Reload to get the latest Haven build.
        </p>
        <Button type="button" size="sm" className="shrink-0" onClick={onReload}>
          Reload to update
        </Button>
      </div>
    </div>
  );
}
