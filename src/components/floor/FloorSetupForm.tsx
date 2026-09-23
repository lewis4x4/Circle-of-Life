"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { FLOOR_ENROLL_ENDPOINT, FLOOR_ERROR_COPY, FLOOR_LOCK_PATH, publicFloorErrorCode, type FloorEnrollResponse } from "@/lib/floor/contract";
import { resolveFloorDeviceStore, saveEnrolledFloorDevice, type FloorDevice } from "@/lib/floor/device-store";
import { cn } from "@/lib/utils";

import { FloorLockBar } from "./FloorLockChrome";
import { FloorStatePanel } from "./FloorStatePanel";
import { FLOOR_FOCUS_RING, FLOOR_OUTLINE_BUTTON, FLOOR_PRIMARY_BUTTON } from "./floor-styles";

const FIELD = cn("h-15 w-full rounded-[8px] border border-input bg-card px-4 text-xl text-foreground", FLOOR_FOCUS_RING);

/**
 * `/floor/setup`: the administrator enrolls this iPad as a floor tablet with a
 * one-time code from Timeclock devices and a tablet name. The token lands in
 * IndexedDB and the browser is asked to keep that storage.
 */
export function FloorSetupForm() {
  const router = useRouter();
  const codeId = useId();
  const labelId = useId();
  const [existing, setExisting] = useState<FloorDevice | null | undefined>(undefined);
  const [replacing, setReplacing] = useState(false);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    resolveFloorDeviceStore()
      .getDevice()
      .then((device) => {
        if (active) setExisting(device);
      })
      .catch(() => {
        if (active) setExisting(null);
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmedCode = code.trim().toUpperCase();
    const trimmedLabel = label.trim();
    if (!/^[A-Z0-9]{8}$/.test(trimmedCode)) return setError("The code is 8 letters and numbers.");
    if (!trimmedLabel) return setError("Give this tablet a name, for example HL-FLOOR-01.");
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(FLOOR_ENROLL_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmedCode, label: trimmedLabel }),
        credentials: "omit",
      });
      const body = (await response.json().catch(() => null)) as (FloorEnrollResponse & { error?: string }) | null;
      if (!response.ok || !body?.token) {
        setError(FLOOR_ERROR_COPY[publicFloorErrorCode(body?.error ?? "unavailable")]);
        setBusy(false);
        return;
      }
      await saveEnrolledFloorDevice({
        deviceId: body.device_id,
        token: body.token,
        facilityId: body.facility_id,
        facilityName: body.facility_name,
        deviceLabel: body.device_label,
        enrolledAt: new Date().toISOString(),
      });
      router.replace(FLOOR_LOCK_PATH);
    } catch {
      setError(FLOOR_ERROR_COPY.unavailable);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <FloorLockBar left={<span className="text-[15px] font-semibold">Floor tablet setup</span>} />
      <main className="flex flex-1 items-center justify-center px-6 py-10">
        {existing === undefined ? (
          <FloorStatePanel state="loading" title="Checking this tablet" />
        ) : existing && !replacing ? (
          <section className="flex w-full max-w-lg flex-col gap-4 rounded-[14px] border border-border bg-card p-8">
            <h1 className="text-2xl font-semibold">This tablet is set up</h1>
            <p className="text-base text-muted-foreground">
              {existing.deviceLabel} at {existing.facilityName}. Staff unlock it from the lock screen.
            </p>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => router.replace(FLOOR_LOCK_PATH)} className={cn(FLOOR_PRIMARY_BUTTON, "h-13 px-6 text-base")}>
                Go to the lock screen
              </button>
              <button type="button" onClick={() => setReplacing(true)} className={cn(FLOOR_OUTLINE_BUTTON, "h-13 px-6 text-base font-medium")}>
                Set it up again
              </button>
            </div>
          </section>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="flex w-full max-w-lg flex-col gap-5 rounded-[14px] border border-border bg-card p-8" noValidate>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold">Set up this floor tablet</h1>
              <p className="text-base text-muted-foreground">Make a floor tablet code in Timeclock devices, then type it here.</p>
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor={codeId} className="text-[17px] font-semibold">
                Setup code
              </label>
              <input
                id={codeId}
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, 8))}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className={cn(FIELD, "tabular-nums tracking-widest")}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor={labelId} className="text-[17px] font-semibold">
                Tablet name
              </label>
              <input id={labelId} value={label} onChange={(event) => setLabel(event.target.value.slice(0, 60))} autoComplete="off" placeholder="HL-FLOOR-01" className={FIELD} />
            </div>
            <p role="status" aria-live="polite" className={cn("text-[15px] font-medium text-destructive", !error && "sr-only")}>
              {error ?? ""}
            </p>
            <button type="submit" disabled={busy} className={cn(FLOOR_PRIMARY_BUTTON, "h-16 text-lg")}>
              {busy ? "Setting up" : "Set up tablet"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
