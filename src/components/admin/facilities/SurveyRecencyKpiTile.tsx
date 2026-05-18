"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { daysSinceLastSurvey, surveyRecencyTileCopy } from "@/lib/admin/facilities/survey-recency-kpi";

export function SurveyRecencyKpiTile({ lastSurveyDate }: { lastSurveyDate: string | null | undefined }) {
  const copy = surveyRecencyTileCopy(daysSinceLastSurvey(lastSurveyDate));

  return (
    <div className="rounded-[8px] border border-border bg-muted/10 p-5">
      <p className="text-[13px] text-muted-foreground">{copy.title}</p>
      <p className={cn("mt-2 text-3xl font-semibold tabular-nums", copy.valueClass)}>{copy.valueLine}</p>
      {copy.footnote ? <p className="mt-1 text-[12px] text-muted-foreground">{copy.footnote}</p> : null}
    </div>
  );
}
