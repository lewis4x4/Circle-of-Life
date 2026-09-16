"use client";

/**
 * "Timeclock access" section on the staff profile (COL-352, spec 37 §6).
 * Managers set the employee number, register a badge by scanning into a
 * focused input, generate or reset a PIN shown once, and unlock. The badge
 * value and the PIN are sent to the server once and never displayed again.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DetailRow, RecordDetailSection } from "@/design-system/components/record-detail";
import { TIMECLOCK_ACCESS_REMOVED } from "@/lib/timeclock/display-copy";

export type TimeclockCredentialStatus = {
  staff_id: string;
  eligible: boolean;
  exists: boolean;
  employee_number: string | null;
  has_badge: boolean;
  locked_until: string | null;
  pin_set_at: string | null;
  badge_set_at: string | null;
};

export type StaffTimeclockAccessProps = {
  staffId: string;
  canEdit: boolean;
  className?: string;
  fetchImpl?: typeof fetch;
};

const ERROR_COPY: Record<string, string> = {
  employee_number_taken: "That employee number is already in use.",
  badge_taken: "That badge is already registered to someone else.",
  badge_secret_missing: "Badge registration is not configured on this server yet. Employee number and PIN still work.",
  credential_exists: "Timeclock access already exists for this person.",
  inactive_staff: "This person is not active, so timeclock access cannot be set.",
  invalid_input: "Check the employee number: letters, digits and dashes only, up to 20 characters.",
};

export function StaffTimeclockAccess({ staffId, canEdit, className, fetchImpl }: StaffTimeclockAccessProps) {
  const fetcher = fetchImpl ?? fetch;
  const [status, setStatus] = useState<TimeclockCredentialStatus | null>(null);
  const [badgeConfigured, setBadgeConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [badgeMode, setBadgeMode] = useState(false);
  const [badgeValue, setBadgeValue] = useState("");
  const [revealedPin, setRevealedPin] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const badgeRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetcher(`/api/admin/timeclock/credentials?staff_id=${staffId}`, { credentials: "same-origin" });
      const json = (await response.json().catch(() => null)) as { status?: TimeclockCredentialStatus; badge_secret_configured?: boolean; error?: string } | null;
      if (!response.ok || !json?.status) {
        setError(json?.error ?? "Could not load timeclock access");
        setStatus(null);
        return;
      }
      setStatus(json.status);
      setBadgeConfigured(json.badge_secret_configured !== false);
      setEmployeeNumber(json.status.employee_number ?? "");
    } catch {
      setError("Could not load timeclock access");
    } finally {
      setLoading(false);
    }
  }, [fetcher, staffId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (badgeMode) badgeRef.current?.focus();
  }, [badgeMode]);

  const post = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const response = await fetcher("/api/admin/timeclock/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ staff_id: staffId, ...payload }),
      });
      const json = (await response.json().catch(() => null)) as { status?: TimeclockCredentialStatus; pin?: string | null; error?: string } | null;
      if (!response.ok || !json?.status) {
        const code = json?.error ?? "";
        setError(ERROR_COPY[code] ?? code ?? "Could not update timeclock access");
        return;
      }
      setStatus(json.status);
      setEmployeeNumber(json.status.employee_number ?? "");
      if (json.pin) setRevealedPin(json.pin);
    } catch {
      setError("Could not update timeclock access");
    } finally {
      setBusy(false);
    }
  };

  const submitBadge = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = badgeValue.trim();
    setBadgeValue("");
    setBadgeMode(false);
    if (!value) return;
    await post({ action: "set_badge", badge: value });
  };

  const copyPin = async () => {
    if (!revealedPin) return;
    try {
      await navigator.clipboard.writeText(revealedPin);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const locked = status?.locked_until ? new Date(status.locked_until).getTime() > Date.now() : false;

  return (
    <RecordDetailSection title="Timeclock access" description="Kiosk sign-in: employee number or badge, plus a six digit PIN" className={className}>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : status && !status.eligible ? (
        <p className="text-sm text-muted-foreground" data-testid="timeclock-access-removed">
          {TIMECLOCK_ACCESS_REMOVED}
        </p>
      ) : (
        <div className="space-y-4">
          {error ? (
            <p role="alert" id="timeclock-access-error" className="rounded-[8px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
              {error}
            </p>
          ) : null}

          <DetailRow label="Employee number" value={status?.employee_number ?? "Not set"} />
          <DetailRow label="Badge" value={status?.has_badge ? "Registered" : "Not registered"} />
          <DetailRow label="PIN" value={status?.exists ? `Set ${status.pin_set_at ? new Date(status.pin_set_at).toLocaleDateString("en-US") : ""}`.trim() : "Not set"} />
          {locked ? <DetailRow label="Lock" value="Locked after failed PIN attempts" /> : null}

          {revealedPin ? (
            <div className="rounded-[8px] border border-border bg-muted/40 p-3" role="status">
              <p className="text-xs font-medium text-muted-foreground">New PIN, shown once</p>
              <p className="mt-1 font-mono text-2xl tracking-[0.3em]" data-testid="revealed-pin">
                {revealedPin}
              </p>
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void copyPin()}>
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => window.print()}>
                  Print
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setRevealedPin(null)}>
                  Hide
                </Button>
              </div>
              <div className="hidden print:block">Timeclock PIN: {revealedPin}</div>
            </div>
          ) : null}

          {canEdit ? (
            <div className="space-y-3">
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void post({ action: status?.exists ? "set_number" : "create", employee_number: employeeNumber });
                }}
              >
                <div>
                  <label htmlFor="timeclock-employee-number" className="text-xs font-medium text-muted-foreground">
                    Employee number
                  </label>
                  <Input
                    id="timeclock-employee-number"
                    className="mt-1 w-48"
                    value={employeeNumber}
                    onChange={(e) => setEmployeeNumber(e.target.value.toUpperCase().slice(0, 20))}
                    autoComplete="off"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "timeclock-access-error" : undefined}
                  />
                </div>
                <Button type="submit" size="sm" disabled={busy || !employeeNumber.trim()}>
                  {status?.exists ? "Save number" : "Set number and generate PIN"}
                </Button>
              </form>

              {status?.exists ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void post({ action: "reset_pin" })}>
                    Reset PIN
                  </Button>
                  {badgeConfigured ? (
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setBadgeMode(true)}>
                      {status.has_badge ? "Replace badge" : "Register badge"}
                    </Button>
                  ) : null}
                  {status.has_badge ? (
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void post({ action: "clear_badge" })}>
                      Remove badge
                    </Button>
                  ) : null}
                  {locked ? (
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void post({ action: "unlock" })}>
                      Unlock
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {badgeMode ? (
                <form onSubmit={submitBadge} className="flex flex-wrap items-end gap-2">
                  <div>
                    <label htmlFor="timeclock-badge" className="text-xs font-medium text-muted-foreground">
                      Scan the badge now
                    </label>
                    <Input id="timeclock-badge" ref={badgeRef} type="password" className="mt-1 w-48" value={badgeValue} onChange={(e) => setBadgeValue(e.target.value)} autoComplete="off" />
                  </div>
                  <Button type="submit" size="sm" disabled={busy || !badgeValue.trim()}>
                    Save badge
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setBadgeMode(false); setBadgeValue(""); }}>
                    Cancel
                  </Button>
                </form>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </RecordDetailSection>
  );
}
