"use client";

/**
 * The staff punch flow behind `/kiosk/staff` (COL-352 spec 37 §5, kept for
 * COL-692): tap your name (or type an employee number), enter the PIN, see
 * only the valid next actions, record the punch, and when the network or
 * Haven is down save it on this tablet. The PIN never leaves page memory, on
 * either path. The employee-number path never says which half was wrong; the
 * name path may say how many tries are left, because the person is already
 * named on screen.
 */

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { KIOSK_STAFF_COPY, kioskRandomId, kioskWrongPinCopy } from "@/lib/kiosk/screens";
import {
  KIOSK_COPY,
  KIOSK_IDENTIFY_ENDPOINT,
  KIOSK_PUNCH_ENDPOINT,
  PUNCH_TYPES,
  type KioskErrorCode,
  type KioskIdentifyResponse,
  type KioskPunchReceipt,
  type KioskPunchRequest,
  type KioskRosterEntry,
  type PunchType,
} from "@/lib/timeclock/kiosk-contract";
import { pinMemory } from "@/lib/timeclock/kiosk-store";

import { kioskRequestInit, useKiosk } from "./kiosk-context";

export const PIN_LENGTH = 6;
const IDENTIFIER_MAX = 64;

/** `roster`: tap your name (the default). `pin`: that person's PIN. `number`: the employee-number screen. */
export type StaffPhase = "roster" | "pin" | "number" | "choose" | "confirm";
export type CredentialStage = "number" | "pin";

export type StaffConfirmation = {
  firstName: string | null;
  /** "Ashley W." when the database sends it. */
  displayName: string | null;
  punchType: PunchType;
  punchedAt: string;
  todayWorkedMinutes: number | null;
  offline: boolean;
};

const OFFLINE_IDENTIFIED: KioskIdentifyResponse = { first_name: "", state: "out", next_actions: [...PUNCH_TYPES], today_worked_minutes: 0 };

type Failure = { code: KioskErrorCode; triesLeft: number | null };

function readFailure(body: unknown, status: number): Failure {
  const record = body && typeof body === "object" ? (body as { error?: unknown; tries_left?: unknown }) : {};
  const code: KioskErrorCode =
    typeof record.error === "string" && record.error in KIOSK_COPY.errors ? (record.error as KioskErrorCode) : status >= 500 ? "unavailable" : "not_recognized";
  const triesLeft = typeof record.tries_left === "number" ? record.tries_left : null;
  return { code, triesLeft };
}

/** Name-path words for a refused PIN (the employee-number path keeps KIOSK_COPY.errors). */
function namePathCopy({ code, triesLeft }: Failure): string {
  if (code === "not_recognized" && triesLeft !== null) return kioskWrongPinCopy(triesLeft);
  if (code === "locked") return KIOSK_STAFF_COPY.locked;
  if (code === "not_set_up") return KIOSK_STAFF_COPY.notSetUp;
  return KIOSK_COPY.errors[code];
}

