"use client";

/**
 * Facility settings tab for the timeclock (COL-352, spec 37 §6): the per
 * facility flag, tablet enrollment with a one time code, and the device list
 * with revoke. Owner and org_admin change things; facility_admin reads.
 */

import React, { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { RecordDetailSection } from "@/design-system/components/record-detail";
import { formatDateTime } from "@/lib/timeclock/display-copy";
import { HorizontalScroll } from "@/components/ui/horizontal-scroll";

type Device = { id: string; label: string; enrolled_at: string; last_seen_at: string | null; revoked_at: string | null; throttled_until: string | null };

export type TimeclockTabProps = {
  facilityId: string;
  fetchImpl?: typeof fetch;
};

export function TimeclockTab({ facilityId, fetchImpl }: TimeclockTabProps) {
  const fetcher = fetchImpl ?? fetch;
  const [enabled, setEnabled] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetcher(`/api/admin/timeclock/devices?facility_id=${facilityId}`, { credentials: "same-origin" });
      const json = (await response.json().catch(() => null)) as { enabled?: boolean; devices?: Device[]; can_manage?: boolean; error?: string } | null;
      if (!response.ok || !json) {
        setError(json?.error ?? "Could not load timeclock settings");
        return;
      }
      setEnabled(Boolean(json.enabled));
      setDevices(json.devices ?? []);
      setCanManage(Boolean(json.can_manage));
    } catch {
      setError("Could not load timeclock settings");
    } finally {
      setLoading(false);
    }
  }, [fetcher, facilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (payload: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetcher("/api/admin/timeclock/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ facility_id: facilityId, ...payload }),
      });
      const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok) {
        setError(typeof json?.error === "string" ? json.error : "Could not update timeclock settings");
        return null;
      }
      return json;
    } catch {
      setError("Could not update timeclock settings");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    const next = !enabled;
    const result = await post({ action: "set_enabled", enabled: next });
    if (result) setEnabled(next);
  };

  const enroll = async () => {
    const result = await post({ action: "enroll_code" });
    if (result && typeof result.code === "string" && typeof result.expires_at === "string") {
      setCode({ code: result.code, expires_at: result.expires_at });
    }
  };

  const revoke = async (deviceId: string) => {
    const result = await post({ action: "revoke", device_id: deviceId });
    if (result) await load();
  };

  const active = devices.filter((d) => !d.revoked_at);
  const revoked = devices.filter((d) => d.revoked_at);

  return (
    <div className="space-y-6">
      {error ? (
        <p role="alert" className="rounded-[8px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      <RecordDetailSection title="Timeclock" description="Staff clock in and out on enrolled tablets when this is on.">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm" data-testid="timeclock-flag">
              {enabled ? "On for this facility" : "Off for this facility"}
            </p>
            {canManage ? (
              <Button type="button" size="sm" variant={enabled ? "outline" : "default"} disabled={busy} onClick={() => void toggle()} aria-pressed={enabled}>
                {enabled ? "Turn timeclock off" : "Turn timeclock on"}
              </Button>
            ) : null}
          </div>
        )}
      </RecordDetailSection>

      <RecordDetailSection title="Tablets" description="Each tablet is bound to this facility with a one time code. Revoke a lost tablet here.">
        {canManage ? (
          <div className="mb-4 space-y-2">
            <Button type="button" size="sm" disabled={busy || loading} onClick={() => void enroll()}>
              Enroll a tablet
            </Button>
            {code ? (
              <div className="rounded-[8px] border border-border bg-muted/40 p-3" role="status">
                <p className="text-xs font-medium text-muted-foreground">Enter this code on the tablet within 15 minutes</p>
                <p className="mt-1 font-mono text-2xl tracking-[0.3em]" data-testid="enrollment-code">
                  {code.code}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Expires {formatDateTime(code.expires_at)}</p>
              </div>
            ) : null}
          </div>
        ) : null}
        {loading ? null : active.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tablets enrolled.</p>
        ) : (
          <HorizontalScroll label="Timeclock tablets">
            <table className="w-full text-sm">
              <caption className="sr-only">Enrolled tablets</caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-2 py-1">Tablet</th>
                  <th scope="col" className="px-2 py-1">Enrolled</th>
                  <th scope="col" className="px-2 py-1">Last seen</th>
                  <th scope="col" className="px-2 py-1"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {active.map((d) => (
                  <tr key={d.id} className="border-t border-border">
                    <td className="px-2 py-2">{d.label}</td>
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">{formatDateTime(d.enrolled_at)}</td>
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">{d.last_seen_at ? formatDateTime(d.last_seen_at) : "Never"}</td>
                    <td className="px-2 py-2 text-right">
                      {canManage ? (
                        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void revoke(d.id)}>
                          Revoke
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HorizontalScroll>
        )}
        {revoked.length > 0 ? <p className="mt-3 text-xs text-muted-foreground">{revoked.length} revoked tablet{revoked.length === 1 ? "" : "s"} kept for history.</p> : null}
      </RecordDetailSection>
    </div>
  );
}
