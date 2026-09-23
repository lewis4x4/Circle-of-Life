"use client";

/**
 * Timeclock kiosk (COL-352, spec 37 §5). Tier 1 only: one identifier, one
 * PIN, one large button. No user session, no manager capability. Light theme,
 * 56 px targets, labelled inputs, errors announced via aria-describedby.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  KIOSK_COPY,
  KIOSK_DEVICE_HEADER,
  KIOSK_ENROLL_ENDPOINT,
  KIOSK_IDENTIFY_ENDPOINT,
  KIOSK_PUNCH_ENDPOINT,
  PUNCH_TYPES,
  formatKioskTime,
  formatWorkedMinutes,
  type KioskEnrollResponse,
  type KioskErrorCode,
  type KioskIdentifyResponse,
  type KioskPunchReceipt,
  type KioskPunchRequest,
  type PunchType,
} from "@/lib/timeclock/kiosk-contract";
import { pinMemory, replayKioskQueue, resolveKioskStore, type KioskDevice, type KioskStore } from "@/lib/timeclock/kiosk-store";

export const KIOSK_CONFIRM_MS = 5000;
export const KIOSK_IDLE_MS = 30000;

type Phase = "loading" | "enroll" | "identify" | "choose" | "confirm";

type Confirmation = {
  firstName: string | null;
  punchType: PunchType;
  punchedAt: string;
  todayWorkedMinutes: number | null;
  offline: boolean;
};

export type TimeclockKioskProps = {
  store?: KioskStore;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeZone?: string;
  /** Test hook: override the online signal instead of navigator.onLine. */
  online?: boolean;
  confirmMs?: number;
  idleMs?: number;
  newClientPunchId?: () => string;
};

const BUTTON_BASE =
  "inline-flex min-h-[56px] items-center justify-center rounded-[var(--radius)] px-6 text-lg font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/50 disabled:opacity-40 disabled:pointer-events-none";
const PRIMARY = `${BUTTON_BASE} bg-foreground text-background hover:bg-foreground/90`;
const SECONDARY = `${BUTTON_BASE} border border-border bg-card text-foreground hover:bg-muted`;
const KEY = "min-h-[56px] min-w-[56px] rounded-[var(--radius)] border border-border bg-card text-2xl font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/50 motion-reduce:transition-none";
const INPUT =
  "mt-2 w-full min-h-[56px] rounded-[var(--radius)] border border-input bg-card px-4 text-2xl text-foreground focus:outline-none focus:ring-4 focus:ring-ring/40 aria-[invalid=true]:border-destructive";

function errorCodeFromResponse(body: unknown, status: number): KioskErrorCode {
  const code = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  if (typeof code === "string" && code in KIOSK_COPY.errors) return code as KioskErrorCode;
  return status >= 500 ? "unavailable" : "not_recognized";
}

