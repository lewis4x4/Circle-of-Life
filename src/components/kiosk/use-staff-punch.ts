"use client";

/**
 * The staff punch flow behind `/kiosk/staff` (COL-352 spec 37 §5, kept as is
 * for COL-692): identify with employee number and PIN, offer only the valid
 * next actions, record the punch, and when the network or Haven is down save
 * it on this tablet. The PIN never leaves page memory; errors never say which
 * half was wrong.
 */

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { kioskRandomId } from "@/lib/kiosk/screens";
import {
  KIOSK_COPY,
  KIOSK_IDENTIFY_ENDPOINT,
  KIOSK_PUNCH_ENDPOINT,
  PUNCH_TYPES,
  type KioskErrorCode,
  type KioskIdentifyResponse,
  type KioskPunchReceipt,
  type KioskPunchRequest,
  type PunchType,
} from "@/lib/timeclock/kiosk-contract";
import { pinMemory } from "@/lib/timeclock/kiosk-store";

import { kioskRequestInit, useKiosk } from "./kiosk-context";

export const PIN_LENGTH = 6;
const IDENTIFIER_MAX = 64;

export type StaffPhase = "credentials" | "choose" | "confirm";
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

function errorCode(body: unknown, status: number): KioskErrorCode {
  const code = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  if (typeof code === "string" && code in KIOSK_COPY.errors) return code as KioskErrorCode;
  return status >= 500 ? "unavailable" : "not_recognized";
}

export function useStaffPunch(options: { newClientPunchId?: () => string } = {}) {
  const router = useRouter();
  const { device, fetchImpl, now, online, markOffline, forgetDevice, refreshPending, store } = useKiosk();
  const newClientPunchId = options.newClientPunchId ?? kioskRandomId;

  const [phase, setPhase] = useState<StaffPhase>("credentials");
  const [stage, setStage] = useState<CredentialStage>("number");
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

  const startOver = useCallback(() => {
    clearCredentials();
    setError(null);
    setConfirmation(null);
    setPhase("credentials");
  }, [clearCredentials]);

  const fail = useCallback(
    (code: KioskErrorCode) => {
      setError(KIOSK_COPY.errors[code]);
      clearCredentials();
      setPhase("credentials");
    },
    [clearCredentials],
  );

  const dropDevice = useCallback(async () => {
    await forgetDevice();
    router.replace("/kiosk/setup");
  }, [forgetDevice, router]);

  const chooseOffline = useCallback(() => {
    setIdentified(OFFLINE_IDENTIFIED);
    setPhase("choose");
  }, []);

  const identify = useCallback(async () => {
    if (!device || busy) return;
    if (!identifier.trim() || pin.length !== PIN_LENGTH) {
      setError(KIOSK_COPY.errors.not_recognized);
      return;
    }
    setError(null);
    // Offline: the server validates at sync. Offer every action.
    if (!online) return chooseOffline();
    setBusy(true);
    try {
      const response = await fetchImpl(KIOSK_IDENTIFY_ENDPOINT, kioskRequestInit(device.token, { method: "POST", json: { identifier: identifier.trim(), pin } }));
      const body = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        const code = errorCode(body, response.status);
        if (code === "unavailable") return chooseOffline();
        if (code === "device_unknown") return void (await dropDevice());
        return fail(code);
      }
      setIdentified(body as KioskIdentifyResponse);
      setPhase("choose");
    } catch {
      markOffline();
      chooseOffline();
    } finally {
      setBusy(false);
    }
  }, [device, busy, identifier, pin, online, chooseOffline, fetchImpl, dropDevice, fail, markOffline]);

  const queueOffline = useCallback(
    async (punchType: PunchType, clientPunchId: string, deviceTime: string) => {
      pinMemory.set(clientPunchId, pin);
      await store.enqueue({ clientPunchId, identifier: identifier.trim(), punchType, deviceTime, queuedAt: deviceTime });
      await refreshPending();
      setConfirmation({ firstName: null, displayName: null, punchType, punchedAt: deviceTime, todayWorkedMinutes: null, offline: true });
      clearCredentials();
      setPhase("confirm");
    },
    [pin, identifier, store, refreshPending, clearCredentials],
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
          identifier: identifier.trim(),
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
          const code = errorCode(body, response.status);
          if (code === "unavailable") return await queueOffline(punchType, clientPunchId, deviceTime);
          if (code === "device_unknown") return void (await dropDevice());
          return fail(code);
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
        setPhase("confirm");
      } finally {
        setBusy(false);
      }
    },
    [device, busy, newClientPunchId, now, online, queueOffline, identifier, pin, fetchImpl, markOffline, dropDevice, fail, clearCredentials],
  );

  return { phase, stage, setStage, identifier, setIdentifier, pin, setPin, busy, error, identified, confirmation, identify, punch, startOver, online };
}
