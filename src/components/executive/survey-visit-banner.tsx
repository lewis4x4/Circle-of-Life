"use client";

/**
 * Survey Visit Mode Banner
 *
 * Banner component for activating and managing survey visit mode.
 * Shows when survey mode is not active, and provides status when active.
 *
 * Quiet Operator treatment:
 * - Inactive: bg-warning/10 border-warning/30 — prompts activation during surveyor on site.
 * - Active: bg-success/10 border-success/30 — confirms live session.
 * No backdrop-blur. Semantic tokens throughout.
 */

import React from "react";
import { Zap, Clipboard, X, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSurveyModeStore, isSurveyModeActive } from "@/stores/survey-mode-store";

export interface SurveyVisitBannerProps {
  /** Additional CSS classes */
  className?: string;
}

/**
 * Survey visit mode banner with activation toggle
 */
export function SurveyVisitBanner({ className }: SurveyVisitBannerProps) {
  const { activeSession, deactivateSurveyMode } = useSurveyModeStore();
  const isActive = isSurveyModeActive();

  if (isActive && activeSession) {
    return (
      <div
        className={cn(
          "bg-success/10 border-y border-success/30",
          "px-4 sm:px-6 py-3 transition-all duration-[var(--motion-duration)]",
          className
        )}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-success/10">
              <CheckCircle className="w-4 h-4 text-success" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  Survey visit mode active
                </span>
                <span className="px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider bg-success/10 text-success rounded">
                  {activeSession.facilityName}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {activeSession.surveyorName && (
                  <>
                    Surveyor: <span className="font-medium">{activeSession.surveyorName}</span>
                    {activeSession.surveyorAgency && (
                      <span> ({activeSession.surveyorAgency})</span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={deactivateSurveyMode}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/80 rounded-[var(--radius)] transition-colors duration-[var(--motion-duration-micro)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="w-3.5 h-3.5" />
            Deactivate
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "bg-warning/10 border-y border-warning/30",
        "px-4 sm:px-6 py-3 transition-all duration-[var(--motion-duration)]",
        className
      )}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Clipboard className="w-4 h-4 text-warning" />
          <div>
            <div className="text-sm font-semibold text-foreground">
              Survey visit mode
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Activate when a surveyor is on site (one active session per facility).
            </div>
          </div>
        </div>

        {/* TODO: Activate button is a no-op today; wiring requires an
            activation modal to collect SurveySession (facility, surveyor,
            agency). Pre-existing gap (predates S4a re-skin) — track as a
            separate feature task, not a UI overhaul concern. */}
        <button className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/80 rounded-[var(--radius)] transition-colors duration-[var(--motion-duration-micro)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Zap className="w-3.5 h-3.5" />
          Activate
        </button>
      </div>
    </div>
  );
}

export default SurveyVisitBanner;
