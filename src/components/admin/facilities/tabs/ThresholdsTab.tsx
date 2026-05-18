"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, subDays } from "date-fns";
import { formatDistanceToNow } from "date-fns";
import { Info, Loader2, MoreHorizontal } from "lucide-react";
import { useFacilityThresholds, type ThresholdRow } from "@/hooks/useFacilityThresholds";
import {
  THRESHOLD_TYPE_LABELS,
  THRESHOLD_TYPES,
  type ThresholdType,
} from "@/lib/admin/facilities/facility-constants";
import {
  groupThresholdTypesByDomain,
  OPERATIONAL_THRESHOLD_CATALOG,
  THRESHOLD_DOMAIN_LABELS,
  THRESHOLD_DOMAIN_ORDER,
  thresholdDirectionLabel,
  thresholdPairError,
} from "@/lib/admin/facilities/operational-threshold-catalog";
import {
  buildOperationalThresholdPreview,
  countFacilityThresholdOverrides,
  describeAlertFrequency,
  thresholdsMatchOrgDefault,
  type OrgDefaultRow,
} from "@/lib/admin/facilities/operational-threshold-preview";
import type { FacilityDetailRow } from "@/types/facility";
import type { ThresholdInput, ThresholdAlertFrequency } from "@/lib/validation/facility-admin";
import { THRESHOLD_ALERT_FREQUENCIES } from "@/lib/validation/facility-admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type AuditFacilityRow = {
  id: string;
  record_id: string | null;
  field_name: string | null;
  changed_at: string;
  changed_by: string;
};

function pickLatest(rows: ThresholdRow[]): ThresholdRow | null {
  if (!rows.length) return null;
  return rows.reduce((best, r) =>
    Date.parse(r.updated_at) >= Date.parse(best.updated_at) ? r : best,
  );
}
function rowsFingerprint(rows: ThresholdRow[]): string {
  return [...rows]
    .sort((a, b) => a.threshold_type.localeCompare(b.threshold_type))
    .map(
      (r) =>
        `${r.threshold_type}:${r.yellow_threshold}:${r.red_threshold}:${r.enabled ? 1 : 0}:${r.notify_roles.join(",")}:${r.alert_frequency ?? ""}`,
    )
    .join("|");
}

interface ThresholdsTabProps {
  facilityId: string;
  facility: FacilityDetailRow | null;
  thresholds: ThresholdRow[];
  orgDefaults: OrgDefaultRow[];
  isLoading: boolean;
  error: string | null;
  isSaving: boolean;
  saveThresholds: ReturnType<typeof useFacilityThresholds>["saveThresholds"];
  onLiveRowsChange?: (rows: ThresholdRow[]) => void;
}

