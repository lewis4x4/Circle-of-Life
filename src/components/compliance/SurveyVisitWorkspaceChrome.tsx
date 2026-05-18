"use client";

import React from "react";

import { SurveyVisitSessionDock } from "@/components/compliance/SurveyVisitSessionDock";
import type { SurveyVisitSessionApi } from "@/hooks/useSurveyVisitSession";

/** Expanded logging dock directly under the workspace header when session is active. */
export function SurveyVisitWorkspaceDock({ survey }: { survey: SurveyVisitSessionApi }) {
  const { facilityId, active, canLog, loadError, message } = survey;

  if (!facilityId) return null;

  return (
    <>
      {loadError ? (
        <div className="border-b border-border bg-background px-4 py-2">
          <p className="text-xs text-destructive" role="alert">
            {loadError}
          </p>
        </div>
      ) : null}
      {message ? (
        <div className="border-b border-border bg-background px-4 py-2">
          <p className="text-xs text-muted-foreground">{message}</p>
        </div>
      ) : null}
      {active && canLog ? (
        <div className="border-b border-border bg-amber-50/50 px-4 py-3 dark:bg-amber-950/20">
          <SurveyVisitSessionDock survey={survey} />
        </div>
      ) : null}
    </>
  );
}
