"use client";

import { cn } from "@/lib/utils";

import { KIOSK_FOCUS, KIOSK_PRESS } from "./kiosk-styles";

/**
 * No and Yes, nothing chosen until the visitor taps one (constitution: no
 * pre-selected answers). The chosen one fills in the chrome color.
 */
export function YesNoToggle({
  labelId,
  value,
  onChange,
  describedBy,
}: {
  labelId: string;
  value: boolean | null;
  onChange: (value: boolean) => void;
  describedBy?: string;
}) {
  const option = (answer: boolean, text: string) => {
    const pressed = value === answer;
    return (
      <button
        type="button"
        aria-pressed={pressed}
        onClick={() => onChange(answer)}
        className={cn(
          "h-15 w-37.5 rounded-[10px] text-xl",
          pressed
            ? "border-[2.5px] border-chrome-primary bg-chrome-primary font-semibold text-chrome-foreground"
            : "border-[1.5px] border-input bg-card font-medium text-foreground hover:bg-muted",
          KIOSK_FOCUS,
          KIOSK_PRESS,
        )}
      >
        {text}
      </button>
    );
  };
  return (
    <div role="group" aria-labelledby={labelId} aria-describedby={describedBy} className="flex gap-3">
      {option(false, "No")}
      {option(true, "Yes")}
    </div>
  );
}
