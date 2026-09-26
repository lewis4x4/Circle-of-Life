"use client";

import { forwardRef, useEffect, useRef, type FormEvent } from "react";

import { KIOSK_STAFF_COPY } from "@/lib/kiosk/screens";
import { cn } from "@/lib/utils";

import { KioskKeypad } from "./KioskKeypad";
import { KIOSK_FOCUS, KIOSK_PRIMARY } from "./kiosk-styles";
import { PIN_LENGTH, type CredentialStage } from "./use-staff-punch";

const BOX = "relative flex h-21 items-center gap-3.5 rounded-[12px] bg-card px-5.5";
const ACTIVE = "border-[2.5px] border-chrome-primary";
const IDLE = "border-[1.5px] border-input";
const ERROR_ID = "kiosk-error";

/**
 * The six PIN dots over a real password input, so a keyboard types into it
 * while `inputMode="none"` keeps the iPad keyboard away. Shared by the
 * employee-number screen and the tapped-name PIN screen.
 */
export const KioskPinField = forwardRef<
  HTMLInputElement,
  { id: string; label: string; pin: string; onPin: (value: string) => void; active: boolean; error: string | null; describedBy?: string; onFocus?: () => void }
>(function KioskPinField({ id, label, pin, onPin, active, error, describedBy, onFocus }, ref) {
  return (
    <div className="flex flex-col gap-2.5">
      <label htmlFor={id} className="text-lg font-semibold text-foreground">
        {label}
      </label>
      <div className={cn(BOX, active ? ACTIVE : IDLE)}>
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span
            key={index}
            aria-hidden
            className={cn("size-5 rounded-full border-2 border-chrome-primary", index < pin.length ? "bg-chrome-primary" : "bg-transparent")}
          />
        ))}
        <input
          id={id}
          ref={ref}
          type="password"
          value={pin}
          onChange={(e) => onPin(e.target.value)}
          onFocus={onFocus}
          inputMode="none"
          pattern="[0-9]*"
          maxLength={PIN_LENGTH}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="absolute inset-0 h-full w-full cursor-pointer rounded-[12px] bg-transparent text-transparent caret-transparent focus:outline-none"
        />
      </div>
    </div>
  );
});

/**
 * Employee number, then PIN (`11`, `11b`): reached from "Use employee number"
 * under the name list. Both boxes are real inputs, so a USB badge reader or a
 * keyboard types into them; `inputMode="none"` keeps the iPad keyboard away
 * and the kiosk keypad does the typing.
 */
export function StaffCredentials({
  stage,
  onStage,
  identifier,
  onIdentifier,
  pin,
  onPin,
  error,
  busy,
  onSubmit,
  onBackToNames,
}: {
  stage: CredentialStage;
  onStage: (stage: CredentialStage) => void;
  identifier: string;
  onIdentifier: (value: string) => void;
  pin: string;
  onPin: (value: string) => void;
  error: string | null;
  busy: boolean;
  onSubmit: () => void;
  onBackToNames: () => void;
}) {
  const numberRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);

  // A cleared form (error, start over) puts the cursor back in the number box.
  useEffect(() => {
    if (stage === "number" && !identifier) numberRef.current?.focus();
  }, [stage, identifier]);

  const toPin = () => {
    if (!identifier.trim()) return;
    onStage("pin");
    pinRef.current?.focus();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (stage === "number") return toPin();
    if (pin.length === PIN_LENGTH) onSubmit();
  };

  const digit = (value: string) => {
    if (stage === "number") onIdentifier(identifier + value);
    else if (pin.length < PIN_LENGTH) onPin(pin + value);
  };

  const describedBy = error ? ERROR_ID : undefined;
  const ready = stage === "pin" && pin.length === PIN_LENGTH;

  return (
    <form onSubmit={submit} aria-label="Clock in or out" className="flex flex-1 flex-col items-center justify-center gap-10 px-10 py-8 min-[1000px]:flex-row min-[1000px]:gap-22">
      <div className="flex w-105 max-w-full flex-col gap-6.5">
        <div className="flex flex-col gap-2.5">
          <label htmlFor="kiosk-identifier" className="text-lg font-semibold text-foreground">
            {KIOSK_STAFF_COPY.numberLabel}
          </label>
          <div className={cn(BOX, stage === "number" ? ACTIVE : IDLE)}>
            <input
              id="kiosk-identifier"
              ref={numberRef}
              value={identifier}
              onChange={(e) => onIdentifier(e.target.value)}
              onFocus={() => onStage("number")}
              inputMode="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              className="h-full w-full bg-transparent text-[34px] font-medium tracking-[0.12em] text-foreground tabular-nums focus:outline-none"
            />
          </div>
        </div>
        <KioskPinField
          ref={pinRef}
          id="kiosk-pin"
          label={KIOSK_STAFF_COPY.pinLabel}
          pin={pin}
          onPin={onPin}
          active={stage === "pin"}
          error={error}
          describedBy={describedBy}
          onFocus={() => onStage("pin")}
        />
        <p className="text-base text-muted-foreground">{stage === "number" ? KIOSK_STAFF_COPY.numberHelper : KIOSK_STAFF_COPY.pinHelper}</p>
        <p id={ERROR_ID} role="status" className="text-base font-semibold text-destructive empty:hidden">
          {error ?? ""}
        </p>
        {ready ? (
          <button type="submit" className={cn(KIOSK_PRIMARY, "h-18")} disabled={busy}>
            {KIOSK_STAFF_COPY.continue}
          </button>
        ) : null}
        <button type="button" onClick={onBackToNames} className={cn("inline-flex min-h-12 items-center self-start rounded-[8px] text-[17px] font-medium text-foreground underline underline-offset-4", KIOSK_FOCUS)}>
          {KIOSK_STAFF_COPY.backToNames}
        </button>
      </div>
      <KioskKeypad
        label="Number pad"
        onDigit={digit}
        left={{ label: "Clear", tone: "quiet", onPress: () => (stage === "number" ? onIdentifier("") : onPin("")) }}
        right={
          stage === "number"
            ? { label: KIOSK_STAFF_COPY.next, tone: "primary", onPress: toPin, disabled: !identifier.trim() }
            : { label: "Delete", tone: "quiet", onPress: () => onPin(pin.slice(0, -1)) }
        }
      />
    </form>
  );
}
