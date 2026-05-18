"use client";

import React from "react";
import { ClipboardList, Loader2, Power, PowerOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SurveyVisitSessionApi } from "@/hooks/useSurveyVisitSession";

/** Compact survey session controls in the global admin header (facility-scoped via parent shell hook). */
export function SurveyVisitShellToggle({ survey }: { survey: SurveyVisitSessionApi }) {
  const {
    facilityId: selectedFacilityId,
    loading,
    busy,
    active,
    canManage,
    canLog,
    activateSession,
    deactivateSession,
  } = survey;

  if (!selectedFacilityId) {
    return null;
  }

  if (loading) {
    return (
      <Tooltip>
        <TooltipTrigger
          type="button"
          className="grid size-8 place-items-center rounded-md text-muted-foreground"
          aria-label="Loading survey visit mode"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
        </TooltipTrigger>
        <TooltipContent side="bottom">Survey visit mode…</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger
          type="button"
          className="grid size-8 place-items-center rounded-md text-muted-foreground"
          aria-label="Survey visit context"
        >
          <ClipboardList className="size-4" aria-hidden />
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          Survey visit mode — activate when a surveyor is on site. When active, log chart pulls for the survey trail.
        </TooltipContent>
      </Tooltip>
      {canManage ? (
        !active ? (
          <Button type="button" size="sm" variant="outline" className="h-8 px-2 text-xs" disabled={busy} onClick={() => void activateSession()}>
            <Power className="mr-1 size-3.5" aria-hidden />
            Survey
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline" className="h-8 px-2 text-xs" disabled={busy} onClick={() => void deactivateSession()}>
            <PowerOff className="mr-1 size-3.5" aria-hidden />
            End
          </Button>
        )
      ) : active && canLog ? (
        <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">Active</span>
      ) : null}
    </div>
  );
}
