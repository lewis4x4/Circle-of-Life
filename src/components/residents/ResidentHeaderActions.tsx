"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, FileText, MoreHorizontal, Stethoscope } from "lucide-react";

import { HoldDeclineReturnButton } from "@/components/residents/HoldDeclineReturnButton";
import { BED_MOVE_ROLES, ChangeBedAction } from "@/components/residents/ChangeBedAction";
import { RecordDischargeAction } from "@/components/residents/RecordDischargeAction";
import { MonitoringOrderAction } from "@/components/rounding/MonitoringOrderAction";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import type { ResidencyStatus } from "@/lib/residents/presence";
import { cn } from "@/lib/utils";

/**
 * One size for every control in the resident record header.
 *
 * The header used to mix a 44px button, a 32px button and bare text in the same
 * row because each action component chose its own height. Both headers (the
 * overview and the shell the other tabs inherit) now spend this constant, so a
 * new action cannot arrive at a different size without editing it here.
 *
 * 44px on touch, 36px (`h-9`, the Button default) from `md` up.
 */
export const RESIDENT_HEADER_ACTION_CLASS =
  "h-auto min-h-[44px] w-full min-w-0 px-3 text-[13px] font-medium md:h-9 md:min-h-0 md:w-auto md:py-0";

export type ResidentDocumentationHandlers = {
  onLogBehavior: () => void;
  onLogCondition: () => void;
  onGeneralNote: () => void;
  /** Quieter, smaller buttons for an in-page empty state, so the same three
   *  actions do not read as a second page header. */
  compact?: boolean;
};

/**
 * The three things staff record against a resident all day. They are the only
 * actions with a visible button in the header — everything else a resident
 * record can do is a lifecycle change and lives behind `ResidentLifecycleMenu`.
 */
export function ResidentDocumentationActions({
  onLogBehavior,
  onLogCondition,
  onGeneralNote,
  compact = false,
}: ResidentDocumentationHandlers) {
  const shared = compact ? "h-8 text-[12px]" : RESIDENT_HEADER_ACTION_CLASS;
  const size = compact ? ("sm" as const) : undefined;
  return (
    <>
      <Button type="button" variant="outline" size={size} onClick={onLogBehavior} className={shared}>
        <Brain className="size-4" aria-hidden /> Log behavior
      </Button>
      <Button type="button" variant="outline" size={size} onClick={onLogCondition} className={shared}>
        <Stethoscope className="size-4" aria-hidden /> Log condition
      </Button>
      <Button type="button" variant="outline" size={size} onClick={onGeneralNote} className={shared}>
        <FileText className="size-4" aria-hidden /> General note
      </Button>
    </>
  );
}

type LifecycleDialog = "bed" | "discharge" | "monitoring" | null;

/**
 * Bed moves, discharges and Monitoring Orders: infrequent, consequential, and
 * previously four differently-sized buttons wedged between the resident's name
 * and their acuity. They are one menu now.
 *
 * The dialogs are rendered outside the menu and driven by state, because Radix
 * unmounts menu content the instant the menu closes — a dialog mounted inside
 * an item would close with it. `?changeBed=1` still opens the bed dialog on
 * arrival through `initialDialog`.
 */
export function ResidentLifecycleMenu({
  residentId,
  residentName,
  facilityId,
  currentBedLabel,
  status,
  initialDialog = null,
  onDone,
  onMonitoringOrderDone,
  className,
}: {
  residentId: string;
  residentName: string;
  facilityId: string;
  currentBedLabel: string;
  status: ResidencyStatus;
  initialDialog?: LifecycleDialog;
  onDone?: () => void;
  onMonitoringOrderDone?: () => void;
  className?: string;
}) {
  const { appRole, loading: authLoading } = useHavenAuth();
  const canMoveBed = !authLoading && (BED_MOVE_ROLES as readonly string[]).includes(appRole);
  const [dialog, setDialog] = useState<LifecycleDialog>(initialDialog);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The menu restores focus to its trigger as it closes. Opening the dialog in
  // the same tick puts the two in a fight the dialog does not always win, so
  // the dialog opens once the menu has finished closing.
  const openDialog = useCallback((next: Exclude<LifecycleDialog, null>) => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => setDialog(next), 0);
  }, []);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          type="button"
          aria-label={`More actions for ${residentName}`}
          className={cn(
            buttonVariants({ variant: "outline" }),
            RESIDENT_HEADER_ACTION_CLASS,
            "md:w-9 md:px-0",
            className,
          )}
        >
          <MoreHorizontal className="size-4" aria-hidden />
          <span className="md:hidden">More actions</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[232px]">
          {/* GroupLabel is a base-ui "group part" and MUST sit inside a Group,
              or base-ui throws error #31 at runtime. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>Resident record</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {canMoveBed ? (
              <DropdownMenuItem onClick={() => openDialog("bed")}>Change bed…</DropdownMenuItem>
            ) : null}
            {/* Monitoring Order lives here rather than inside Smart Rounding:
                the person holding the discharge paperwork opens the resident,
                not a module. */}
            <DropdownMenuItem onClick={() => openDialog("monitoring")}>
              Monitoring Order…
            </DropdownMenuItem>
            {/* Ending a residency is a lifecycle change, so it is its own
                confirmed action rather than an option in the presence picker.
                It is also the event that frees the bed (COL-418). */}
            <DropdownMenuItem onClick={() => openDialog("discharge")}>
              Record discharge…
            </DropdownMenuItem>
            <HoldDeclineReturnButton
              residentId={residentId}
              status={status}
              onDone={onDone}
              asMenuItem
            />
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangeBedAction
        key={residentId}
        residentId={residentId}
        residentName={residentName}
        facilityId={facilityId}
        currentBedLabel={currentBedLabel}
        hideTrigger
        open={dialog === "bed"}
        onOpenChange={(next) => setDialog(next ? "bed" : null)}
        onDone={onDone}
      />
      <RecordDischargeAction
        residentId={residentId}
        residentName={residentName}
        hideTrigger
        open={dialog === "discharge"}
        onOpenChange={(next) => setDialog(next ? "discharge" : null)}
        onDone={onDone}
      />
      <MonitoringOrderAction
        residentId={residentId}
        residentName={residentName}
        facilityId={facilityId}
        hideTrigger
        open={dialog === "monitoring"}
        onOpenChange={(next) => setDialog(next ? "monitoring" : null)}
        onDone={onMonitoringOrderDone ?? onDone}
      />
    </>
  );
}
