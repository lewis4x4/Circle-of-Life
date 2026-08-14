import { cn } from "@/lib/utils";
import {
  formatFamilyDeliveryMethod,
  formatFamilyPortalTimestamp,
} from "@/lib/family/family-portal-notes-display";

export type FamilyPortalNoteEntryProps = {
  id: string;
  body: string;
  timestamp: string;
  authorLabel: string;
  deliveryMethod?: string;
  familyAcknowledgedAt?: string | null;
  variant?: "staff" | "family";
  className?: string;
};

export function FamilyPortalNoteEntry({
  id,
  body,
  timestamp,
  authorLabel,
  deliveryMethod,
  familyAcknowledgedAt,
  variant = "staff",
  className,
}: FamilyPortalNoteEntryProps) {
  const isLegacyFamily = variant === "family";

  return (
    <article
      id={`family-portal-note-${id}`}
      className={cn(
        "rounded-lg border border-border bg-card px-4 py-4 shadow-sm",
        isLegacyFamily && "border-dashed",
        className,
      )}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{authorLabel}</p>
          <time
            dateTime={timestamp}
            className="text-xs text-muted-foreground"
          >
            {formatFamilyPortalTimestamp(timestamp)}
          </time>
        </div>
        {deliveryMethod ? (
          <p className="text-xs text-muted-foreground">
            {formatFamilyDeliveryMethod(deliveryMethod)}
          </p>
        ) : null}
      </header>

      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
        {body}
      </p>

      {isLegacyFamily ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Legacy family message (replies are no longer accepted).
        </p>
      ) : null}

      {familyAcknowledgedAt ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Family viewed{" "}
          {formatFamilyPortalTimestamp(familyAcknowledgedAt)}
        </p>
      ) : null}
    </article>
  );
}
