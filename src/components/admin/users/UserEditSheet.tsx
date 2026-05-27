/**
 * UserEditSheet — slide-over panel for editing a user.
 * Tabs: Profile, Role, Facilities, Audit, Danger Zone.
 */

"use client";

import { useState, useEffect, useCallback, type ElementType } from "react";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserRoleSelector } from "./UserRoleSelector";
import { FacilityAccessManager } from "./FacilityAccessManager";
import { UserStatusBadge } from "./UserStatusBadge";
import { ROLE_LABELS } from "@/lib/rbac";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  Check,
  Clock,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Shield,
  User,
  X,
} from "lucide-react";

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

const TABS: { key: Tab; label: string; icon: ElementType }[] = [
  { key: "profile", label: "Profile", icon: User },
  { key: "role", label: "Role", icon: Shield },
  { key: "facilities", label: "Facilities", icon: Building2 },
  { key: "audit", label: "Audit", icon: Clock },
  { key: "danger", label: "Danger Zone", icon: AlertTriangle },
];

function ErrorAlert({ children, className }: { children: string; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive",
        className,
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

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
  const [showTemporaryPassword, setShowTemporaryPassword] = useState(false);
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

  const resetTemporaryPasswordState = () => {
    setTemporaryPassword(null);
    setShowTemporaryPassword(false);
    setCopiedTemporaryPassword(false);
  };

  const openResetPasswordDialog = () => {
    setResetPasswordMode("email");
    setResetPasswordError(null);
    resetTemporaryPasswordState();
    setShowResetPasswordDialog(true);
  };

  const closeResetPasswordDialog = () => {
    setShowResetPasswordDialog(false);
    setResetPasswordMode("email");
    setResetPasswordError(null);
    resetTemporaryPasswordState();
  };

  const handleResetPasswordDialogOpenChange = (open: boolean) => {
    if (open) {
      setShowResetPasswordDialog(true);
      return;
    }

    // The temp password is returned once. After generation, require the explicit
    // acknowledgement button so Escape/outside-click cannot discard it early.
    if (temporaryPassword) return;

    closeResetPasswordDialog();
  };

  const handleResetPassword = async () => {
    if (!user || temporaryPassword) return;
    setIsResettingPassword(true);
    setResetPasswordError(null);
    setShowTemporaryPassword(false);
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
      closeResetPasswordDialog();
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
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full max-w-2xl gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
        showCloseButton={false}
      >
        {/* Header */}
        <SheetHeader className="sticky top-0 z-10 flex-row items-center justify-between gap-4 border-b bg-card/95 px-6 py-4 text-left">
          <div className="min-w-0">
            <SheetTitle id="edit-user-title" className="truncate text-lg font-semibold">
              {user?.full_name ?? "Loading..."}
            </SheetTitle>
            <SheetDescription className="sr-only">Edit user profile, role, facility access, audit history, and account status.</SheetDescription>
            {user && (
              <div className="mt-1 flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                <span className="truncate">{user.email}</span>
                <UserStatusBadge is_active={user.is_active} deleted_at={user.deleted_at} />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close edit user sheet"
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as Tab)} className="gap-0">
          <TabsList
            variant="line"
            aria-label="Edit user sections"
            className="h-auto min-h-11 w-full flex-wrap justify-start gap-1 rounded-none border-b bg-card px-6 py-0"
          >
            {TABS.map(({ key, label, icon: Icon }) => (
              <TabsTrigger
                key={key}
                value={key}
                className="min-h-11 flex-none rounded-none px-3 py-2.5 text-sm font-medium data-active:text-primary data-active:after:bg-primary data-active:after:bottom-0"
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Content */}
          <div className="p-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
              </div>
            ) : error && !user ? (
              <ErrorAlert className="mx-auto max-w-md">{error}</ErrorAlert>
            ) : (
              <>
                <TabsContent value="profile" className="space-y-4">
                  {error && <ErrorAlert>{error}</ErrorAlert>}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                  <Button type="button" onClick={handleSaveProfile} disabled={isSaving} className="min-h-11">
                    {isSaving ? "Saving..." : "Save Changes"}
                  </Button>
                </TabsContent>

                <TabsContent value="role" className="space-y-4">
                  {error && <ErrorAlert>{error}</ErrorAlert>}
                  <div className="rounded-lg border bg-muted/50 px-4 py-3 text-sm">
                    Current role: <strong>{ROLE_LABELS[user?.app_role ?? ""] ?? user?.app_role}</strong>
                  </div>
                  <UserRoleSelector id="edit-user-role" value={appRole} onChange={setAppRole} />
                  <Button
                    type="button"
                    onClick={handleSaveRole}
                    disabled={isSaving || appRole === user?.app_role}
                    className="min-h-11"
                  >
                    {isSaving ? "Saving..." : "Change Role"}
                  </Button>
                </TabsContent>

                <TabsContent value="facilities">
                  <FacilityAccessManager
                    selected={facilityIds}
                    onChange={setFacilityIds}
                    primaryId={primaryFacilityId}
                    onPrimaryChange={setPrimaryFacilityId}
                  />
                </TabsContent>

                <TabsContent value="audit" className="space-y-3">
                  {auditEntries.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No audit entries found.</p>
                  ) : (
                    auditEntries.map((entry) => (
                      <div key={entry.id} className="space-y-1 rounded-lg border px-4 py-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium capitalize">{entry.action.replace(/_/g, " ")}</span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(entry.created_at).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          by {entry.acting_user.full_name} ({entry.acting_user.email})
                        </div>
                        {entry.reason && (
                          <div className="text-xs italic text-muted-foreground">"{entry.reason}"</div>
                        )}
                      </div>
                    ))
                  )}
                </TabsContent>

                <TabsContent value="danger" className="space-y-4">
                  {canResetPassword && (
                    <div className="space-y-3 rounded-lg border bg-card p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <h3 className="font-medium">Password reset</h3>
                          <p className="text-sm text-muted-foreground">
                            Send a recovery email or generate a one-time temporary password.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={openResetPasswordDialog}
                          className="min-h-11 gap-2"
                        >
                          <KeyRound className="h-4 w-4" aria-hidden="true" />
                          Reset password
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                    <h3 className="font-medium text-destructive">Danger Zone</h3>
                    {user?.deleted_at ? (
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-sm">This account is deactivated. Reactivate to restore access.</span>
                        <Button type="button" variant="default" onClick={handleReactivate} className="min-h-11">
                          Reactivate User
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-sm">Deactivate this user. They will lose access immediately.</span>
                        <Button type="button" variant="destructive" onClick={handleDelete} className="min-h-11">
                          Deactivate User
                        </Button>
                      </div>
                    )}
                  </div>
                </TabsContent>
              </>
            )}
          </div>
        </Tabs>
      </SheetContent>

      <Dialog open={showResetPasswordDialog} onOpenChange={handleResetPasswordDialogOpenChange}>
        <DialogContent className="max-w-lg" hideDefaultClose={Boolean(temporaryPassword)}>
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
                    Generate a random temporary password once. It stays hidden until explicitly revealed.
                  </span>
                </span>
              </label>
            </div>

            {resetPasswordError && <ErrorAlert>{resetPasswordError}</ErrorAlert>}

            {temporaryPassword && (
              <div className="space-y-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
                <p className="text-sm font-medium text-warning">
                  This password will not be shown again. Copy it now and close this dialog when finished.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    readOnly
                    type={showTemporaryPassword ? "text" : "password"}
                    value={temporaryPassword}
                    aria-label="Temporary password"
                    autoComplete="off"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    data-form-type="other"
                    className="min-h-11 min-w-0 flex-1 select-all font-mono text-sm"
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowTemporaryPassword((visible) => !visible)}
                    aria-label={showTemporaryPassword ? "Hide temporary password" : "Show temporary password"}
                    className="min-h-11 gap-1"
                  >
                    {showTemporaryPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                    {showTemporaryPassword ? "Hide" : "Show"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCopyTemporaryPassword}
                    aria-label="Copy temporary password to clipboard"
                    className="min-h-11 gap-1"
                  >
                    {copiedTemporaryPassword ? (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Copy className="h-4 w-4" aria-hidden="true" />
                    )}
                    {copiedTemporaryPassword ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            {temporaryPassword ? (
              <Button type="button" onClick={closeResetPasswordDialog} className="min-h-11">
                I&apos;ve copied it
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeResetPasswordDialog}
                  disabled={isResettingPassword}
                  className="min-h-11"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleResetPassword}
                  disabled={isResettingPassword}
                  className="min-h-11 gap-2"
                >
                  {isResettingPassword && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {resetPasswordMode === "email" ? "Send reset email" : "Generate temporary password"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}
