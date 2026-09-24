"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";

import { FLOOR_FOCUS_RING, FLOOR_PRESS, FLOOR_PRIMARY_BUTTON } from "./floor-styles";

export const FLOOR_PIN_LENGTH = 6;

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/** Six dots; the entered ones filled. The count is announced, never the digits. */
export function PinDots({ filled, length = FLOOR_PIN_LENGTH }: { filled: number; length?: number }) {
  return (
    <div className="flex gap-4" role="img" aria-label={`${filled} of ${length} digits entered`}>
      {Array.from({ length }, (_, index) => (
        <span
          key={index}
          className={cn("size-4.5 rounded-full border-2 border-primary", index < filled ? "bg-primary" : "bg-transparent")}
        />
      ))}
    </div>
  );
}

function KeyButton({ label, onPress, disabled, children, quiet = false, buttonRef }: {
  label: string;
  buttonRef?: Ref<HTMLButtonElement>;
  onPress: () => void;
  disabled?: boolean;
  children: ReactNode;
  quiet?: boolean;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
      className={cn(
        "h-21 rounded-[12px] border font-medium tabular-nums disabled:opacity-50",
        quiet
          ? "border-transparent bg-transparent text-base text-muted-foreground hover:bg-muted"
          : "border-input bg-card text-3xl text-foreground hover:bg-muted",
        FLOOR_PRESS,
        FLOOR_FOCUS_RING,
      )}
    >
      {children}
    </button>
  );
}

/**
 * The floor PIN pad (DESIGN.md 02 and 02b): the person, "Enter your 6-digit
 * PIN", six dots, the helper line, and a custom keypad so the system keyboard
 * never opens. Unlock appears only once all six digits are in. Digit keys on a
 * hardware keyboard work too.
 */
export function PinPad({
  header,
  helper,
  error,
  busy = false,
  resetSignal = 0,
  onUnlock,
}: {
  /** Avatar, name and the clocked-in line, or the employee number box. */
  header: ReactNode;
  helper: string;
  /** Operator words for the last failure; announced. */
  error: string | null;
  busy?: boolean;
  /** Changes after a failed attempt: clear the digits and put focus back on the keypad. */
  resetSignal?: number;
  onUnlock: (pin: string) => void;
}) {
  const [pin, setPin] = useState("");
  const firstKey = useRef<HTMLButtonElement>(null);
  const lastReset = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal === lastReset.current) return;
    lastReset.current = resetSignal;
    setPin("");
    // The Unlock button that had focus is gone; the keypad is where the next try starts.
    firstKey.current?.focus();
  }, [resetSignal]);
  const complete = pin.length === FLOOR_PIN_LENGTH;

  const press = useCallback((digit: string) => {
    setPin((current) => (current.length >= FLOOR_PIN_LENGTH ? current : current + digit));
  }, []);
  const remove = useCallback(() => setPin((current) => current.slice(0, -1)), []);
  const clear = useCallback(() => setPin(""), []);
  const submit = useCallback(() => {
    if (pin.length === FLOOR_PIN_LENGTH && !busy) onUnlock(pin);
  }, [pin, busy, onUnlock]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (busy || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (/^[0-9]$/.test(event.key)) press(event.key);
      else if (event.key === "Backspace") remove();
      // Enter on a focused control (Delete, Clear, Not you, a key) activates that control, not Unlock.
      else if (event.key === "Enter" && !(target && target.closest("button, a, [role='button']"))) submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, press, remove, submit]);

  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-x-10 gap-y-8 lg:gap-x-24">
      <div className="flex w-90 max-w-full flex-col items-center gap-4.5">
        {header}
        <p className="mt-3 text-[17px] text-foreground">Enter your 6-digit PIN</p>
        <PinDots filled={pin.length} />
        <p className="text-[13px] text-muted-foreground">{helper}</p>
        <p role="status" aria-live="polite" className={cn("min-h-5 text-center text-[15px] font-medium text-destructive", !error && "sr-only")}>
          {error ?? ""}
        </p>
        {complete ? (
          <button type="button" onClick={submit} disabled={busy} className={cn(FLOOR_PRIMARY_BUTTON, "h-15 w-65 rounded-[10px] text-lg")}>
            <Lock className="size-4.5" aria-hidden />
            {busy ? "Unlocking" : "Unlock"}
          </button>
        ) : null}
      </div>
      <div className="grid w-87 grid-cols-3 gap-3.5" aria-label="PIN keypad" role="group">
        {DIGITS.map((digit) => (
          <KeyButton key={digit} label={`Digit ${digit}`} onPress={() => press(digit)} disabled={busy} buttonRef={digit === "1" ? firstKey : undefined}>
            {digit}
          </KeyButton>
        ))}
        <KeyButton label="Clear" onPress={clear} disabled={busy} quiet>
          Clear
        </KeyButton>
        <KeyButton label="Digit 0" onPress={() => press("0")} disabled={busy}>
          0
        </KeyButton>
        <KeyButton label="Delete" onPress={remove} disabled={busy} quiet>
          Delete
        </KeyButton>
      </div>
    </div>
  );
}
