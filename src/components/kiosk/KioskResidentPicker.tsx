"use client";

import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  KIOSK_RESIDENT_COPY,
  KIOSK_RESIDENT_MIN_LETTERS,
  KIOSK_VISITOR_RESIDENTS_ENDPOINT,
  kioskResidentPickedLabel,
  kioskRoomLabel,
  type KioskResidentMatch,
} from "@/lib/kiosk/contract";
import { KIOSK_SIGN_IN_COPY } from "@/lib/kiosk/screens";
import { cn } from "@/lib/utils";

import { KioskField } from "./KioskField";
import { KIOSK_FOCUS, KIOSK_PRESS } from "./kiosk-styles";
import { useKioskPrefixSearch } from "./use-kiosk-prefix-search";

export type KioskResidentValue =
  | { mode: "search"; query: string }
  | { mode: "picked"; match: KioskResidentMatch }
  | { mode: "typed"; name: string };

export const KIOSK_RESIDENT_EMPTY: KioskResidentValue = { mode: "search", query: "" };

const INPUT = cn(
  "h-15 w-full rounded-[10px] border-[1.5px] border-input bg-card pl-13 pr-4.5 text-xl text-foreground placeholder:text-muted-foreground",
  "focus:border-chrome-primary focus:outline-none focus-visible:ring-4 focus-visible:ring-ring/40",
  "aria-[invalid=true]:border-destructive",
);
const LINK = cn("inline-flex min-h-12 items-center self-start rounded-[8px] text-[17px] font-medium text-foreground underline underline-offset-4", KIOSK_FOCUS);

/**
 * "Resident you are seeing" (spec 40 §7): three letters, then at most six
 * current residents of this building as first name, last initial and room.
 * A tap locks the field to that resident; "Not listed?" swaps in a plain
 * text box whose name the front desk confirms later. Nothing is asked of the
 * server before three letters, so the tablet never shows the census.
 */
export function KioskResidentPicker({
  id,
  label,
  placeholder,
  required,
  markRequired,
  value,
  onChange,
  error,
  debounceMs,
}: {
  id: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  markRequired?: boolean;
  value: KioskResidentValue;
  onChange: (next: KioskResidentValue) => void;
  error?: string;
  debounceMs?: number;
}) {
  const query = value.mode === "search" ? value.query : "";
  const search = useKioskPrefixSearch<KioskResidentMatch>({
    query,
    endpoint: KIOSK_VISITOR_RESIDENTS_ENDPOINT,
    minLetters: KIOSK_RESIDENT_MIN_LETTERS,
    enabled: value.mode === "search",
    debounceMs,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const [focusNext, setFocusNext] = useState<"input" | "change" | null>(null);

  useEffect(() => {
    if (focusNext === "input") inputRef.current?.focus();
    if (focusNext === "change") changeRef.current?.focus();
    if (focusNext) setFocusNext(null);
  }, [focusNext, value.mode]);

  const statusId = `${id}-status`;
  const errorId = error ? `${id}-error` : undefined;
  const labelNode = (
    <>
      {label}
      {markRequired ? <span className="font-normal text-muted-foreground"> {KIOSK_SIGN_IN_COPY.required}</span> : null}
    </>
  );
  const errorLine = error ? (
    <p id={errorId} className="text-sm font-semibold text-destructive">
      {error}
    </p>
  ) : null;

  if (value.mode === "typed") {
    return (
      <div className="flex flex-col gap-2">
        <KioskField
          ref={inputRef}
          id={id}
          data-field="visiting_name"
          label={label}
          required={required}
          markRequired={markRequired}
          hint={KIOSK_RESIDENT_COPY.typedHint}
          error={error}
          value={value.name}
          autoCapitalize="words"
          maxLength={120}
          onChange={(event) => onChange({ mode: "typed", name: event.target.value })}
        />
        <button
          type="button"
          className={LINK}
          onClick={() => {
            onChange(KIOSK_RESIDENT_EMPTY);
            setFocusNext("input");
          }}
        >
          {KIOSK_RESIDENT_COPY.backToList}
        </button>
      </div>
    );
  }

  if (value.mode === "picked") {
    return (
      <div className="flex flex-col gap-2">
        <p id={`${id}-label`} className="text-[17px] font-semibold text-foreground">
          {labelNode}
        </p>
        <div
          role="group"
          aria-labelledby={`${id}-label`}
          data-field="visiting_name"
          tabIndex={-1}
          className="flex h-15 items-center justify-between gap-4 rounded-[10px] border-[2.5px] border-chrome-primary bg-card pl-4.5 pr-1.5"
        >
          <span className="truncate text-xl font-semibold text-foreground">{kioskResidentPickedLabel(value.match)}</span>
          <button
            ref={changeRef}
            type="button"
            className={cn("inline-flex h-12 shrink-0 items-center rounded-[8px] px-4.5 text-[17px] font-semibold text-foreground underline underline-offset-4 hover:bg-muted", KIOSK_FOCUS)}
            onClick={() => {
              onChange(KIOSK_RESIDENT_EMPTY);
              setFocusNext("input");
            }}
          >
            {KIOSK_RESIDENT_COPY.change}
          </button>
        </div>
        {errorLine}
      </div>
    );
  }

  const listId = `${id}-list`;
  const populated = search.state === "success-populated";
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[17px] font-semibold text-foreground">
        {labelNode}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4.5 top-7.5 size-5.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          id={id}
          data-field="visiting_name"
          value={query}
          onChange={(event) => onChange({ mode: "search", query: event.target.value.slice(0, 60) })}
          placeholder={placeholder}
          required={required}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="words"
          spellCheck={false}
          enterKeyHint="search"
          aria-invalid={error ? true : undefined}
          aria-describedby={[statusId, errorId].filter(Boolean).join(" ")}
          aria-controls={populated ? listId : undefined}
          className={INPUT}
        />
        {populated ? (
          <ul id={listId} aria-label={KIOSK_RESIDENT_COPY.listLabel} className="mt-2 flex flex-col overflow-hidden rounded-[12px] border-[1.5px] border-border bg-card">
            {search.matches.map((match) => {
              const room = kioskRoomLabel(match.room);
              return (
                <li key={match.resident_id} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ mode: "picked", match });
                      setFocusNext("change");
                    }}
                    className={cn("flex min-h-14 w-full items-center justify-between gap-4 px-4.5 py-3 text-left hover:bg-muted/40", KIOSK_FOCUS, KIOSK_PRESS)}
                  >
                    <span className="truncate text-xl text-foreground">{match.display_name}</span>
                    {room ? <span className="shrink-0 text-[17px] text-muted-foreground tabular-nums">{room}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      <div id={statusId} role="status" className="text-base empty:hidden">
        {search.state === "loading" ? <p className="text-muted-foreground">{KIOSK_RESIDENT_COPY.searching}</p> : null}
        {search.state === "success-empty" ? <p className="text-muted-foreground">{KIOSK_RESIDENT_COPY.noMatch}</p> : null}
        {search.state === "error" ? <p className="font-semibold text-destructive">{search.message}</p> : null}
      </div>
      {errorLine}
      <button
        type="button"
        className={LINK}
        onClick={() => {
          onChange({ mode: "typed", name: query.trim() });
          setFocusNext("input");
        }}
      >
        {KIOSK_RESIDENT_COPY.notListed}
      </button>
    </div>
  );
}
