"use client";

import React from "react";
import { SurveyVisitSearchOverlay } from "@/components/compliance/SurveyVisitSearchOverlay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SurveyVisitSessionApi } from "@/hooks/useSurveyVisitSession";

/** Expanded survey tooling (record search + free-text log) when a session is active. */
export function SurveyVisitSessionDock({ survey }: { survey: SurveyVisitSessionApi }) {
  const {
    facilityId,
    activeSessionId,
    orgId,
    userId,
    active,
    canLog,
    busy,
    logDescription,
    setLogDescription,
    submitLog,
    supabase,
  } = survey;

  return (
    <>
      {active && canLog && userId && orgId && activeSessionId && facilityId ? (
        <>
          <SurveyVisitSearchOverlay
            supabase={supabase}
            sessionId={activeSessionId}
            facilityId={facilityId}
            organizationId={orgId}
            userId={userId}
          />
          <div className="mx-auto mt-3 flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400" htmlFor="survey-log-desc-inline">
                Other access (free text)
              </label>
              <Input
                id="survey-log-desc-inline"
                value={logDescription}
                onChange={(e) => setLogDescription(e.target.value)}
                placeholder="e.g. Policy binder — infection control"
                className="dark:bg-slate-900"
              />
            </div>
            <Button type="button" size="sm" disabled={busy} onClick={() => void submitLog()}>
              Log other
            </Button>
          </div>
        </>
      ) : null}
    </>
  );
}
