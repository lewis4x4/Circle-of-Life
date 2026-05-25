"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Loader2, Lock, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { IdentityAvatar, IdentityBlock } from "@/components/ui/identity-block";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";
import { cn } from "@/lib/utils";
import { useOrganizationName } from "@/components/layout/UserMenu/user-menu-data";

const PROFILE_TABS = [
  { value: "profile", label: "Profile" },
  { value: "notifications", label: "Notifications" },
  { value: "security", label: "Security" },
  { value: "sessions", label: "Sessions" },
  { value: "preferences", label: "Preferences" },
] as const;

type ProfileTabValue = (typeof PROFILE_TABS)[number]["value"];

function normalizeTab(value: string | null): ProfileTabValue {
  return PROFILE_TABS.some((tab) => tab.value === value) ? (value as ProfileTabValue) : "profile";
}

export default function AdminProfilePage() {
  const searchParams = useSearchParams();
  const activeTab = normalizeTab(searchParams.get("tab"));
  const {
    user,
    email,
    appRole,
    organizationId,
    fullName,
    avatarUrl,
    loading: authLoading,
    refresh,
  } = useHavenAuth();
  const orgName = useOrganizationName(organizationId);
  const roleConfig = useMemo(() => getRoleDashboardConfig(appRole), [appRole]);
  const [displayName, setDisplayName] = useState(fullName ?? "");
  const [saving, setSaving] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // P0-3: scope focus to THIS page's h1, not the first h1 globally (which would hijack the layout shell heading).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    setDisplayName(fullName ?? "");
  }, [fullName]);

  const trimmedDisplayName = displayName.trim();
  const initialDisplayName = fullName?.trim() ?? "";
  const hasChanges = trimmedDisplayName !== initialDisplayName;

  async function handleSave() {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: trimmedDisplayName || null }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Could not save profile.");
      }
      toast.success("Profile updated");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-4 rounded-[var(--radius)] border border-border bg-card p-5 shadow-[var(--shadow-card)] md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-semibold tracking-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            My profile
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Manage your account identity. Personal notification, security, sessions, and preference
            controls are staged here for the next profile phase.
          </p>
        </div>
        <IdentityBlock
          fullName={fullName}
          email={email}
          roleLabel={roleConfig.roleLabel}
          orgName={orgName}
          avatarUrl={avatarUrl}
          userId={user?.id ?? null}
          size="lg"
          className="w-full rounded-[var(--radius)] border border-border bg-muted/30 p-3 md:w-[320px]"
        />
      </header>

      {/* P0-7 + ROAD-28: stub tabs render as disabled <button> with "Soon" badge — still in tablist for ARIA, no navigation. */}
      <nav
        role="tablist"
        aria-label="Profile sections"
        className="inline-flex h-9 w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-muted/50 p-1"
      >
        {PROFILE_TABS.map((tab) => {
          const active = activeTab === tab.value;
          const isStub = tab.value !== "profile";
          const href = tab.value === "profile" ? "/admin/profile" : `/admin/profile?tab=${tab.value}`;
          const className = cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium",
            "transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
            active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            isStub && "cursor-not-allowed opacity-70",
          );
          const soonBadge = isStub ? (
            <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Soon
            </span>
          ) : null;
          if (isStub) {
            return (
              <button
                key={tab.value}
                type="button"
                id={`profile-tab-${tab.value}`}
                role="tab"
                aria-selected={false}
                aria-controls="profile-tabpanel"
                aria-disabled={true}
                disabled
                tabIndex={-1}
                data-state="inactive"
                className={className}
              >
                {tab.label}
                {soonBadge}
              </button>
            );
          }
          return (
            <Link
              key={tab.value}
              href={href}
              id={`profile-tab-${tab.value}`}
              role="tab"
              aria-selected={active}
              aria-controls="profile-tabpanel"
              aria-current={active ? "page" : undefined}
              tabIndex={active ? 0 : -1}
              data-state={active ? "active" : "inactive"}
              className={className}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {/* P0-7: tabpanel shell — single panel labelled by the active tab; tabIndex=0 so screen readers can land here. */}
      <section
        id="profile-tabpanel"
        role="tabpanel"
        aria-labelledby={`profile-tab-${activeTab}`}
        tabIndex={0}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-[var(--radius)]"
      >
      {activeTab === "profile" ? (
        <Card size="lg">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Update the name displayed across Haven.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-[160px_1fr]">
            <div className="space-y-3">
              <Label>Avatar</Label>
              {/* P1 #16: drop fake role=button + tabIndex=0 on a disabled affordance; tooltip can still trigger on hover/focus of a non-interactive wrapper. */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <div
                      aria-label="Avatar upload coming soon"
                      className="group relative flex size-[120px] cursor-not-allowed items-center justify-center overflow-hidden rounded-full border border-dashed border-border bg-muted/30 text-muted-foreground outline-none"
                    />
                  }
                >
                  <IdentityAvatar
                    fullName={displayName || fullName}
                    email={email}
                    avatarUrl={avatarUrl}
                    userId={user?.id ?? null}
                    size="xl"
                    className="size-[120px]"
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-background/70 opacity-0 transition-opacity group-hover:opacity-100">
                    <Camera className="size-5" aria-hidden />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">Avatar upload coming soon</TooltipContent>
              </Tooltip>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <UploadCloud className="size-3.5" aria-hidden />
                Drag-and-drop upload coming soon
              </div>
            </div>

            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="display-name">Display name</Label>
                <Input
                  id="display-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder={email ?? "Your name"}
                  disabled={authLoading || saving}
                  maxLength={120}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="profile-email">Email</Label>
                <Input id="profile-email" value={email ?? ""} readOnly disabled />
              </div>

              <div className="grid gap-2">
                <Label>Role</Label>
                {/* ROAD-31: read-only badge instead of fake disabled input — communicates "computed metadata". */}
                <div className="flex items-center gap-2 py-1">
                  <Badge variant="default">{roleConfig.roleLabel}</Badge>
                  <span className="text-[11px] text-muted-foreground">Assigned by your org admin</span>
                </div>
              </div>

              {/* ROAD-30: hide entirely when orgName is genuinely missing; render only when known. */}
              {orgName ? (
                <div className="grid gap-2">
                  <Label htmlFor="profile-organization">Organization</Label>
                  <Input id="profile-organization" value={orgName} readOnly disabled />
                </div>
              ) : null}
            </div>
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDisplayName(fullName ?? "")}
              disabled={saving || !hasChanges}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={saving || authLoading || !hasChanges}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{PROFILE_TABS.find((tab) => tab.value === activeTab)?.label}</CardTitle>
            <CardDescription>This profile section is planned for the next phase.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 rounded-[var(--radius)] border border-dashed border-border bg-muted/30 p-5 text-sm text-muted-foreground">
              <Lock className="size-4" aria-hidden />
              Coming soon
            </div>
          </CardContent>
        </Card>
      )}
      </section>
    </div>
  );
}
