"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LifecycleRequestClient } from "@/lib/admin/lifecycle-request";
import { Loader2 } from "lucide-react";

interface UserDeactivateDialogProps {
  userId: string;
  userName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeactivated: () => void;
}

export function UserDeactivateDialog({
  userId,
  userName,
  open,
  onOpenChange,
  onDeactivated,
}: UserDeactivateDialogProps) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lifecycleClient = useRef(new LifecycleRequestClient(() => {}));

  const handleDeactivate = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await lifecycleClient.current.request(`/api/admin/users/${userId}`, {
        method: "DELETE",
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed to deactivate user");
      }
      if (res.status === 202) {
        toast.info("Access disabled. Sign-in synchronization may still be pending.");
      } else {
        toast.success(`${userName} deactivated.`);
      }
      setReason("");
      onOpenChange(false);
      onDeactivated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate user");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isSubmitting) {
          if (!next) setReason("");
          onOpenChange(next);
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Deactivate {userName}?</DialogTitle>
          <DialogDescription>
            They will lose Haven access immediately. Identity and history stay on file. An administrator can reactivate later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label htmlFor="row-deactivate-reason" className="text-sm font-medium">
            Reason (optional)
          </label>
          <Input
            id="row-deactivate-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for deactivation"
            disabled={isSubmitting}
          />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="min-h-11"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDeactivate}
            disabled={isSubmitting}
            className="min-h-11 gap-2"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Deactivate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
