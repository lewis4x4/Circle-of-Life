"use client";

import { cn } from "@/lib/utils";

import { KIOSK_FOCUS, KIOSK_PRESS } from "./kiosk-styles";

export type KioskKeypadSideKey = {
  label: string;
  onPress: () => void;
  /** `primary` is the filled Next key; `quiet` is text only (Clear, Delete). */
  tone: "primary" | "quiet";
  disabled?: boolean;
};

const KEY = cn("h-22 rounded-[14px] border-[1.5px] disabled:pointer-events-none disabled:opacity-40", KIOSK_FOCUS, KIOSK_PRESS);
const DIGIT = cn(KEY, "border-input bg-card text-[32px] font-medium text-foreground tabular-nums hover:bg-muted");
const TONE = {
  primary: "border-chrome-primary bg-chrome-primary text-xl font-semibold text-chrome-foreground hover:bg-chrome-primary/90",
  quiet: "border-transparent bg-transparent text-lg font-medium text-muted-foreground hover:bg-muted",
} as const;

/**
 * The kiosk's own number pad: 88 px keys in a 390 px grid (DESIGN §1). No
 * system keyboard; a USB badge reader still types into the focused field.
 */
export function KioskKeypad({ onDigit, left, right, label }: { onDigit: (digit: string) => void; left: KioskKeypadSideKey; right: KioskKeypadSideKey; label: string }) {
  const side = (key: KioskKeypadSideKey) => (
    <button type="button" className={cn(KEY, TONE[key.tone])} onClick={key.onPress} disabled={key.disabled}>
      {key.label}
    </button>
  );
  return (
    <div role="group" aria-label={label} className="grid w-97.5 max-w-full shrink-0 grid-cols-3 gap-3.5">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
        <button key={digit} type="button" className={DIGIT} onClick={() => onDigit(digit)} aria-label={`Digit ${digit}`}>
          {digit}
        </button>
      ))}
      {side(left)}
      <button type="button" className={DIGIT} onClick={() => onDigit("0")} aria-label="Digit 0">
        0
      </button>
      {side(right)}
    </div>
  );
}
