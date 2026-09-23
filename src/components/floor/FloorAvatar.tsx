import { cn } from "@/lib/utils";

const SIZES = {
  /** Top bar, 38 px. */
  sm: "size-9.5 text-sm",
  /** Roster tile, 64 px, raised fill. */
  md: "size-16 text-[22px]",
  /** PIN screen, 96 px. */
  lg: "size-24 text-[34px]",
} as const;

/**
 * Initials in a circle. `filled` is the primary fill of the person who is
 * signing in or signed in; otherwise the raised fill with a hairline.
 */
export function FloorAvatar({
  initials,
  size,
  filled = false,
}: {
  initials: string;
  size: keyof typeof SIZES;
  filled?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        SIZES[size],
        filled ? "bg-primary text-primary-foreground" : "border border-input bg-muted text-foreground",
      )}
    >
      {initials}
    </span>
  );
}
