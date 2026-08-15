import Link from "next/link";
import { ChevronRight, Megaphone } from "lucide-react";

import {
  FAMILY_HOME_BULLETIN_EMPTY_DESCRIPTION,
  FAMILY_HOME_BULLETIN_EMPTY_TITLE,
  FAMILY_HOME_BULLETIN_HELPER,
  FAMILY_HOME_BULLETIN_TITLE,
} from "@/lib/family/family-portal-copy";
import { formatFamilyPortalTimestamp } from "@/lib/family/family-portal-notes-display";
import type { FamilyFeedNoteItem } from "@/lib/family/family-feed";
import { cn } from "@/lib/utils";

import { FamilyPortalNoteEntry } from "./FamilyPortalNoteEntry";

export type FamilyHomeBulletinBarProps = {
  featuredNote: FamilyFeedNoteItem | null;
  className?: string;
};

export function FamilyHomeBulletinBar({
  featuredNote,
  className,
}: FamilyHomeBulletinBarProps) {
  return (
    <section
      aria-label={FAMILY_HOME_BULLETIN_TITLE}
      className={cn(
        "w-full rounded-lg border border-primary/20 bg-card/95 p-5 shadow-sm backdrop-blur-sm md:p-6",
        className,
      )}
    >
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-primary">
          <Megaphone className="h-4 w-4 shrink-0" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-foreground">{FAMILY_HOME_BULLETIN_TITLE}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{FAMILY_HOME_BULLETIN_HELPER}</p>
        {featuredNote ? (
          <p className="text-xs text-muted-foreground">
            Last posted {formatFamilyPortalTimestamp(featuredNote.sortAt)}
          </p>
        ) : null}
      </header>

      {featuredNote ? (
        <div className="mt-4 space-y-4">
          <FamilyPortalNoteEntry
            id={featuredNote.id}
            body={featuredNote.body}
            timestamp={featuredNote.sortAt}
            authorLabel="Care team"
            variant="staff"
          />
          <div className="flex justify-end">
            <Link
              href={featuredNote.href}
              className={cn(
                "inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] hover:text-primary/80",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
              )}
            >
              View all updates
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-10 text-center">
          <p className="text-sm font-medium text-foreground">{FAMILY_HOME_BULLETIN_EMPTY_TITLE}</p>
          <p className="mx-auto mt-2 max-w-sm text-xs text-muted-foreground">
            {FAMILY_HOME_BULLETIN_EMPTY_DESCRIPTION}
          </p>
        </div>
      )}
    </section>
  );
}
