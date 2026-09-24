"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { KIOSK_SETUP_ENDPOINT } from "@/lib/kiosk/contract";
import { KIOSK_SETUP_COPY } from "@/lib/kiosk/screens";
import { KIOSK_COPY, type KioskEnrollResponse, type KioskErrorCode } from "@/lib/timeclock/kiosk-contract";
import { cn } from "@/lib/utils";

import { KioskField } from "./KioskField";
import { KioskHeader } from "./KioskHeader";
import { useKiosk } from "./kiosk-context";
import { KIOSK_PRIMARY } from "./kiosk-styles";

function errorCopy(body: unknown, status: number): string {
  const code = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  if (typeof code === "string" && code in KIOSK_COPY.errors) return KIOSK_COPY.errors[code as KioskErrorCode];
  return status >= 500 ? KIOSK_COPY.errors.unavailable : KIOSK_COPY.errors.code_invalid;
}

/**
 * `/kiosk/setup`: an administrator types the one time code for a kiosk-kind
 * device and a tablet name; the token goes to IndexedDB and the tablet opens
 * the kiosk home. A floor code is refused here (code_invalid) and stays unused.
 */
export function KioskSetup() {
  const router = useRouter();
  const { device, fetchImpl, now, setDevice } = useKiosk();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (code.length !== 8 || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetchImpl(KIOSK_SETUP_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, label: name.trim() }),
        credentials: "omit",
      });
      const body = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        setError(errorCopy(body, response.status));
        setCode("");
        return;
      }
      const enrolled = body as KioskEnrollResponse;
      await setDevice({ token: enrolled.token, facilityId: enrolled.facility_id, facilityName: enrolled.facility_name, enrolledAt: now().toISOString() });
      router.replace("/kiosk");
    } catch {
      setError(KIOSK_COPY.errors.unavailable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <KioskHeader title={KIOSK_SETUP_COPY.title} back={device !== null} />
      <form onSubmit={submit} className="mx-auto flex w-full max-w-140 flex-1 flex-col justify-center gap-6 px-8 py-10" noValidate>
        <p className="text-[19px] text-muted-foreground">{KIOSK_SETUP_COPY.hint}</p>
        <KioskField
          id="kiosk-setup-code"
          label={KIOSK_SETUP_COPY.codeLabel}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={8}
          error={error ?? undefined}
        />
        <KioskField
          id="kiosk-setup-name"
          label={KIOSK_SETUP_COPY.nameLabel}
          required
          placeholder={KIOSK_SETUP_COPY.namePlaceholder}
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 60))}
        />
        <p role="status" className="sr-only">
          {error ?? ""}
        </p>
        <button type="submit" className={cn(KIOSK_PRIMARY, "h-18")} disabled={busy || code.length !== 8 || !name.trim()}>
          {KIOSK_SETUP_COPY.submit}
        </button>
      </form>
    </main>
  );
}
