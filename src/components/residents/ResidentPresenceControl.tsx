"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { MovementWhenFields, useMovementBackdateWindow } from "@/components/residents/MovementWhenFields";
import {
  EMPTY_MOVEMENT_WHEN,
  movementGuardMessage,
  movementPatchFields,
  resolveMovementWhen,
  type MovementWhenDraft,
} from "@/lib/residents/movement-effective-at";
import { createClient } from "@/lib/supabase/client";
import {
  shouldRequireForm1823RenewalOnPresenceChange,
} from "@/lib/admissions/form-1823-renewal";
import {
  PRESENCE_CHOICES,
  currentPresenceChoice,
  presenceChange,
  presenceChoice,
  presenceLabel,
  presenceTone,
  type BedHoldStayType,
  type PresenceChoiceKey,
  type ResidencyStatus,
} from "@/lib/residents/presence";
import { cn } from "@/lib/utils";

/**
 * ResidentPresenceControl — the write path for resident presence.
 *
 * Turns the (previously hardcoded) "In facility" label into a live, editable
 * presence picker on the resident record. Selecting a state writes
 * `residents.status`; the DB trigger `tr_residents_status_history_capture`
 * records the timeline entry and the audit trigger captures the change — no
 * extra history plumbing needed here. RLS (`clinical_staff_update_residents`)
 * gates who may write; a rejected update surfaces as a toast.
 *
 * Only the three in-census presence states are offered — this control cannot
 * discharge or otherwise change lifecycle, by design.
 *
 * COL-750: choosing a state asks when it happened (blank = just now), so a
 * hospital return entered Wednesday for Tuesday is dated Tuesday everywhere
 * the status history is read.
 *
 * COL-755: a bed hold is at a hospital or in rehab. Hospital to rehab on a
 * recorded stay is a dated movement; naming the type of a stay recorded before
 * the type was asked corrects that stay and asks no date.
 *
 * BH-4: hospital_hold stamps hold_case_manager_notified_at when empty.
 * BH-6: hospital_hold → active marks latest Form 1823 renewal_due.
 */
