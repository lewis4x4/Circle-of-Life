"use client";

import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RecordDetailSection } from "@/design-system/components/record-detail";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { isInactiveEmploymentStatus } from "@/lib/staff/staff-offboard";
import type { StaffProfileRow } from "@/lib/staff/staff-profile-edit";

type StaffOffboardCardProps = {
  staff: StaffProfileRow;
  canEdit: boolean;
  onStaffUpdated: (staff: StaffProfileRow) => void;
};

function havenRestoreCopy(havenAccess: string | undefined): string {
  if (havenAccess === "needs_org_admin") {
    return "Employment is restored. An organization administrator must restore Haven sign-in.";
  }
  if (havenAccess === "pending_sync") {
    return "Employment is restored. Sign-in synchronization may still be pending.";
  }
  if (havenAccess === "restored") {
    return "Employment and Haven access restored.";
  }
  return "Employment restored. History stays on file.";
}

export function StaffOffboardCard({ staff, canEdit, onStaffUpdated }: StaffOffboardCardProps) {
  const inactive = isInactiveEmploymentStatus(staff.employment_status);
  const [offboardOpen, setOffboardOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [terminationDate, setTerminationDate] = useState(() => todayFacilityDateIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) return null;

  const resetDialog = () => {
    setReason("");
    setTerminationDate(todayFacilityDateIso());
    setError(null);
  };

  const postCommand = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        data?: StaffProfileRow;
        haven_access?: string;
        access_control_sync?: string;
      };
      if (!res.ok) {
        throw new Error(json.error ?? "The staff command could not complete.");
      }
      if (json.data) onStaffUpdated(json.data);
      return json;
    } finally {
      setBusy(false);
    }
  };

  const handleOffboard = async () => {
    try {
      const json = await postCommand(`/api/admin/staff/${staff.id}/offboard`, {
        reason: reason.trim() || undefined,
        termination_date: terminationDate || undefined,
      });
      if (json.haven_access === "pending_sync") {
        toast.info("Employment ended. Sign-in synchronization may still be pending.");
      } else {
        toast.success("Staff member offboarded. History stays on file.");
      }
      setOffboardOpen(false);
      resetDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to offboard staff.");
    }
  };

  const handleRestore = async () => {
    try {
      const json = await postCommand(`/api/admin/staff/${staff.id}/reactivate`, {
        reason: reason.trim() || undefined,
      });
      toast.success(havenRestoreCopy(json.haven_access));
      setRestoreOpen(false);
      resetDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore employment.");
    }
  };

  return (
    <>
      <RecordDetailSection
        title="Offboard"
        description={
          inactive
            ? "Employment has ended. History, certifications, and time records stay on file."
            : "End employment without deleting history. Linked Haven sign-in is revoked."
        }
      >
        {inactive ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Status is {staff.employment_status.replace(/_/g, " ")}
              {staff.termination_date ? ` as of ${staff.termination_date}` : ""}.
              Physical access-control sync is flagged for the facility vendor follow-up.
            </p>
            <Button type="button" onClick={() => setRestoreOpen(true)}>
              Restore employment
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {staff.user_id
                ? "This profile is linked to a Haven login. Offboard revokes sign-in and facility grants."
                : "No Haven login is linked. Offboard ends employment and flags access-control follow-up."}
            </p>
            <Button type="button" variant="destructive" onClick={() => setOffboardOpen(true)}>
              Offboard
            </Button>
          </div>
        )}
      </RecordDetailSection>

      <Dialog
        open={offboardOpen}
        onOpenChange={(open) => {
          if (!busy) {
            setOffboardOpen(open);
            if (!open) resetDialog();
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Offboard {staff.first_name} {staff.last_name}?
            </DialogTitle>
            <DialogDescription>
              They lose Haven access immediately if a login is linked. Staff history is not deleted.
              Physical access-control revoke is flagged for the existing vendor follow-up.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="staff-offboard-date" className="text-sm font-medium">
                Last day (ET)
              </label>
              <Input
                id="staff-offboard-date"
                type="date"
                value={terminationDate}
                onChange={(e) => setTerminationDate(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="staff-offboard-reason" className="text-sm font-medium">
                Reason (optional)
              </label>
              <Input
                id="staff-offboard-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for leaving"
                disabled={busy}
              />
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOffboardOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleOffboard()} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                  Offboarding…
                </>
              ) : (
                "Confirm offboard"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={restoreOpen}
        onOpenChange={(open) => {
          if (!busy) {
            setRestoreOpen(open);
            if (!open) resetDialog();
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Restore {staff.first_name} {staff.last_name}?
            </DialogTitle>
            <DialogDescription>
              Returns this person to the active roster. Organization administrators also restore Haven
              sign-in for a linked login.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="staff-restore-reason" className="text-sm font-medium">
              Reason (optional)
            </label>
            <Input
              id="staff-restore-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for restore"
              disabled={busy}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setRestoreOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleRestore()} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                  Restoring…
                </>
              ) : (
                "Restore employment"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
