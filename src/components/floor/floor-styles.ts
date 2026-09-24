/**
 * Class strings the floor tablet components share (DESIGN.md §1, §3). Semantic
 * tokens only; sizes are the prototype's, on the Tailwind scale where it has
 * the value.
 */

export const FLOOR_FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Pressed state only; no other motion (DESIGN.md §1 "Motion"). */
export const FLOOR_PRESS = "active:opacity-90";

/** 1 px outlined button on the canvas: Switch, Cancel, Start over, Not listed. */
export const FLOOR_OUTLINE_BUTTON = `inline-flex items-center justify-center gap-2 rounded-[8px] border border-input bg-transparent text-foreground hover:bg-muted ${FLOOR_PRESS} ${FLOOR_FOCUS_RING}`;

/** Filled primary: Done when due, Unlock, Save check, Back to Now. */
export const FLOOR_PRIMARY_BUTTON = `inline-flex items-center justify-center gap-2 rounded-[8px] border border-primary bg-primary font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 ${FLOOR_PRESS} ${FLOOR_FOCUS_RING}`;

/** Square 44 px back button beside a screen title. */
export const FLOOR_BACK_BUTTON = `inline-flex size-11 shrink-0 items-center justify-center rounded-[8px] border border-input text-foreground hover:bg-muted ${FLOOR_PRESS} ${FLOOR_FOCUS_RING}`;

/** Sentence-case section label in the muted color (DESIGN.md §2 item 3). */
export const FLOOR_SECTION_LABEL = "text-xs font-semibold text-muted-foreground";