export function ResidentPresenceControl({
  residentId,
  status,
  stayType,
  onChanged,
  disabled = false,
}: {
  residentId: string;
  status: ResidencyStatus;
  /** COL-755: the stay type when `status` is hospital; null = not recorded. */
  stayType?: BedHoldStayType | null;
  onChanged?: (next: ResidencyStatus) => void;
  disabled?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  // Optimistic target held only until the parent reloads with the new status.
  const [pending, setPending] = useState<PresenceChoiceKey | null>(null);

  // Once the parent reload propagates the new `status` prop, drop the optimism.
  useEffect(() => {
    setPending(null);
  }, [status, stayType]);

  const current = currentPresenceChoice(status, stayType ?? null);
  const displayedChoice = pending ?? current;
  const displayed: ResidencyStatus = displayedChoice ? presenceChoice(displayedChoice).status : status;
  const displayedLabel = displayedChoice ? presenceChoice(displayedChoice).label : presenceLabel(status, status === "hospital" ? stayType ?? null : undefined);
  // The choice made in the menu, waiting for "when did this happen?" (or, for
  // naming an unrecorded stay's type, for confirmation).
  const [target, setTarget] = useState<PresenceChoiceKey | null>(null);
  const change = target ? presenceChange(status, stayType ?? null, target) : "none";
  const [when, setWhen] = useState<MovementWhenDraft>(EMPTY_MOVEMENT_WHEN);
  const [problem, setProblem] = useState<string | null>(null);
  const windowDays = useMovementBackdateWindow({ residentId, enabled: target !== null });

  function choose(next: PresenceChoiceKey) {
    if (next === displayedChoice || saving) return;
    setWhen(EMPTY_MOVEMENT_WHEN);
    setProblem(null);
    setTarget(next);
  }

  function closeDialog() {
    if (saving) return;
    setTarget(null);
    setProblem(null);
  }

  async function save() {
    const nextKey = target;
    if (!nextKey || saving) return;
    const choice = presenceChoice(nextKey);
    const next = choice.status;
    const recordOnly = presenceChange(status, stayType ?? null, nextKey) === "record_type";
    const resolved = recordOnly ? null : resolveMovementWhen(when, { windowDays: windowDays ?? null });
    if (resolved && !resolved.ok) {
      setProblem(resolved.error);
      return;
    }
    setProblem(null);
    setSaving(true);
    setPending(nextKey);
    const supabase = createClient();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Session expired. Sign in again to update presence.");
        setPending(null);
        return;
      }

      const { data: currentRow, error: currentErr } = await supabase
        .from("residents")
        .select("status, hold_case_manager_notified_at, organization_id, facility_id")
        .eq("id", residentId)
        .maybeSingle();
      if (currentErr) throw currentErr;

      const previousDbStatus =
        ((currentRow as { status?: string | null } | null)?.status as string | null) ?? null;
      const nextDb = choice.dbValue;
      const notifiedAt = (currentRow as { hold_case_manager_notified_at?: string | null } | null)
        ?.hold_case_manager_notified_at;
      // Naming an unrecorded stay's type changes nothing but the type.
      const patch: Record<string, unknown> = recordOnly
        ? { bed_hold_stay_type: choice.stayType, updated_by: user.id }
        : {
            status: nextDb,
            ...(choice.stayType ? { bed_hold_stay_type: choice.stayType } : {}),
            updated_by: user.id,
            ...(resolved && resolved.ok ? movementPatchFields(resolved.value) : {}),
          };

      // BH-4: Medicaid hold clock — stamp case-manager notified when entering hospital hold.
      if (!recordOnly && nextDb === "hospital_hold" && !notifiedAt) {
        patch.hold_case_manager_notified_at = new Date().toISOString();
      }

      // Private-pay decline-return clears when returning in-house.
      if (nextDb === "active") {
        patch.hold_decline_return_at = null;
        patch.hold_decline_return_notes = null;
      }

      const { error } = await supabase
        .from("residents")
        .update(patch as never)
        .eq("id", residentId);
      if (error) {
        const guard = movementGuardMessage(error);
        if (guard) {
          setPending(null);
          setProblem(guard);
          return;
        }
        throw error;
      }
      setTarget(null);

      // BH-6: return from hospital → Form 1823 renewal due.
      if (
        shouldRequireForm1823RenewalOnPresenceChange({
          previousDbStatus,
          nextDbStatus: nextDb,
        })
      ) {
        const { error: formErr } = await supabase
          .from("form_1823_records" as never)
          .update({
            status: "renewal_due",
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          } as never)
          .eq("resident_id", residentId)
          .is("deleted_at", null)
          .in("status", ["received", "pending", "renewal_due"]);
        if (formErr) {
          // Presence already saved — surface advisory only.
          toast.message(
            "Presence updated. Mark Form 1823 renewal when the new physician report arrives.",
          );
        } else {
          toast.success(
            `Presence updated — ${choice.label}. Form 1823 marked renewal due.`,
          );
          onChanged?.(next);
          return;
        }
      }

      toast.success(`Presence updated — ${choice.label}.`);
      onChanged?.(next);
    } catch (e) {
      setPending(null);
      toast.error(
        e instanceof Error ? e.message : "Could not update presence. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        disabled={disabled || saving}
        aria-label={`Update presence — currently ${displayedLabel}`}
        className={cn(
          "inline-flex items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
          (disabled || saving) && "opacity-70",
        )}
      >
        <StatusPill tone={presenceTone(displayed)} className="cursor-pointer">
          {displayedLabel}
        </StatusPill>
        {saving ? (
          <Loader2 className="size-3 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[224px]">
        {/* GroupLabel is a base-ui "group part" and MUST sit inside a Group,
            or base-ui throws error #31 at runtime (dev tolerates it, prod crashes). */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Update presence</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {PRESENCE_CHOICES.map((opt) => (
            <DropdownMenuItem
              key={opt.key}
              onClick={() => choose(opt.key)}
              className="flex items-start gap-2"
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                {opt.key === displayedChoice ? <Check className="size-3.5" aria-hidden /> : null}
              </span>
              <span className="flex flex-col">
                <span className="text-[13px] font-medium text-foreground">{opt.label}</span>
                <span className="text-[11px] text-muted-foreground">{opt.hint}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    <Dialog open={target !== null} onOpenChange={(open) => (open ? undefined : closeDialog())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{target ? presenceChoice(target).label : "Update presence"}</DialogTitle>
          <DialogDescription>
            {change === "record_type"
              ? "This stay was recorded before Haven asked hospital or rehab. Saving records the type for the stay in force; its dates do not change."
              : "Record when the change actually happened, so reports and the Stand Up count it on the right day."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {change === "record_type" ? null : (
            <MovementWhenFields
              value={when}
              onChange={setWhen}
              windowDays={windowDays}
              idPrefix={`presence-${residentId}`}
              disabled={saving}
            />
          )}
          {problem ? (
            <p role="alert" className="rounded-[8px] border border-destructive p-3 text-sm">
              {problem}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={closeDialog}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

export default ResidentPresenceControl;
