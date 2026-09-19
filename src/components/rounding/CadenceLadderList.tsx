"use client";

/**
 * The escalation ladder in wall-clock terms, with the recipient resolution spec
 * 6.6 asks for: the roles each rung targets, and how many people hold each of
 * those roles at this building right now.
 *
 * Offsets are stored as minutes from window close. An administrator does not
 * think in offsets, so every rung is also shown against one named window: the
 * first enabled check of the day, whichever one that is at this building. That
 * window is chosen from the rows, never named in code.
 *
 * A role with nobody in it is drawn in the warning tone rather than hidden. It
 * is the rung reaching nobody, and hiding it is how a ladder looks like it works
 * and does not.
 */

import { Button } from "@/components/ui/button";
import {
  formatMinuteOfDay,
  formatOffsetFromClose,
  rungFireMinute,
  type CadenceDayShape,
  type LadderRung,
} from "@/lib/rounding/cadence-settings";
import { channelLabel, staffRoleLabel } from "@/lib/rounding/cadence-settings-copy";
import { cn } from "@/lib/utils";

export function CadenceLadderList({
  ladder,
  shape,
  label,
  onEdit,
  onTestSend,
  testSendBusyRungKey,
}: {
  ladder: LadderRung[];
  shape: CadenceDayShape | null;
  label: string;
  onEdit?: (rungKey: string) => void;
  onTestSend?: (rungKey: string) => void;
  testSendBusyRungKey?: string | null;
}) {
  const reference = shape?.windows.find((window) => window.enabled) ?? null;

  return (
    <section aria-label={label} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        {reference ? (
          <p className="text-[13px] text-muted-foreground">
            Shown against the {reference.label.toLowerCase()}, which closes at{" "}
            {formatMinuteOfDay(reference.closes_minute)}
          </p>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-[13px]">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th scope="col" className="h-9 px-4 font-medium">Step</th>
              <th scope="col" className="h-9 px-4 font-medium">When</th>
              <th scope="col" className="h-9 px-4 font-medium">Who hears</th>
              <th scope="col" className="h-9 px-4 font-medium">How</th>
              {onEdit || onTestSend ? <th scope="col" className="h-9 px-4 font-medium sr-only">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {ladder.map((rung) => (
              <tr
                key={rung.rung_key}
                className={cn("border-b border-border/60 last:border-0", !rung.enabled && "opacity-60")}
              >
                <td className="h-10 px-4 align-middle text-foreground">
                  {rung.label}
                  {rung.is_terminal ? (
                    <span className="ml-2 text-muted-foreground">final step</span>
                  ) : null}
                  {rung.assigned_staff_only ? (
                    <span className="ml-2 text-muted-foreground">staff reminder, not an escalation</span>
                  ) : null}
                  {!rung.enabled ? <span className="ml-2 text-muted-foreground">turned off</span> : null}
                </td>
                <td className="h-10 px-4 align-middle tabular-nums text-muted-foreground">
                  {reference ? (
                    <>
                      {formatMinuteOfDay(rungFireMinute(reference.closes_minute, rung.offset_minutes))}
                      <span className="ml-2 text-[12px]">{formatOffsetFromClose(rung.offset_minutes)}</span>
                    </>
                  ) : (
                    formatOffsetFromClose(rung.offset_minutes)
                  )}
                </td>
                <td className="h-10 px-4 align-middle text-muted-foreground">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    {rung.include_assigned_staff ? <span>the staff member the check belongs to</span> : null}
                    {rung.roles.map((role) => (
                      <span
                        key={role.staff_role}
                        className={cn(role.holder_count === 0 && "text-warning")}
                      >
                        {staffRoleLabel(role.staff_role)} ({role.holder_count})
                      </span>
                    ))}
                    {rung.use_standing_alert_routes ? (
                      <span>standing alert audience ({rung.standing_alert_route_count})</span>
                    ) : null}
                  </span>
                </td>
                <td className="h-10 px-4 align-middle text-muted-foreground">
                  {rung.channels.map((channel) => channelLabel(channel)).join(", ")}
                </td>
                {onEdit || onTestSend ? (
                  <td className="h-10 px-4 align-middle text-right">
                    <span className="inline-flex gap-1">
                      {onTestSend ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onTestSend(rung.rung_key)}
                          disabled={testSendBusyRungKey === rung.rung_key}
                        >
                          Test send
                        </Button>
                      ) : null}
                      {onEdit ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => onEdit(rung.rung_key)}>
                          Edit
                        </Button>
                      ) : null}
                    </span>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
