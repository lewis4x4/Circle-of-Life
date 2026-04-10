/**
 * UserCreateDialog — modal form for creating a new user.
 */

"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { UserRoleSelector } from "./UserRoleSelector";
import { FacilityAccessManager } from "./FacilityAccessManager";
import { X, Loader2, Mail, UserPlus } from "lucide-react";

interface UserCreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
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
  };

  const handleClose = () => {
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
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          full_name: fullName,
          phone: phone || undefined,
          app_role: appRole,
          job_title: jobTitle || undefined,
          send_invite: sendInvite,
          facilities: facilityIds.map((fid) => ({
            facility_id: fid,
            is_primary: fid === primaryFacilityId,
          })),
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to create user");
      }

      onCreated();
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />

      {/* Dialog */}
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-[1.5rem] bg-background border shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b bg-background/95 backdrop-blur">
          <div className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-teal-500" />
            <h2 className="text-lg font-semibold">Add New User</h2>
          </div>
          <button onClick={handleClose} className="p-1 rounded-md hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Email *</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@facility.com"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Full Name *</label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Doe"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Phone</label>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Job Title</label>
              <Input
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="Med-Tech, Lead Cook, etc."
              />
            </div>
          </div>

          <UserRoleSelector value={appRole} onChange={setAppRole} />

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
            Send invitation email
          </label>

          {/* Footer */}
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
      </div>
    </div>
  );
}
