"use client";

/**
 * Survey Visit Mode Banner
 *
 * Banner component for activating and managing survey visit mode.
 * Shows when survey mode is not active, and provides status when active.
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
          "bg-emerald-900/30 border-y border-emerald-500/20 backdrop-blur-md",
          "px-4 sm:px-6 py-3 transition-all duration-300",
          className
        )}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/20">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-emerald-300">
                  Survey visit mode active
                </span>
                <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider bg-emerald-500/20 text-emerald-300 rounded">
                  {activeSession.facilityName}
                </span>
              </div>
              <div className="text-xs text-emerald-400/80 mt-0.5">
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
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-400 rounded-lg transition-colors duration-200"
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
        "bg-slate-900/70 border-y border-white/5 backdrop-blur-md",
        "px-4 sm:px-6 py-3 transition-all duration-300",
        className
      )}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Clipboard className="w-4 h-4 text-slate-400" />
          <div>
            <div className="text-sm font-semibold text-slate-200">
              Survey visit mode
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              Activate when a surveyor is on site (one active session per facility).
            </div>
          </div>
        </div>

        <button className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-900 bg-white hover:bg-slate-100 rounded-lg transition-colors duration-200">
          <Zap className="w-3.5 h-3.5" />
          Activate
        </button>
      </div>
    </div>
  );
}

export default SurveyVisitBanner;
