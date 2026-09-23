"use client";

import { useEffect, useRef, type FormEvent } from "react";

import { KIOSK_STAFF_COPY } from "@/lib/kiosk/screens";
import { cn } from "@/lib/utils";

import { KioskKeypad } from "./KioskKeypad";
import { KIOSK_PRIMARY } from "./kiosk-styles";
import { PIN_LENGTH, type CredentialStage } from "./use-staff-punch";

const BOX = "relative flex h-21 items-center gap-3.5 rounded-[12px] bg-card px-5.5";
const ACTIVE = "border-[2.5px] border-chrome-primary";
const IDLE = "border-[1.5px] border-input";
const ERROR_ID = "kiosk-error";

/**
 * Employee number, then PIN (`11`, `11b`). Both boxes are real inputs, so a
 * USB badge reader or a keyboard types into them; `inputMode="none"` keeps the
 * iPad keyboard away and the kiosk keypad does the typing.
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
        <div className="flex flex-col gap-2.5">
          <label htmlFor="kiosk-pin" className="text-lg font-semibold text-foreground">
            {KIOSK_STAFF_COPY.pinLabel}
          </label>
          <div className={cn(BOX, stage === "pin" ? ACTIVE : IDLE)}>
            {Array.from({ length: PIN_LENGTH }, (_, index) => (
              <span
                key={index}
                aria-hidden
                className={cn("size-5 rounded-full border-2 border-chrome-primary", index < pin.length ? "bg-chrome-primary" : "bg-transparent")}
              />
            ))}
            <input
              id="kiosk-pin"
              ref={pinRef}
              type="password"
              value={pin}
              onChange={(e) => onPin(e.target.value)}
              onFocus={() => onStage("pin")}
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
        <p className="text-base text-muted-foreground">{stage === "number" ? KIOSK_STAFF_COPY.numberHelper : KIOSK_STAFF_COPY.pinHelper}</p>
        <p id={ERROR_ID} role="status" className="text-base font-semibold text-destructive empty:hidden">
          {error ?? ""}
        </p>
        {ready ? (
          <button type="submit" className={cn(KIOSK_PRIMARY, "h-18")} disabled={busy}>
            {KIOSK_STAFF_COPY.continue}
          </button>
        ) : null}
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
