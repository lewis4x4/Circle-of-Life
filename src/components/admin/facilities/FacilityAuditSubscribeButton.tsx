"use client";

import React, { useId, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface FacilityAuditSubscribeButtonProps {
  facilityId: string;
  facilityName: string | null | undefined;
}

/**
 * Scaffolded subscriptions UI — persists intent locally only until delivery infra ships.
 */
export function FacilityAuditSubscribeButton({ facilityId, facilityName }: FacilityAuditSubscribeButtonProps) {
  const [open, setOpen] = useState(false);
  const prefId = useId();

  function persistDraft(scope: string) {
    try {
      const key = `haven:facility-audit-subscribe:${facilityId}`;
      window.localStorage.setItem(
        key,
        JSON.stringify({
          facilityId,
          scope,
          updatedAt: new Date().toISOString(),
        }),
      );
    } catch {
      /* non-fatal */
    }
    setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-9 gap-1"
        aria-label="Subscribe to audit changes"
        onClick={() => setOpen(true)}
      >
        <Bell className="size-4" aria-hidden />
        Subscribe to changes
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Notify me when changes happen on this facility</DialogTitle>
            <DialogDescription>
              {facilityName ? (
                <span>
                  Channel delivery (email, in-app, Telegram) is not wired yet — this records your intent for{" "}
                  <span className="font-medium text-foreground">{facilityName}</span> in this browser only.
                </span>
              ) : (
                <span>Channel delivery is not wired yet — this records your intent in this browser only.</span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm text-foreground">
            <div className="space-y-1">
              <label className="text-[12px] font-medium text-muted-foreground" htmlFor={`${prefId}-scope`}>
                Scope
              </label>
              <select
                id={`${prefId}-scope`}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                defaultValue="all"
              >
                <option value="all">All changes</option>
                <option value="license">License changes only</option>
                <option value="rates">Rate changes only</option>
                <option value="vendors">Vendor edits only</option>
                <option value="custom">Custom filter (saved with future engine)</option>
              </select>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-[12px] font-medium text-muted-foreground">
                Channel
                <select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" defaultValue="email">
                  <option value="email">Email</option>
                  <option value="in_app">In-app</option>
                  <option value="telegram">Telegram (if configured)</option>
                </select>
              </label>
              <label className="space-y-1 text-[12px] font-medium text-muted-foreground">
                Cadence
                <select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground" defaultValue="immediate">
                  <option value="immediate">Immediate</option>
                  <option value="daily">Daily digest</option>
                </select>
              </label>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => persistDraft("all")}>
              Save intent (browser)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
