"use client";

import { Bell, LifeBuoy, Loader2, LogOut, UserCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { IdentityAvatar, IdentityBlock } from "@/components/ui/identity-block";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { HELP_DOCS_HREF, useOrganizationName } from "./user-menu-data";

export type UserMenuProps = {
  fullName: string | null;
  email: string | null;
  roleLabel: string;
  organizationId: string | null;
  avatarUrl: string | null;
  userId: string | null;
  signingOut: boolean;
  onSignOut: () => void | Promise<void>;
  triggerClassName?: string;
  contentSide?: "top" | "right" | "bottom" | "left";
  contentAlign?: "start" | "center" | "end";
  contentSideOffset?: number;
  triggerChildren?: ReactNode | ((orgName: string | null) => ReactNode);
};

export function UserMenu({
  fullName,
  email,
  roleLabel,
  organizationId,
  avatarUrl,
  userId,
  signingOut,
  onSignOut,
  triggerClassName,
  contentSide = "bottom",
  contentAlign = "end",
  contentSideOffset = 6,
  triggerChildren,
}: UserMenuProps) {
  const router = useRouter();
  const orgName = useOrganizationName(organizationId);
  const signedInAs = fullName?.trim() || email || "signed-in user";
  const renderedTriggerChildren =
    typeof triggerChildren === "function" ? triggerChildren(orgName) : triggerChildren;

  const navigateTo = (href: string) => {
    router.push(href);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Open account menu — signed in as ${signedInAs}`}
        className={cn(
          "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          triggerClassName,
        )}
      >
        {renderedTriggerChildren ?? (
          <IdentityAvatar
            fullName={fullName}
            email={email}
            avatarUrl={avatarUrl}
            userId={userId}
            size="md"
            className="size-9"
          />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={contentAlign}
        side={contentSide}
        sideOffset={contentSideOffset}
        className="w-[320px] overflow-hidden rounded-[var(--radius)] border border-border bg-popover p-0 shadow-[var(--shadow-card)] ring-1 ring-foreground/5"
      >
        <header className="border-b border-border bg-muted/30 px-3 py-3">
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

        <DropdownMenuGroup className="p-1">
          <DropdownMenuItem
            className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-foreground"
            onClick={() => navigateTo("/admin/profile")}
          >
            <UserCircle2 className="size-3.5 text-muted-foreground" aria-hidden />
            My profile
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-foreground"
            onClick={() => navigateTo("/admin/profile?tab=notifications")}
          >
            <Bell className="size-3.5 text-muted-foreground" aria-hidden />
            Notification preferences
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-foreground"
            onClick={() => navigateTo(HELP_DOCS_HREF)}
          >
            <LifeBuoy className="size-3.5 text-muted-foreground" aria-hidden />
            Help &amp; docs
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator className="my-0" />

        <DropdownMenuGroup className="p-1">
          <DropdownMenuItem
            variant="destructive"
            className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px]"
            disabled={signingOut}
            onClick={() => void onSignOut()}
            aria-description="Signs you out of Haven on this device"
          >
            {signingOut ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Signing out…
              </>
            ) : (
              <>
                <LogOut className="size-3.5" aria-hidden />
                Sign out
              </>
            )}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