export function useStaffPunch(options: { newClientPunchId?: () => string; onThrottled?: () => void } = {}) {
  const router = useRouter();
  const { device, fetchImpl, now, online, markOffline, forgetDevice, refreshPending, store } = useKiosk();
  const newClientPunchId = options.newClientPunchId ?? kioskRandomId;
  const onThrottled = options.onThrottled;

  const [phase, setPhase] = useState<StaffPhase>("roster");
  const [stage, setStage] = useState<CredentialStage>("number");
  const [picked, setPicked] = useState<KioskRosterEntry | null>(null);
  const [identifier, setIdentifierState] = useState("");
  const [pin, setPinState] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [identified, setIdentified] = useState<KioskIdentifyResponse | null>(null);
  const [confirmation, setConfirmation] = useState<StaffConfirmation | null>(null);

  const setIdentifier = useCallback((value: string) => {
    setError(null);
    setIdentifierState(value.slice(0, IDENTIFIER_MAX));
  }, []);
  const setPin = useCallback((value: string) => {
    setError(null);
    setPinState(value.replace(/\D/g, "").slice(0, PIN_LENGTH));
  }, []);

  const clearCredentials = useCallback(() => {
    setIdentifierState("");
    setPinState("");
    setIdentified(null);
    setStage("number");
  }, []);

  /** Back to the name list, everything typed cleared. */
  const startOver = useCallback(() => {
    clearCredentials();
    setPicked(null);
    setError(null);
    setConfirmation(null);
    setPhase("roster");
  }, [clearCredentials]);

  const pickName = useCallback(
    (entry: KioskRosterEntry) => {
      clearCredentials();
      setError(null);
      setPicked(entry);
      setPhase("pin");
    },
    [clearCredentials],
  );

  const chooseEmployeeNumber = useCallback(() => {
    clearCredentials();
    setPicked(null);
    setError(null);
    setPhase("number");
  }, [clearCredentials]);

  const fail = useCallback(
    (failure: Failure) => {
      if (failure.code === "device_throttled" && picked) {
        // The name list says until when, and holds the tiles until then.
        startOver();
        onThrottled?.();
        return;
      }
      setError(picked ? namePathCopy(failure) : KIOSK_COPY.errors[failure.code]);
      setPinState("");
      setIdentified(null);
      if (picked) {
        setPhase("pin");
      } else {
        clearCredentials();
        setPhase("number");
      }
    },
    [picked, startOver, onThrottled, clearCredentials],
  );

  const dropDevice = useCallback(async () => {
    await forgetDevice();
    router.replace("/kiosk/setup");
  }, [forgetDevice, router]);

  const chooseOffline = useCallback(() => {
    setIdentified(OFFLINE_IDENTIFIED);
    setPhase("choose");
  }, []);

  /** The subject of a request: the tapped name, else the typed employee number. */
  const subject = useCallback((): Pick<KioskPunchRequest, "identifier" | "staff_id"> => (picked ? { staff_id: picked.staff_id } : { identifier: identifier.trim() }), [picked, identifier]);

  const identify = useCallback(async () => {
    if (!device || busy) return;
    if ((!picked && !identifier.trim()) || pin.length !== PIN_LENGTH) {
      setError(picked ? KIOSK_STAFF_COPY.pinNameHelper : KIOSK_COPY.errors.not_recognized);
      return;
    }
    setError(null);
    // Offline: the server validates at sync. Offer every action.
    if (!online) return chooseOffline();
    setBusy(true);
    try {
      const response = await fetchImpl(KIOSK_IDENTIFY_ENDPOINT, kioskRequestInit(device.token, { method: "POST", json: { ...subject(), pin } }));
      const body = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        const failure = readFailure(body, response.status);
        if (failure.code === "unavailable") return chooseOffline();
        if (failure.code === "device_unknown") return void (await dropDevice());
        return fail(failure);
      }
      setIdentified(body as KioskIdentifyResponse);
      setPhase("choose");
    } catch {
      markOffline();
      chooseOffline();
    } finally {
      setBusy(false);
    }
  }, [device, busy, picked, identifier, pin, online, chooseOffline, fetchImpl, subject, dropDevice, fail, markOffline]);

  const queueOffline = useCallback(
    async (punchType: PunchType, clientPunchId: string, deviceTime: string) => {
      // Same handling on both paths: the PIN stays in page memory, never in IndexedDB.
      pinMemory.set(clientPunchId, pin);
      await store.enqueue({
        clientPunchId,
        identifier: picked ? "" : identifier.trim(),
        ...(picked ? { staffId: picked.staff_id } : {}),
        punchType,
        deviceTime,
        queuedAt: deviceTime,
      });
      await refreshPending();
      setConfirmation({ firstName: null, displayName: picked?.display_name ?? null, punchType, punchedAt: deviceTime, todayWorkedMinutes: null, offline: true });
      clearCredentials();
      setPicked(null);
      setPhase("confirm");
    },
    [pin, picked, identifier, store, refreshPending, clearCredentials],
  );

  const punch = useCallback(
    async (punchType: PunchType) => {
      if (!device || busy) return;
      const clientPunchId = newClientPunchId();
      const deviceTime = now().toISOString();
      setBusy(true);
      setError(null);
      try {
        if (!online) return await queueOffline(punchType, clientPunchId, deviceTime);
        const request: KioskPunchRequest = {
          ...subject(),
          pin,
          punch_type: punchType,
          device_time: deviceTime,
          client_punch_id: clientPunchId,
          captured_offline: false,
        };
        let response: Response;
        try {
          response = await fetchImpl(KIOSK_PUNCH_ENDPOINT, kioskRequestInit(device.token, { method: "POST", json: request }));
        } catch {
          markOffline();
          return await queueOffline(punchType, clientPunchId, deviceTime);
        }
        const body = (await response.json().catch(() => null)) as unknown;
        if (!response.ok) {
          const failure = readFailure(body, response.status);
          if (failure.code === "unavailable") return await queueOffline(punchType, clientPunchId, deviceTime);
          if (failure.code === "device_unknown") return void (await dropDevice());
          return fail(failure);
        }
        const receipt = body as KioskPunchReceipt;
        setConfirmation({
          firstName: receipt.first_name,
          displayName: receipt.display_name ?? null,
          punchType: receipt.punch_type,
          punchedAt: receipt.punched_at,
          todayWorkedMinutes: receipt.today_worked_minutes,
          offline: false,
        });
        clearCredentials();
        setPicked(null);
        setPhase("confirm");
      } finally {
        setBusy(false);
      }
    },
    [device, busy, newClientPunchId, now, online, queueOffline, subject, pin, fetchImpl, markOffline, dropDevice, fail, clearCredentials],
  );

  return {
    phase,
    stage,
    setStage,
    picked,
    pickName,
    chooseEmployeeNumber,
    identifier,
    setIdentifier,
    pin,
    setPin,
    busy,
    error,
    identified,
    confirmation,
    identify,
    punch,
    startOver,
    online,
  };
}
