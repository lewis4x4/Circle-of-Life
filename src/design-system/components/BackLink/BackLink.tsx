import Link from "next/link";

import { cn } from "@/lib/utils";

export type BackLinkProps = {
  /** Where "back" goes, named as the destination ("Admissions", "Resident profile"), not "Back". */
  label: string;
  href: string;
  className?: string;
};

/**
 * The one back link (COL-656). Sentence-case destination name after a
 * decorative arrow, muted until hover, above the page title. Replaces the
 * "← Queue" / "‹ Back to admissions" / "BACK TO PROFILE" pill / boxed "← HUB"
 * variants; `haven-ui/no-adhoc-back-link` keeps new ones out.
 */
export function BackLink({ label, href, className }: BackLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors duration-[var(--motion-duration-micro)] hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
        className,
      )}
    >
      <span aria-hidden="true">←</span>
      {label}
    </Link>
  );
}
