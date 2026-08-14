import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  FamilyPortalNoteEntry,
  type FamilyPortalNoteEntryProps,
} from "./FamilyPortalNoteEntry";

export type FamilyPortalUpdateLogItem = Omit<
  FamilyPortalNoteEntryProps,
  "className"
>;

export type FamilyPortalUpdateLogProps = {
  items: FamilyPortalUpdateLogItem[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  listLabel?: string;
  className?: string;
};

export function FamilyPortalUpdateLog({
  items,
  loading = false,
  emptyTitle = "No updates yet",
  emptyDescription = "Posted notes will appear here in date order.",
  listLabel = "Posted updates",
  className,
}: FamilyPortalUpdateLogProps) {
  if (loading) {
    return (
      <div
        className={cn(
          "flex items-center justify-center py-16 text-muted-foreground",
          className,
        )}
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        className={cn(
          "rounded-lg border border-dashed border-border bg-muted/30 px-6 py-12 text-center",
          className,
        )}
      >
        <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
        <p className="mx-auto mt-2 max-w-sm text-xs text-muted-foreground">
          {emptyDescription}
        </p>
      </div>
    );
  }

  return (
    <section aria-label={listLabel} className={cn("space-y-3", className)}>
      <h3 className="text-sm font-medium text-muted-foreground">{listLabel}</h3>
      <ol className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id}>
            <FamilyPortalNoteEntry {...item} />
          </li>
        ))}
      </ol>
    </section>
  );
}
