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
import { StatusPill } from "@/components/ui/status-pill";
import { createClient } from "@/lib/supabase/client";
import {
  shouldRequireForm1823RenewalOnPresenceChange,
} from "@/lib/admissions/form-1823-renewal";
import {
  PRESENCE_OPTIONS,
  presenceLabel,
  presenceTone,
  residencyStatusToDbValue,
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
 * BH-4: hospital_hold stamps hold_case_manager_notified_at when empty.
 * BH-6: hospital_hold → active marks latest Form 1823 renewal_due.
 */
export function ResidentPresenceControl({
  residentId,
  status,
  onChanged,
  disabled = false,
}: {
  residentId: string;
  status: ResidencyStatus;
  onChanged?: (next: ResidencyStatus) => void;
  disabled?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  // Optimistic target held only until the parent reloads with the new status.
  const [pending, setPending] = useState<ResidencyStatus | null>(null);

  // Once the parent reload propagates the new `status` prop, drop the optimism.
  useEffect(() => {
    setPending(null);
  }, [status]);

  const displayed = pending ?? status;

  async function choose(next: ResidencyStatus) {
    if (next === displayed || saving) return;
    setSaving(true);
    setPending(next);
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
      const nextDb = residencyStatusToDbValue(next);
      const notifiedAt = (currentRow as { hold_case_manager_notified_at?: string | null } | null)
        ?.hold_case_manager_notified_at;
      const patch: Record<string, unknown> = {
        status: nextDb,
        updated_by: user.id,
      };

      // BH-4: Medicaid hold clock — stamp case-manager notified when entering hospital hold.
      if (nextDb === "hospital_hold" && !notifiedAt) {
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
      if (error) throw error;

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
            `Presence updated — ${presenceLabel(next)}. Form 1823 marked renewal due.`,
          );
          onChanged?.(next);
          return;
        }
      }

      toast.success(`Presence updated — ${presenceLabel(next)}.`);
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
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        disabled={disabled || saving}
        aria-label={`Update presence — currently ${presenceLabel(displayed)}`}
        className={cn(
          "inline-flex items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
          (disabled || saving) && "opacity-70",
        )}
      >
        <StatusPill tone={presenceTone(displayed)} className="cursor-pointer">
          {presenceLabel(displayed)}
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
          {PRESENCE_OPTIONS.map((opt) => (
            <DropdownMenuItem
              key={opt.status}
              onClick={() => void choose(opt.status)}
              className="flex items-start gap-2"
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                {opt.status === displayed ? <Check className="size-3.5" aria-hidden /> : null}
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
  );
}

export default ResidentPresenceControl;