export function ThresholdsTab({
  facilityId,
  facility,
  thresholds,
  orgDefaults,
  isLoading,
  error,
  isSaving,
  saveThresholds,
  onLiveRowsChange,
}: ThresholdsTabProps) {
  const router = useRouter();

  const [local, setLocal] = useState<ThresholdRow[]>([]);
  const [resetAllOpen, setResetAllOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyFor, setHistoryFor] = useState<ThresholdRow | null>(null);
  const [historyLines, setHistoryLines] = useState<AuditFacilityRow[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);

  useEffect(() => {
    const next = thresholds.map((r) => ({ ...r }));
    setLocal(next);
    onLiveRowsChange?.(next);
  }, [thresholds, onLiveRowsChange]);

  useEffect(() => {
    const tmr = window.setTimeout(() => {
      onLiveRowsChange?.(local);
    }, 280);
    return () => window.clearTimeout(tmr);
  }, [local, onLiveRowsChange]);

  const orgMap = useMemo(() => new Map(orgDefaults.map((o) => [o.threshold_type, o])), [orgDefaults]);

  const dirty = rowsFingerprint(local) !== rowsFingerprint(thresholds);

  const rowErrors = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of local) {
      const err = thresholdPairError(r.threshold_type, r.yellow_threshold, r.red_threshold);
      if (err) m.set(r.id, err);
    }
    return m;
  }, [local]);

  const invalid = rowErrors.size > 0;
  const overrideCount = countFacilityThresholdOverrides(local, orgDefaults);

  const grouped = useMemo(() => {
    const g = groupThresholdTypesByDomain(THRESHOLD_TYPES);
    return THRESHOLD_DOMAIN_ORDER.map((domain) => ({
      domain,
      types: (g[domain] as ThresholdType[])
        .slice()
        .sort((a, b) => THRESHOLD_TYPES.indexOf(a) - THRESHOLD_TYPES.indexOf(b)),
    })).filter((b) => b.types.length > 0);
  }, []);

  const previewLines = useMemo(
    () => (facility ? buildOperationalThresholdPreview(facility, local) : []),
    [facility, local],
  );

  const latestSaved = pickLatest(thresholds);

  const [feed, setFeed] = useState<AuditFacilityRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const from = format(subDays(new Date(), 30), "yyyy-MM-dd");
      try {
        const res = await fetch(
          `/api/admin/facilities/${facilityId}/audit-log?table_name=facility_operational_thresholds&from=${from}&per_page=80`,
          { credentials: "include" },
        );
        if (!res.ok) {
          setFeed([]);
          return;
        }
        const j = (await res.json()) as { data: AuditFacilityRow[] };
        if (cancelled) return;
        setFeed((j.data ?? []).filter((e) => e.field_name && e.field_name !== "updated_at"));
      } catch {
        if (!cancelled) setFeed([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [facilityId, thresholds]);

  const updateRow = useCallback((id: string, patch: Partial<ThresholdRow>) => {
    setLocal((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const resetRowToOrg = useCallback(
    (rowId: string) => {
      const row = local.find((r) => r.id === rowId);
      if (!row) return;
      const o = orgMap.get(row.threshold_type);
      if (!o) return;
      updateRow(rowId, {
        yellow_threshold: o.yellow_threshold,
        red_threshold: o.red_threshold,
        notify_roles: [...o.notify_roles],
        alert_frequency: o.alert_frequency ?? null,
      });
    },
    [local, orgMap, updateRow],
  );

  const resetAllToOrg = useCallback(() => {
    setLocal((rows) =>
      rows.map((r) => {
        const o = orgMap.get(r.threshold_type);
        if (!o) return r;
        return {
          ...r,
          yellow_threshold: o.yellow_threshold,
          red_threshold: o.red_threshold,
          notify_roles: [...o.notify_roles],
          alert_frequency: o.alert_frequency ?? null,
        };
      }),
    );
    setResetAllOpen(false);
  }, [orgMap]);

  async function onSave() {
    const payload: Array<ThresholdInput & { id?: string }> = local.map((r) => {
      let alert_frequency: ThresholdInput["alert_frequency"];
      const raw = r.alert_frequency;
      if (raw != null && (THRESHOLD_ALERT_FREQUENCIES as readonly string[]).includes(raw)) {
        alert_frequency = raw as ThresholdAlertFrequency;
      } else {
        alert_frequency = undefined;
      }
      return {
        id: r.id,
        threshold_type: r.threshold_type as ThresholdInput["threshold_type"],
        yellow_threshold: r.yellow_threshold,
        red_threshold: r.red_threshold,
        notify_roles: r.notify_roles,
        enabled: r.enabled,
        alert_frequency,
      };
    });
    await saveThresholds(payload);
  }

  async function openHistory(row: ThresholdRow) {
    setHistoryFor(row);
    setHistoryOpen(true);
    setHistoryBusy(true);
    setHistoryLines([]);
    try {
      const res = await fetch(
        `/api/admin/facilities/${facilityId}/audit-log?table_name=facility_operational_thresholds&per_page=120`,
        { credentials: "include" },
      );
      if (!res.ok) {
        setHistoryLines([]);
        return;
      }
      const j = (await res.json()) as { data: AuditFacilityRow[] };
      setHistoryLines(
        (j.data ?? [])
          .filter((e) => e.record_id === row.id)
          .filter((e) => e.field_name && e.field_name !== "updated_at"),
      );
    } catch {
      setHistoryLines([]);
    } finally {
      setHistoryBusy(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return <p className="text-destructive text-sm">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl space-y-2">
          <p className="text-sm text-muted-foreground">
            Yellow and red boundaries that drive compliance and operational alerts across the app. Values are numeric
            (days, counts, or % — see unit per type). Direction indicators show which way is more urgent for each
            type.
          </p>
          <p className="text-sm text-muted-foreground">
            <Link href="/admin/settings/notifications" className="font-medium text-primary hover:underline">
              Alert routing →
            </Link>{" "}
            for channel and recipient configuration (email, SMS, push).
          </p>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">{overrideCount}</span> of{" "}
            <span className="font-medium text-foreground">{local.length}</span> thresholds overridden from org defaults
          </p>
          <button
            type="button"
            className="mt-1 text-xs font-medium text-primary hover:underline disabled:opacity-50"
            onClick={() => setResetAllOpen(true)}
            disabled={orgDefaults.length === 0}
          >
            Reset all to org defaults
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[8px] border border-border bg-card">
        <table className="min-w-full text-sm">
          <thead className="border-b border-border bg-muted/10 text-left">
            <tr className="text-muted-foreground">
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Yellow</th>
              <th className="px-3 py-2 font-medium">Red</th>
              <th className="px-3 py-2 font-medium">Direction</th>
              <th className="px-3 py-2 font-medium">Enabled</th>
              <th className="w-10 px-2 py-2" aria-label="Actions" />
            </tr>
          </thead>
          <tbody className="text-foreground">
            {grouped.map(({ domain, types }) => (
              <React.Fragment key={domain}>
                <tr className="bg-muted/[0.08]">
                  <td className="px-3 pb-2 pt-4" colSpan={6}>
                    <h3 className="text-[14px] font-semibold text-foreground">{THRESHOLD_DOMAIN_LABELS[domain]}</h3>
                  </td>
                </tr>
                <tr>
                  <td className="p-0" colSpan={6}>
                    <div className="mx-3 h-px bg-border" />
                  </td>
                </tr>
                {types.map((tt) => {
                  const row = [...local].find((r) => r.threshold_type === tt);
                  if (!row) return null;
                  const org = orgMap.get(tt);
                  const inherited = thresholdsMatchOrgDefault(row, org);
                  const meta = OPERATIONAL_THRESHOLD_CATALOG[tt];
                  const freqValue =
                    row.alert_frequency ?? org?.alert_frequency ?? meta?.alertFrequency ?? "daily_until_resolved";
                  const err = rowErrors.get(row.id);

                  return (
                    <React.Fragment key={row.id}>
                      <tr className="border-t border-border">
                        <td className="max-w-[14rem] px-3 py-3 align-middle">
                          <div className="space-y-1">
                            <p className={cn("font-medium", inherited ? "italic text-muted-foreground" : "")}>
                              {THRESHOLD_TYPE_LABELS[tt]}
                            </p>
                            {inherited ? (
                              <p className="text-[11px] italic text-muted-foreground">↑ Inherited from org</p>
                            ) : org ? (
                              <p className="text-[11px] text-muted-foreground">
                                Override · org {org.yellow_threshold} · {org.red_threshold}
                              </p>
                            ) : null}
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <span className="text-[11px] text-muted-foreground">
                                Digest: {describeAlertFrequency(tt, row.alert_frequency)}
                              </span>
                              <Select
                                value={freqValue}
                                onValueChange={(v) =>
                                  updateRow(row.id, {
                                    alert_frequency: v,
                                  })
                                }
                              >
                                <SelectTrigger className="h-7 w-[160px] text-[11px]" aria-label="Alert frequency">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {THRESHOLD_ALERT_FREQUENCIES.map((f) => (
                                    <SelectItem key={f} value={f} className="text-xs">
                                      {describeAlertFrequency(tt, f)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 align-middle">
                          <div className={cn(inherited ? "opacity-80" : "")}>
                            <NumberInput
                              aria-label={`${THRESHOLD_TYPE_LABELS[tt]} yellow`}
                              min={0}
                              value={row.yellow_threshold}
                              onValueChange={(n) => updateRow(row.id, { yellow_threshold: n })}
                              className={cn(inherited ? "italic text-muted-foreground" : "")}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-3 align-middle">
                          <div className={cn(inherited ? "opacity-80" : "")}>
                            <NumberInput
                              aria-label={`${THRESHOLD_TYPE_LABELS[tt]} red`}
                              min={0}
                              value={row.red_threshold}
                              onValueChange={(n) => updateRow(row.id, { red_threshold: n })}
                              className={cn(inherited ? "italic text-muted-foreground" : "")}
                            />
                          </div>
                        </td>
                        <td className="px-3 py-3 align-middle">
                          <div className="flex max-w-[10rem] items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
                            <span className="text-foreground/90">{thresholdDirectionLabel(tt)}</span>
                            <Tooltip>
                              <TooltipTrigger
                                type="button"
                                className="mt-0.5 rounded-[4px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-label={`About ${THRESHOLD_TYPE_LABELS[tt]}`}
                              >
                                <Info className="size-3.5 shrink-0" aria-hidden />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs leading-snug">{meta?.description ?? ""}</TooltipContent>
                            </Tooltip>
                          </div>
                        </td>
                        <td className="px-3 py-3 align-middle">
                          <Switch
                            checked={row.enabled}
                            onCheckedChange={(v) => updateRow(row.id, { enabled: v })}
                            aria-label={`Enable alerts for ${THRESHOLD_TYPE_LABELS[tt]}`}
                          />
                        </td>
                        <td className="px-2 py-3 align-middle text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              type="button"
                              className="inline-flex size-8 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:bg-muted"
                              aria-label="Row actions"
                            >
                              <MoreHorizontal className="size-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuItem
                                disabled={!org}
                                onSelect={() => {
                                  resetRowToOrg(row.id);
                                }}
                              >
                                Reset to org default
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  router.push("/admin/settings/notifications");
                                }}
                              >
                                View alert routing →
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  void openHistory(row);
                                }}
                              >
                                View history
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  updateRow(row.id, { enabled: false });
                                }}
                              >
                                Disable
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                      {err ? (
                        <tr className="bg-destructive/5">
                          <td className="px-3 pb-3 pt-0 text-xs text-destructive" colSpan={6}>
                            {err}
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-6 lg:grid-cols-5 lg:gap-8">
        <section className="lg:col-span-3 rounded-[8px] border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Preview alerts at current thresholds</h3>
          <p className="mt-1 text-xs text-muted-foreground">Shows what would fire with the values above (facility context).</p>
          <ul className="mt-4 divide-y divide-border">
            {previewLines.length === 0 ? (
              <li className="py-4 text-sm text-muted-foreground">No alerts would fire with these settings.</li>
            ) : (
              previewLines.map((l) => (
                <li key={`${l.threshold_type}-${l.severity}`} className="flex flex-wrap items-center gap-3 py-3">
                  <Badge variant={l.severity === "red" ? "destructive" : "secondary"} className="tabular-nums">
                    {l.severity}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{l.label}</p>
                    <p className="text-xs text-muted-foreground">{l.current}</p>
                  </div>
                  <span className="text-xs font-medium text-primary">Would fire</span>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="lg:col-span-2 rounded-[8px] border border-border bg-muted/10 p-4">
          <h3 className="text-sm font-semibold text-foreground">Recently changed thresholds</h3>
          <p className="mt-1 text-xs text-muted-foreground">Audit trail entries for this facility (last 30 days).</p>
          <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto text-xs">
            {feed.length === 0 ? (
              <li className="text-muted-foreground">No recent edits recorded (or unavailable for your role).</li>
            ) : (
              feed.slice(0, 20).map((e) => (
                <li key={e.id} className="rounded-[6px] border border-border/60 bg-background/60 px-2 py-1.5">
                  <span className="text-muted-foreground">
                    {formatDistanceToNow(new Date(e.changed_at), { addSuffix: true })}
                  </span>
                  <span className="mx-1 text-border">·</span>
                  <span className="font-medium text-foreground">{e.field_name}</span>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
        <Button
          type="button"
          variant={dirty && !invalid ? "default" : "outline"}
          disabled={!dirty || invalid || isSaving || local.length === 0}
          onClick={() => void onSave()}
        >
          {isSaving ? "Saving…" : "Save thresholds"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Last changed{" "}
          {latestSaved
            ? `${formatDistanceToNow(new Date(latestSaved.updated_at), { addSuffix: true })} by ${latestSaved.updated_by_display ?? "—"}`
            : "—"}
        </p>
      </div>

      <Dialog open={resetAllOpen} onOpenChange={setResetAllOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset all thresholds to org defaults?</DialogTitle>
            <DialogDescription>
              This replaces yellow, red, notify roles, and digest frequency on every row with the organization defaults.
              Enabled/disabled stays as-is until you change it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setResetAllOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={resetAllToOrg}>
              Reset all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Threshold history</SheetTitle>
            <SheetDescription>
              {historyFor ? THRESHOLD_TYPE_LABELS[historyFor.threshold_type as ThresholdType] : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 max-h-[70vh] space-y-2 overflow-y-auto text-xs">
            {historyBusy ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : historyLines.length === 0 ? (
              <p className="text-muted-foreground">No audit entries yet, or unavailable for your role.</p>
            ) : (
              historyLines.map((e) => (
                <div key={e.id} className="rounded-[6px] border border-border p-2">
                  <p className="font-medium">{e.field_name}</p>
                  <p className="text-muted-foreground">
                    {formatDistanceToNow(new Date(e.changed_at), { addSuffix: true })}
                  </p>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