function randomClientPunchId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export function TimeclockKiosk(props: TimeclockKioskProps) {
  const store = useMemo(() => resolveKioskStore(props.store), [props.store]);
  const propsFetch = props.fetchImpl;
  const propsNow = props.now;
  const fetchImpl = useMemo<typeof fetch>(() => propsFetch ?? ((input, init) => fetch(input, init)), [propsFetch]);
  const now = useMemo<() => Date>(() => propsNow ?? (() => new Date()), [propsNow]);
  const timeZone = props.timeZone ?? "America/New_York";
  const confirmMs = props.confirmMs ?? KIOSK_CONFIRM_MS;
  const idleMs = props.idleMs ?? KIOSK_IDLE_MS;
  const newClientPunchId = props.newClientPunchId ?? randomClientPunchId;

  const [phase, setPhase] = useState<Phase>("loading");
  const [device, setDevice] = useState<KioskDevice | null>(null);
  // Both start from values the server can also produce; the browser's real
  // clock and network state arrive after mount. Reading them during render made
  // the server and client HTML differ (React error 418, COL-659).
  const [online, setOnline] = useState<boolean>(props.online ?? true);
  const [clock, setClock] = useState<Date | null>(null);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [identified, setIdentified] = useState<KioskIdentifyResponse | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const identifierRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);
  const idleTimer = useRef<number | null>(null);

  const refreshPending = useCallback(async () => {
    setPendingCount((await store.listQueue()).length);
  }, [store]);

  const replay = useCallback(async () => {
    await replayKioskQueue({ store, fetchImpl, now });
    await refreshPending();
  }, [store, fetchImpl, now, refreshPending]);

  // Boot: device token decides enrollment vs punch screen.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const existing = await store.getDevice();
      if (cancelled) return;
      setDevice(existing);
      setPhase(existing ? "identify" : "enroll");
      await refreshPending();
      if (existing && online) void replay();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  useEffect(() => {
    if (props.online !== undefined) {
      setOnline(props.online);
      return;
    }
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [props.online]);

  useEffect(() => {
    if (online && device) void replay();
  }, [online, device, replay]);

  useEffect(() => {
    setClock(now());
    const id = window.setInterval(() => setClock(now()), 1000);
    return () => window.clearInterval(id);
  }, [now]);

  const resetInputs = useCallback(() => {
    setIdentifier("");
    setPin("");
    setIdentified(null);
    setBusy(false);
  }, []);

  const backToIdentify = useCallback(() => {
    resetInputs();
    setConfirmation(null);
    setPhase("identify");
    window.setTimeout(() => identifierRef.current?.focus(), 0);
  }, [resetInputs]);

  // Idle: clear anything typed after 30 seconds without input.
  const touch = useCallback(() => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      if (phase === "identify" || phase === "choose") {
        setError(null);
        backToIdentify();
      }
    }, idleMs);
  }, [phase, idleMs, backToIdentify]);

  useEffect(() => () => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
  }, []);

  useEffect(() => {
    if (phase !== "confirm") return;
    const id = window.setTimeout(backToIdentify, confirmMs);
    return () => window.clearTimeout(id);
  }, [phase, confirmMs, backToIdentify]);

  const fail = useCallback(
    (codeOrMessage: KioskErrorCode) => {
      setError(KIOSK_COPY.errors[codeOrMessage]);
      resetInputs();
      window.setTimeout(() => identifierRef.current?.focus(), 0);
    },
    [resetInputs],
  );

  const enroll = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetchImpl(KIOSK_ENROLL_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim().toUpperCase(), label: label.trim() || "Timeclock tablet" }),
        credentials: "omit",
      });
      const body = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        setError(KIOSK_COPY.errors[errorCodeFromResponse(body, response.status)]);
        setCode("");
        return;
      }
      const enrolled = body as KioskEnrollResponse;
      const record: KioskDevice = {
        token: enrolled.token,
        facilityId: enrolled.facility_id,
        facilityName: enrolled.facility_name,
        enrolledAt: now().toISOString(),
      };
      await store.setDevice(record);
      setDevice(record);
      setCode("");
      setLabel("");
      setPhase("identify");
    } catch {
      setError(KIOSK_COPY.errors.unavailable);
    } finally {
      setBusy(false);
    }
  };

  const identify = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!device) return;
    if (!identifier.trim() || pin.length !== 6) {
      setError(KIOSK_COPY.errors.not_recognized);
      return;
    }
    setError(null);
    if (!online) {
      // Offline: the server validates at sync. Offer every action.
      setIdentified({ first_name: "", state: "out", next_actions: [...PUNCH_TYPES], today_worked_minutes: 0 });
      setPhase("choose");
      touch();
      return;
    }
    setBusy(true);
    try {
      const response = await fetchImpl(KIOSK_IDENTIFY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", [KIOSK_DEVICE_HEADER]: device.token },
        body: JSON.stringify({ identifier: identifier.trim(), pin }),
        credentials: "omit",
      });
      const body = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        const codeFromServer = errorCodeFromResponse(body, response.status);
        if (codeFromServer === "unavailable") {
          setIdentified({ first_name: "", state: "out", next_actions: [...PUNCH_TYPES], today_worked_minutes: 0 });
          setPhase("choose");
          touch();
          return;
        }
        if (codeFromServer === "device_unknown") {
          await store.clearDevice();
          setDevice(null);
          setPhase("enroll");
        }
        fail(codeFromServer);
        return;
      }
      setIdentified(body as KioskIdentifyResponse);
      setPhase("choose");
      touch();
    } catch {
      // Network failure: treat as offline for this punch.
      setOnline(false);
      setIdentified({ first_name: "", state: "out", next_actions: [...PUNCH_TYPES], today_worked_minutes: 0 });
      setPhase("choose");
      touch();
    } finally {
      setBusy(false);
    }
  };

  const queueOffline = async (punchType: PunchType, clientPunchId: string, deviceTime: string) => {
    pinMemory.set(clientPunchId, pin);
    await store.enqueue({ clientPunchId, identifier: identifier.trim(), punchType, deviceTime, queuedAt: deviceTime });
    await refreshPending();
    setConfirmation({ firstName: null, punchType, punchedAt: deviceTime, todayWorkedMinutes: null, offline: true });
    resetInputs();
    setPhase("confirm");
  };

  const punch = async (punchType: PunchType) => {
    if (!device || busy) return;
    const clientPunchId = newClientPunchId();
    const deviceTime = now().toISOString();
    setBusy(true);
    setError(null);
    if (!online) {
      await queueOffline(punchType, clientPunchId, deviceTime);
      return;
    }
    const body: KioskPunchRequest = {
      identifier: identifier.trim(),
      pin,
      punch_type: punchType,
      device_time: deviceTime,
      client_punch_id: clientPunchId,
      captured_offline: false,
    };
    try {
      const response = await fetchImpl(KIOSK_PUNCH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", [KIOSK_DEVICE_HEADER]: device.token },
        body: JSON.stringify(body),
        credentials: "omit",
      });
      const json = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        const codeFromServer = errorCodeFromResponse(json, response.status);
        if (codeFromServer === "unavailable") {
          await queueOffline(punchType, clientPunchId, deviceTime);
          return;
        }
        if (codeFromServer === "device_unknown") {
          await store.clearDevice();
          setDevice(null);
          setPhase("enroll");
        } else {
          setPhase("identify");
        }
        fail(codeFromServer);
        return;
      }
      const receipt = json as KioskPunchReceipt;
      setConfirmation({
        firstName: receipt.first_name,
        punchType: receipt.punch_type,
        punchedAt: receipt.punched_at,
        todayWorkedMinutes: receipt.today_worked_minutes,
        offline: false,
      });
      resetInputs();
      setPhase("confirm");
    } catch {
      setOnline(false);
      await queueOffline(punchType, clientPunchId, deviceTime);
    } finally {
      setBusy(false);
    }
  };

  const facilityName = device?.facilityName ?? "";
  const clockText = clock ? formatKioskTime(clock, timeZone) : "\u00a0";
  const dateText = clock
    ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone }).format(clock)
    : "\u00a0";

  const keypad = (value: string) => {
    touch();
    setError(null);
    if (value === "backspace") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    setPin((p) => (p.length >= 6 ? p : p + value));
  };

  return (
    <main className="min-h-screen bg-background text-foreground" aria-live="polite">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-8">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Haven timeclock</p>
            <h1 className="mt-1 text-2xl font-semibold">{facilityName || "Timeclock"}</h1>
          </div>
          <div className="text-right" aria-label="Current time">
            <p className="font-mono text-4xl font-semibold tabular-nums" data-testid="kiosk-clock">
              {clockText}
            </p>
            <p className="text-sm text-muted-foreground">{dateText}</p>
          </div>
        </header>

        {!online ? (
          <p role="status" className="mt-4 rounded-[var(--radius)] border border-warning/40 bg-warning/10 px-4 py-3 text-base">
            {KIOSK_COPY.offlineBanner}
            {pendingCount > 0 ? ` ${pendingCount} waiting.` : ""}
          </p>
        ) : pendingCount > 0 ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            {pendingCount} saved punch{pendingCount === 1 ? "" : "es"} sending.
          </p>
        ) : null}

        {error ? (
          <p id="kiosk-error" role="alert" className="mt-4 rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 px-4 py-3 text-lg font-medium">
            {error}
          </p>
        ) : null}

        <section className="mt-8 flex-1">
          {phase === "loading" ? <p className="text-muted-foreground">Starting…</p> : null}

          {phase === "enroll" ? (
            <form onSubmit={enroll} className="max-w-md space-y-5" aria-labelledby="enroll-heading">
              <h2 id="enroll-heading" className="text-xl font-semibold">
                {KIOSK_COPY.enrollHeading}
              </h2>
              <p className="text-base text-muted-foreground">{KIOSK_COPY.enrollHint}</p>
              <div>
                <label htmlFor="kiosk-code" className="text-base font-medium">
                  {KIOSK_COPY.enrollCodeLabel}
                </label>
                <input
                  id="kiosk-code"
                  className={`${INPUT} font-mono uppercase tracking-widest`}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
                  autoComplete="off"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="text"
                  maxLength={8}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "kiosk-error" : undefined}
                  required
                />
              </div>
              <div>
                <label htmlFor="kiosk-label" className="text-base font-medium">
                  {KIOSK_COPY.enrollLabelLabel}
                </label>
                <input id="kiosk-label" className={INPUT} value={label} onChange={(e) => setLabel(e.target.value.slice(0, 60))} autoComplete="off" />
              </div>
              <button type="submit" className={PRIMARY} disabled={busy || code.length !== 8}>
                {KIOSK_COPY.enrollButton}
              </button>
            </form>
          ) : null}

          {phase === "identify" ? (
            <form onSubmit={identify} className="grid gap-8 md:grid-cols-[1fr_auto]" aria-label="Clock in or out">
              <div className="space-y-6">
                <div>
                  <label htmlFor="kiosk-identifier" className="text-base font-medium">
                    {KIOSK_COPY.identifierLabel}
                  </label>
                  <input
                    id="kiosk-identifier"
                    ref={identifierRef}
                    className={INPUT}
                    value={identifier}
                    onChange={(e) => {
                      touch();
                      setError(null);
                      setIdentifier(e.target.value.slice(0, 64));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        pinRef.current?.focus();
                      }
                    }}
                    autoFocus
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "kiosk-error" : undefined}
                  />
                </div>
                <div>
                  <label htmlFor="kiosk-pin" className="text-base font-medium">
                    {KIOSK_COPY.pinLabel}
                  </label>
                  <input
                    id="kiosk-pin"
                    ref={pinRef}
                    className={`${INPUT} tracking-[0.5em]`}
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => {
                      touch();
                      setError(null);
                      setPin(e.target.value.replace(/\D/g, "").slice(0, 6));
                    }}
                    autoComplete="off"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "kiosk-error" : undefined}
                  />
                </div>
                <button type="submit" className={PRIMARY} disabled={busy || !identifier.trim() || pin.length !== 6}>
                  {KIOSK_COPY.continueButton}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3 self-start" role="group" aria-label="PIN keypad">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                  <button key={digit} type="button" className={KEY} onClick={() => keypad(digit)} aria-label={`Digit ${digit}`}>
                    {digit}
                  </button>
                ))}
                <button type="button" className={KEY} onClick={() => keypad("backspace")} aria-label="Backspace">
                  ⌫
                </button>
                <button type="button" className={KEY} onClick={() => keypad("0")} aria-label="Digit 0">
                  0
                </button>
                <span aria-hidden="true" />
              </div>
            </form>
          ) : null}

          {phase === "choose" && identified ? (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold">{identified.first_name ? `Hello, ${identified.first_name}` : "Choose an action"}</h2>
              {!online ? <p className="text-base text-muted-foreground">Offline: choose what you are doing now. It is checked when the tablet reconnects.</p> : null}
              <div className="flex flex-wrap gap-4">
                {identified.next_actions.map((action, index) => (
                  <button
                    key={action}
                    type="button"
                    className={`${index === 0 ? PRIMARY : SECONDARY} min-h-[64px] min-w-[224px] text-2xl`}
                    onClick={() => void punch(action)}
                    disabled={busy}
                  >
                    {KIOSK_COPY.actionLabels[action]}
                  </button>
                ))}
              </div>
              <button type="button" className={SECONDARY} onClick={backToIdentify}>
                Cancel
              </button>
            </div>
          ) : null}

          {phase === "confirm" && confirmation ? (
            <div role="status" className="space-y-3 rounded-[var(--radius)] border border-border bg-card p-8">
              <p className="text-3xl font-semibold">
                {confirmation.offline
                  ? KIOSK_COPY.actionLabels[confirmation.punchType]
                  : `${KIOSK_COPY.confirmedLabels[confirmation.punchType]} ${formatKioskTime(confirmation.punchedAt, timeZone)}`}
              </p>
              {confirmation.firstName ? <p className="text-xl">{confirmation.firstName}</p> : null}
              {confirmation.offline ? (
                <p className="text-xl">{KIOSK_COPY.offlineSaved}</p>
              ) : confirmation.todayWorkedMinutes !== null ? (
                <p className="text-xl text-muted-foreground">{formatWorkedMinutes(confirmation.todayWorkedMinutes)} today</p>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
