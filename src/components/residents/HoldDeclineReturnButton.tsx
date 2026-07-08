"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { ResidencyStatus } from "@/lib/residents/presence";

/**
 * BH-4 — Private-pay: family notifies they will not return → release bed hold intent.
 * Does not auto-discharge; staff still complete official discharge when belongings are out.
 */
export function HoldDeclineReturnButton({
  residentId,
  status,
  onDone,
}: {
  residentId: string;
  status: ResidencyStatus;
  onDone?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  if (status !== "hospital" && status !== "loa") return null;

  async function markDecline() {
    setSaving(true);
    const supabase = createClient();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Session expired. Sign in again.");
        return;
      }
      const { error } = await supabase
        .from("residents")
        .update({
          hold_decline_return_at: new Date().toISOString(),
          hold_decline_return_notes: "Family/resident notified they will not return; release bed hold.",
          updated_by: user.id,
        } as never)
        .eq("id", residentId);
      if (error) throw error;
      toast.success("Decline-to-return recorded. Complete official discharge when belongings are out.");
      onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save decline-to-return.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={saving}
      onClick={() => void markDecline()}
      className="text-[12px]"
    >
      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Will not return — release hold"}
    </Button>
  );
}
