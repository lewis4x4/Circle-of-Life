/**
 * UserCreateDialog — modal form for creating a new user.
 */

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UserRoleSelector } from "./UserRoleSelector";
import { FacilityAccessManager } from "./FacilityAccessManager";
import { UserTemporaryPasswordPanel } from "./UserTemporaryPasswordPanel";
import { X, Loader2, Mail, UserPlus, CheckCircle2 } from "lucide-react";

interface UserCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

type CreateSuccess = {
  invitation_sent: boolean;
  provision_method?: string;
  temporary_password?: string;
  email: string;
};

function provisionSummary(success: CreateSuccess): string {
  if (success.temporary_password) {
    return "Share the one-time password below. They must set a new password on first sign-in before using Haven.";
  }
  if (success.invitation_sent && success.provision_method === "password_reset_email") {
    return `Recovery email sent to ${success.email}. They can set a password from the link.`;
  }
  if (success.invitation_sent) {
    return `Invitation email sent to ${success.email}.`;
  }
  return "User created. Share sign-in instructions with them.";
}

export function UserCreateDialog({ open, onClose, onCreated }: UserCreateDialogProps) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [appRole, setAppRole] = useState("");
  const [facilityIds, setFacilityIds] = useState<string[]>([]);
  const [primaryFacilityId, setPrimaryFacilityId] = useState("");
  const [sendInvite, setSendInvite] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState<CreateSuccess | null>(null);

  if (!open) return null;

  const reset = () => {
    setEmail("");
    setFullName("");
    setPhone("");
    setJobTitle("");
    setAppRole("");
    setFacilityIds([]);
    setPrimaryFacilityId("");
    setSendInvite(true);
    setError(null);
    setSuccess(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const finishSuccess = () => {
    onCreated();
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email || !fullName || !appRole || facilityIds.length === 0) {
      setError("Please fill in all required fields");
      return;
    }

    setIsSubmitting(true);
    try {
      const effectivePrimary = primaryFacilityId || facilityIds[0] || "";
      const facilitiesPayload = facilityIds.map((fid) => ({
        facility_id: fid,
        is_primary: fid === effectivePrimary,
      }));

      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          full_name: fullName,
          ...(phone ? { phone } : {}),
          app_role: appRole,
          ...(jobTitle ? { job_title: jobTitle } : {}),
          send_invite: sendInvite,
          facilities: facilitiesPayload,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        if (json.profile_created && json.user_id) {
          throw new Error(
            `${json.error} (User ID: ${json.user_id}). Open them in the list to finish facility access.`,
          );
        }
        if (json.details?.fieldErrors) {
          const fieldMsgs = Object.entries(json.details.fieldErrors as Record<string, string[]>)
            .map(([k, v]) => `${k}: ${v.join(", ")}`)
            .join(" | ");
          if (fieldMsgs) throw new Error(`${json.error}: ${fieldMsgs}`);
        }
        throw new Error(json.error ?? "Failed to create user");
      }

      const result: CreateSuccess = {
        invitation_sent: Boolean(json.invitation_sent),
        provision_method: json.provision_method,
        temporary_password: json.temporary_password,
        email,
      };
      setSuccess(result);

      if (result.temporary_password) {
        toast.success("User created with a one-time sign-in password.");
      } else if (result.invitation_sent) {
        toast.success("User created and email sent.");
      } else {
        toast.success("User created.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      toast.error(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 " onClick={success ? undefined : handleClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-user-title"
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-[1.5rem] bg-background border shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b bg-background/95 ">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-teal-500" />
            <h2 id="create-user-title" className="text-lg font-semibold">
              {success ? "User ready" : "Add New User"}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close add user dialog"
            className="p-1 rounded-md hover:bg-muted transition-colors"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        {success ? (
          <div className="p-6 space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <p>{provisionSummary(success)}</p>
            </div>
            {success.temporary_password && (
              <UserTemporaryPasswordPanel password={success.temporary_password} />
            )}
            <div className="flex justify-end pt-2 border-t">
              <Button type="button" onClick={finishSuccess} className="min-h-11">
                {success.temporary_password ? "I've copied the password" : "Done"}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label htmlFor="new-user-email" className="text-sm font-medium">Email *</label>
                <Input
                  id="new-user-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@facility.com"
                  required
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="new-user-full-name" className="text-sm font-medium">Full Name *</label>
                <Input
                  id="new-user-full-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Jane Doe"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label htmlFor="new-user-phone" className="text-sm font-medium">Phone</label>
                <Input
                  id="new-user-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="new-user-job-title" className="text-sm font-medium">Job Title</label>
                <Input
                  id="new-user-job-title"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  placeholder="Med-Tech, Lead Cook, etc."
                />
              </div>
            </div>

            <UserRoleSelector id="new-user-role" value={appRole} onChange={setAppRole} />

            <FacilityAccessManager
              selected={facilityIds}
              onChange={setFacilityIds}
              primaryId={primaryFacilityId}
              onPrimaryChange={setPrimaryFacilityId}
            />

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sendInvite}
                onChange={(e) => setSendInvite(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              Send invitation email when possible
            </label>
            <p className="text-xs text-muted-foreground pl-6">
              If an Auth account already exists, Haven confirms email and may show a one-time password instead of claiming an invite was sent.
            </p>

            <div className="flex items-center justify-end gap-3 pt-4 border-t">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-sm rounded-lg border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
              >
                {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Create User
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
