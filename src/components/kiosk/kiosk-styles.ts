/**
 * Shared kiosk class strings (DESIGN §1): primary actions in the chrome color,
 * 72 px primary, 60 px fields, visible focus rings, pressed state only.
 */
export const KIOSK_FOCUS = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/50";

export const KIOSK_PRESS = "transition-colors motion-reduce:transition-none active:opacity-90";

export const KIOSK_PRIMARY =
  `inline-flex items-center justify-center gap-3 rounded-[12px] bg-chrome-primary text-[22px] font-semibold text-chrome-foreground hover:bg-chrome-primary/90 disabled:pointer-events-none disabled:opacity-40 ${KIOSK_FOCUS} ${KIOSK_PRESS}`;

export const KIOSK_SECONDARY =
  `inline-flex items-center justify-center gap-3 rounded-[12px] border-[1.5px] border-chrome-primary bg-card text-[22px] font-semibold text-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-40 ${KIOSK_FOCUS} ${KIOSK_PRESS}`;

export const KIOSK_OUTLINE_DONE =
  `inline-flex h-15 items-center rounded-[12px] border-[1.5px] border-chrome-primary px-9 text-[19px] font-semibold text-foreground hover:bg-muted ${KIOSK_FOCUS} ${KIOSK_PRESS}`;

export const KIOSK_CARD = "rounded-[16px] border-[1.5px] border-border bg-card";

export const KIOSK_ICON_TILE = "flex shrink-0 items-center justify-center bg-muted text-chrome-primary";
