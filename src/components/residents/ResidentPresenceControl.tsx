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
 */
export function ResidentPresenceControl({
  residentId,
  status,
  onChanged,
  disabled = false,
  updatedByUserId = null,
}: {
  residentId: string;
  status: ResidencyStatus;
  onChanged?: (next: ResidencyStatus) => void;
  disabled?: boolean;
  updatedByUserId?: string | null;
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
      if (!updatedByUserId) {
        toast.error("Session expired. Sign in again to update presence.");
        setPending(null);
        return;
      }
      const { error } = await supabase
        .from("residents")
        .update({ status: residencyStatusToDbValue(next), updated_by: updatedByUserId })
        .eq("id", residentId);
      if (error) throw error;
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
