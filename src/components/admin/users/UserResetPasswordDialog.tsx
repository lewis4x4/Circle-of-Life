"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserTemporaryPasswordPanel } from "./UserTemporaryPasswordPanel";

type ResetMode = "email" | "temp";

interface UserResetPasswordDialogProps {
  userId: string;
  userEmail: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserResetPasswordDialog({
  userId,
  userEmail,
  open,
  onOpenChange,
}: UserResetPasswordDialogProps) {
  const [mode, setMode] = useState<ResetMode>("email");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  const resetState = () => {
    setMode("email");
    setError(null);
    setTemporaryPassword(null);
    setIsSubmitting(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && temporaryPassword) {
      return;
    }
    if (!next) {
      resetState();
    }
    onOpenChange(next);
  };

  const handleSubmit = async () => {
    if (temporaryPassword) {
      resetState();
      onOpenChange(false);
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to reset password");
      }
      if (json.mode === "temp" && json.temporary_password) {
        setTemporaryPassword(json.temporary_password);
        return;
      }
      toast.success(`Recovery email sent to ${userEmail}`);
      resetState();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            {temporaryPassword
              ? "Share this one-time password securely. The user can sign in immediately."
              : `Choose how to reset access for ${userEmail}. Email recovery is the safer default.`}
          </DialogDescription>
        </DialogHeader>

        {!temporaryPassword && (
          <div className="space-y-3">
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
              <input
                type="radio"
                name="reset-password-mode"
                checked={mode === "email"}
                onChange={() => setMode("email")}
                disabled={isSubmitting}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium">Send recovery email</span>
                <span className="text-xs text-muted-foreground">User sets a new password from the link.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
              <input
                type="radio"
                name="reset-password-mode"
                checked={mode === "temp"}
                onChange={() => setMode("temp")}
                disabled={isSubmitting}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium">Generate temporary password</span>
                <span className="text-xs text-muted-foreground">Confirm email and show a one-time password.</span>
              </span>
            </label>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">{error}</p>
        )}

        {temporaryPassword && <UserTemporaryPasswordPanel password={temporaryPassword} />}

        <DialogFooter className="gap-2">
          {temporaryPassword ? (
            <Button type="button" onClick={handleSubmit} className="min-h-11">
              I&apos;ve copied it
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isSubmitting}
                className="min-h-11"
              >
                Cancel
              </Button>
              <Button type="button" onClick={handleSubmit} disabled={isSubmitting} className="min-h-11 gap-2">
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {mode === "email" ? "Send recovery email" : "Generate temporary password"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
