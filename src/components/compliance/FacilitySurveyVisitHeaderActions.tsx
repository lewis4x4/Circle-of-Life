"use client";

import React from "react";
import { ClipboardList, Loader2, Power, PowerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SurveyVisitSessionApi } from "@/hooks/useSurveyVisitSession";

/** Compact survey session controls for facility detail header (global banner hidden on this route). */
export function FacilitySurveyVisitHeaderActions({ survey }: { survey: SurveyVisitSessionApi }) {
  const { facilityId, loading, busy, active, canManage, canLog, activateSession, deactivateSession } = survey;

  if (!facilityId) return null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span className="sr-only">Loading survey visit mode</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <ClipboardList className="h-4 w-4 shrink-0" aria-hidden />
        <span className="hidden text-[13px] sm:inline">Survey visit</span>
      </div>
      {canManage && (
        <>
          {!active ? (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void activateSession()}>
              <Power className="mr-1.5 h-4 w-4" />
              Activate
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void deactivateSession()}>
              <PowerOff className="mr-1.5 h-4 w-4" />
              End session
            </Button>
          )}
        </>
      )}
      {!canManage && active && canLog ? (
        <span className="text-[12px] font-medium text-amber-700 dark:text-amber-300">Survey mode active</span>
      ) : null}
    </div>
  );
}
