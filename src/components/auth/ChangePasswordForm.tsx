"use client";

import { useState, type FormEvent } from "react";
import { Loader2, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface ChangePasswordFormProps {
  forced?: boolean;
  onSuccess?: () => void | Promise<void>;
}

export function ChangePasswordForm({ forced = false, onSuccess }: ChangePasswordFormProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/account/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
          confirm_password: confirmPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const detail =
          json.details?.fieldErrors &&
          Object.values(json.details.fieldErrors as Record<string, string[]>)
            .flat()
            .join(" ");
        throw new Error(detail || json.error || "Could not update password");
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {forced && (
        <p className="text-sm text-muted-foreground">
          Your administrator issued a one-time password. Choose a new password before continuing in Haven.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor="change-password-current">Current password</Label>
        <Input
          id="change-password-current"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="change-password-new">New password</Label>
        <Input
          id="change-password-new"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="change-password-confirm">Confirm new password</Label>
        <Input
          id="change-password-confirm"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={8}
        />
      </div>
      <Button type="submit" disabled={pending} className="min-h-11 w-full gap-2">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
        {forced ? "Set password and continue" : "Update password"}
      </Button>
    </form>
  );
}
