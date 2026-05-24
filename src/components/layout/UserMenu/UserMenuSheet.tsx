"use client";

import { Bell, ChevronRight, LifeBuoy, Loader2, LogOut, UserCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ComponentType, type ReactNode } from "react";
import { IdentityAvatar, IdentityBlock } from "@/components/ui/identity-block";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { HELP_DOCS_HREF, useOrganizationName } from "./user-menu-data";

export type UserMenuSheetProps = {
  fullName: string | null;
  email: string | null;
  roleLabel: string;
  organizationId: string | null;
  avatarUrl: string | null;
  userId: string | null;
  signingOut: boolean;
  onSignOut: () => void | Promise<void>;
  triggerClassName?: string;
};

type SheetMenuItemProps = {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
  trailing?: ReactNode;
};

function SheetMenuItem({ icon: Icon, label, onSelect, destructive, disabled, trailing }: SheetMenuItemProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex min-h-12 w-full items-center gap-3 rounded-md px-4 text-left text-[14px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        destructive ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-muted/50",
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing ?? <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
    </button>
  );
}

export function UserMenuSheet({
  fullName,
  email,
  roleLabel,
  organizationId,
  avatarUrl,
  userId,
  signingOut,
  onSignOut,
  triggerClassName,
}: UserMenuSheetProps) {
  const router = useRouter();
  const orgName = useOrganizationName(organizationId);
  const [open, setOpen] = useState(false);
  const signedInAs = fullName?.trim() || email || "signed-in user";

  const navigateTo = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const handleSignOut = () => {
    setOpen(false);
    void onSignOut();
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label={`Open account menu — signed in as ${signedInAs}`}
        className={cn(
          "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          triggerClassName,
        )}
      >
        <IdentityAvatar
          fullName={fullName}
          email={email}
          avatarUrl={avatarUrl}
          userId={userId}
          size="md"
          className="size-9"
        />
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] rounded-t-[14px] border-t border-border bg-card p-0"
        showCloseButton
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Account menu</SheetTitle>
        </SheetHeader>

        <header className="border-b border-border bg-muted/30 px-4 py-4">
          <IdentityBlock
            fullName={fullName}
            email={email}
            roleLabel={roleLabel}
            orgName={orgName}
            avatarUrl={avatarUrl}
            userId={userId}
            size="lg"
          />
        </header>

        <nav aria-label="Account actions" className="space-y-1 px-2 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <SheetMenuItem
            icon={UserCircle2}
            label="My profile"
            onSelect={() => navigateTo("/admin/profile")}
          />
          <SheetMenuItem
            icon={Bell}
            label="Notification preferences"
            onSelect={() => navigateTo("/admin/profile?tab=notifications")}
          />
          <SheetMenuItem
            icon={LifeBuoy}
            label="Help & docs"
            onSelect={() => navigateTo(HELP_DOCS_HREF)}
          />
          <div className="my-2 h-px bg-border" />
          <SheetMenuItem
            icon={signingOut ? Loader2 : LogOut}
            label={signingOut ? "Signing out…" : "Sign out"}
            onSelect={handleSignOut}
            destructive
            disabled={signingOut}
            trailing={null}
          />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
