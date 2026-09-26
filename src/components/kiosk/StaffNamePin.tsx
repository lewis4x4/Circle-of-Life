"use client";

import { useEffect, useRef, type FormEvent } from "react";

import { KIOSK_STAFF_COPY } from "@/lib/kiosk/screens";
import type { KioskRosterEntry } from "@/lib/timeclock/kiosk-contract";
import { cn } from "@/lib/utils";

import { KioskKeypad } from "./KioskKeypad";
import { KIOSK_FOCUS, KIOSK_PRIMARY } from "./kiosk-styles";
import { KioskPinField } from "./StaffCredentials";
import { PIN_LENGTH } from "./use-staff-punch";

const ERROR_ID = "kiosk-name-pin-error";

/**
 * The PIN after a tapped name: the name large, "Not you?" back to the list,
 * then the same dots and keypad as the employee-number screen. Continue shows
 * once all six digits are in.
 */
export function StaffNamePin({
  person,
  pin,
  onPin,
  error,
  busy,
  onSubmit,
  onNotYou,
}: {
  person: KioskRosterEntry;
  pin: string;
  onPin: (value: string) => void;
  error: string | null;
  busy: boolean;
  onSubmit: () => void;
  onNotYou: () => void;
}) {
  const pinRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    pinRef.current?.focus();
  }, [person.staff_id]);

  const ready = pin.length === PIN_LENGTH;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready && !busy) onSubmit();
  };

  return (
    <form onSubmit={submit} aria-label="Enter your PIN" className="flex flex-1 flex-col items-center justify-center gap-10 px-10 py-8 min-[1000px]:flex-row min-[1000px]:gap-22">
      <div className="flex w-105 max-w-full flex-col gap-6.5">
        <div className="flex flex-col items-start gap-1">
          <h2 className="text-[44px] font-semibold leading-tight text-foreground">{person.display_name}</h2>
          <button type="button" onClick={onNotYou} className={cn("inline-flex min-h-12 items-center rounded-[8px] text-[17px] font-medium text-foreground underline underline-offset-4", KIOSK_FOCUS)}>
            {KIOSK_STAFF_COPY.notYouShort}
          </button>
        </div>
        <KioskPinField
          ref={pinRef}
          id="kiosk-name-pin"
          label={KIOSK_STAFF_COPY.pinLabel}
          pin={pin}
          onPin={onPin}
          active
          error={error}
          describedBy={error ? ERROR_ID : "kiosk-name-pin-helper"}
        />
        <p id="kiosk-name-pin-helper" className="text-base text-muted-foreground">
          {KIOSK_STAFF_COPY.pinNameHelper}
        </p>
        <p id={ERROR_ID} role="status" className="text-lg font-semibold text-destructive empty:hidden">
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
        onDigit={(digit) => {
          if (pin.length < PIN_LENGTH) onPin(pin + digit);
        }}
        left={{ label: "Clear", tone: "quiet", onPress: () => onPin("") }}
        right={{ label: "Delete", tone: "quiet", onPress: () => onPin(pin.slice(0, -1)) }}
      />
    </form>
  );
}
