/**
 * UserEditSheet — slide-over panel for editing a user.
 * Tabs: Profile, Role, Facilities, Audit, Danger Zone.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserRoleSelector } from "./UserRoleSelector";
import { FacilityAccessManager } from "./FacilityAccessManager";
import { UserStatusBadge } from "./UserStatusBadge";
import { ROLE_LABELS } from "@/lib/rbac";
import { useAuth } from "@/hooks/useAuth";
import { X, Loader2, User, Shield, Building2, Clock, AlertTriangle, KeyRound, Copy, Check } from "lucide-react";

interface UserEditSheetProps {
  userId: string;
  onClose: () => void;
}

type Tab = "profile" | "role" | "facilities" | "audit" | "danger";
type ResetPasswordMode = "email" | "temp";

interface UserData {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  app_role: string;
  job_title: string | null;
  avatar_url: string | null;
  is_active: boolean;
  deleted_at: string | null;
  last_login_at: string | null;
  manager_user_id: string | null;
  facilities: Array<{
    id: string;
    facility_id: string;
    facility_name: string;
    is_primary: boolean;
  }>;
}

interface AuditEntry {
  id: string;
  action: string;
  acting_user: { email: string; full_name: string };
  changes: { before: Record<string, unknown>; after: Record<string, unknown> };
  reason: string | null;
  created_at: string;
}

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "profile", label: "Profile", icon: User },
  { key: "role", label: "Role", icon: Shield },
  { key: "facilities", label: "Facilities", icon: Building2 },
  { key: "audit", label: "Audit", icon: Clock },
  { key: "danger", label: "Danger Zone", icon: AlertTriangle },
];

export function UserEditSheet({ userId, onClose }: UserEditSheetProps) {
  const { user: currentUser } = useAuth();
  const currentRole = (currentUser?.app_metadata?.app_role as string) ?? "";
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [user, setUser] = useState<UserData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showResetPasswordDialog, setShowResetPasswordDialog] = useState(false);
  const [resetPasswordMode, setResetPasswordMode] = useState<ResetPasswordMode>("email");
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [resetPasswordError, setResetPasswordError] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [copiedTemporaryPassword, setCopiedTemporaryPassword] = useState(false);

  // Editable fields
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [appRole, setAppRole] = useState("");
  const [facilityIds, setFacilityIds] = useState<string[]>([]);
  const [primaryFacilityId, setPrimaryFacilityId] = useState("");

  // Audit
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);

  const canResetPassword = Boolean(
    user &&
      !user.deleted_at &&
      currentUser?.id !== user.id &&
      ["owner", "org_admin"].includes(currentRole),
  );

  // Fetch user
  const fetchUser = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`);
      if (!res.ok) throw new Error("Failed to fetch user");
      const json = await res.json();
      const data = json.data as UserData;
      setUser(data);
      setFullName(data.full_name);
      setPhone(data.phone ?? "");
      setJobTitle(data.job_title ?? "");
      setAppRole(data.app_role);
      setFacilityIds(data.facilities.map((f) => f.facility_id));
      const primary = data.facilities.find((f) => f.is_primary);
      setPrimaryFacilityId(primary?.facility_id ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load user");
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  // Fetch audit entries
  useEffect(() => {
    if (activeTab !== "audit") return;
    fetch(`/api/admin/users/${userId}/audit?page_size=50`)
      .then((r) => r.json())
      .then((json) => setAuditEntries(json.data ?? []))
      .catch(() => setAuditEntries([]));
  }, [activeTab, userId]);

  // Save profile
  const handleSaveProfile = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName,
          phone: phone || null,
          job_title: jobTitle || null,
        }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to update");
      }
      await fetchUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  // Save role
  const handleSaveRole = async () => {
    if (!appRole || appRole === user?.app_role) return;
    if (!confirm(`Change role to ${ROLE_LABELS[appRole] ?? appRole}? This affects their access immediately.`)) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_role: appRole }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to update role");
      }
      await fetchUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save role");
    } finally {
      setIsSaving(false);
    }
  };

  // Delete / Reactivate
  const handleDelete = async () => {
    const reason = prompt("Reason for deactivation (optional):");
    if (reason === null) return;
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || undefined }),
      });
      if (!res.ok) throw new Error("Failed to deactivate");
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to deactivate");
    }
  };

  const handleReactivate = async () => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/reactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Reactivated via admin UI" }),
      });
      if (!res.ok) throw new Error("Failed to reactivate");
      await fetchUser();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to reactivate");
    }
  };

  const openResetPasswordDialog = () => {
    setResetPasswordMode("email");
    setResetPasswordError(null);
    setTemporaryPassword(null);
    setCopiedTemporaryPassword(false);
    setShowResetPasswordDialog(true);
  };

  const handleResetPasswordDialogOpenChange = (open: boolean) => {
    setShowResetPasswordDialog(open);
    if (!open) {
      setResetPasswordMode("email");
      setResetPasswordError(null);
      setTemporaryPassword(null);
      setCopiedTemporaryPassword(false);
    }
  };

  const handleResetPassword = async () => {
    if (!user || temporaryPassword) return;
    setIsResettingPassword(true);
    setResetPasswordError(null);
    setCopiedTemporaryPassword(false);
    try {
      const res = await fetch(`/api/admin/users/${userId}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: resetPasswordMode }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to reset password");
      }
      if (json.mode === "temp") {
        setTemporaryPassword(json.temporary_password ?? null);
        return;
      }
      toast.success(`Reset email sent to ${user.email}`);
      handleResetPasswordDialogOpenChange(false);
    } catch (err) {
      setResetPasswordError(err instanceof Error ? err.message : "Failed to reset password");
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleCopyTemporaryPassword = async () => {
    if (!temporaryPassword) return;
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopiedTemporaryPassword(true);
      toast.success("Temporary password copied.");
    } catch {
      setResetPasswordError("Could not copy password. Select and copy it manually.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 " onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-user-title"
        className="relative w-full max-w-2xl h-full overflow-y-auto bg-background border-l shadow-2xl"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b bg-background/95 ">
          <div className="flex items-center gap-3">
            <div>
              <h2 id="edit-user-title" className="text-lg font-semibold">{user?.full_name ?? "Loading..."}</h2>
              {user && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{user.email}</span>
                  <UserStatusBadge is_active={user.is_active} deleted_at={user.deleted_at} />
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close edit user sheet"
            className="p-1 rounded-md hover:bg-muted transition-colors"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b px-6">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === key
                  ? "border-teal-500 text-teal-600"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error && !user ? (
            <div className="text-center py-12 text-destructive">{error}</div>
          ) : (
            <>
              {activeTab === "profile" && (
                <div className="space-y-4">
                  {error && <div className="text-sm text-destructive">{error}</div>}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label htmlFor="edit-user-full-name" className="text-sm font-medium">Full Name</label>
                      <Input id="edit-user-full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="edit-user-phone" className="text-sm font-medium">Phone</label>
                      <Input id="edit-user-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="edit-user-job-title" className="text-sm font-medium">Job Title</label>
                    <Input id="edit-user-job-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
                  </div>
                  <button
                    onClick={handleSaveProfile}
                    disabled={isSaving}
                    className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50"
                  >
                    {isSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              )}

              {activeTab === "role" && (
                <div className="space-y-4">
                  {error && <div className="text-sm text-destructive">{error}</div>}
                  <div className="rounded-lg border px-4 py-3 bg-muted/50 text-sm">
                    Current role: <strong>{ROLE_LABELS[user?.app_role ?? ""] ?? user?.app_role}</strong>
                  </div>
                  <UserRoleSelector id="edit-user-role" value={appRole} onChange={setAppRole} />
                  <button
                    onClick={handleSaveRole}
                    disabled={isSaving || appRole === user?.app_role}
                    className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50"
                  >
                    {isSaving ? "Saving..." : "Change Role"}
                  </button>
                </div>
              )}

              {activeTab === "facilities" && (
                <FacilityAccessManager
                  selected={facilityIds}
                  onChange={setFacilityIds}
                  primaryId={primaryFacilityId}
                  onPrimaryChange={setPrimaryFacilityId}
                />
              )}

              {activeTab === "audit" && (
                <div className="space-y-3">
                  {auditEntries.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No audit entries found.</p>
                  ) : (
                    auditEntries.map((entry) => (
                      <div key={entry.id} className="rounded-lg border px-4 py-3 text-sm space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium capitalize">{entry.action.replace(/_/g, " ")}</span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(entry.created_at).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          by {entry.acting_user.full_name} ({entry.acting_user.email})
                        </div>
                        {entry.reason && (
                          <div className="text-xs italic text-muted-foreground">&quot;{entry.reason}&quot;</div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === "danger" && (
                <div className="space-y-4">
                  {canResetPassword && (
                    <div className="rounded-lg border bg-card p-4 space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h3 className="font-medium">Password reset</h3>
                          <p className="text-sm text-muted-foreground">
                            Send a recovery email or generate a one-time temporary password.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={openResetPasswordDialog}
                          className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                        >
                          <KeyRound className="h-4 w-4" />
                          Reset password
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
                    <h3 className="font-medium text-destructive">Danger Zone</h3>
                    {user?.deleted_at ? (
                      <div className="flex items-center justify-between">
                        <span className="text-sm">This account is deactivated. Reactivate to restore access.</span>
                        <button
                          onClick={handleReactivate}
                          className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"
                        >
                          Reactivate User
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Deactivate this user. They will lose access immediately.</span>
                        <button
                          onClick={handleDelete}
                          className="px-4 py-2 text-sm font-medium text-white bg-destructive rounded-lg hover:bg-destructive/90"
                        >
                          Deactivate User
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Dialog open={showResetPasswordDialog} onOpenChange={handleResetPasswordDialogOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              Choose how to reset {user?.email ?? "this user's"} password. Email reset is the safer default.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3">
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/50">
                <input
                  type="radio"
                  name="reset-password-mode"
                  value="email"
                  checked={resetPasswordMode === "email"}
                  onChange={() => setResetPasswordMode("email")}
                  disabled={isResettingPassword || Boolean(temporaryPassword)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">Email reset link</span>
                  <span className="block text-sm text-muted-foreground">
                    Supabase sends the user a recovery link. No password is shown to the admin.
                  </span>
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/50">
                <input
                  type="radio"
                  name="reset-password-mode"
                  value="temp"
                  checked={resetPasswordMode === "temp"}
                  onChange={() => setResetPasswordMode("temp")}
                  disabled={isResettingPassword || Boolean(temporaryPassword)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">Generate one-time temporary password</span>
                  <span className="block text-sm text-muted-foreground">
                    Show a random temporary password once so the admin can copy it for the user.
                  </span>
                </span>
              </label>
            </div>

            {resetPasswordError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {resetPasswordError}
              </div>
            )}

            {temporaryPassword && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-3">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                  This password will not be shown again. Copy it now.
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 select-all break-all rounded-md bg-background px-3 py-2 text-sm">
                    {temporaryPassword}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyTemporaryPassword}
                    className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"
                  >
                    {copiedTemporaryPassword ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copiedTemporaryPassword ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            {temporaryPassword ? (
              <button
                type="button"
                onClick={() => handleResetPasswordDialogOpenChange(false)}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                I&apos;ve copied it
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => handleResetPasswordDialogOpenChange(false)}
                  disabled={isResettingPassword}
                  className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleResetPassword}
                  disabled={isResettingPassword}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {isResettingPassword && <Loader2 className="h-4 w-4 animate-spin" />}
                  {resetPasswordMode === "email" ? "Send reset email" : "Generate temporary password"}
                </button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
