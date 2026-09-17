"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  SURVEY_PACK_SECTIONS,
  defaultSurveyPackRequest,
  surveyPackPrintHref,
  validateSurveyPackRequest,
  type SurveyPackSectionId,
} from "@/lib/registers/survey-pack";

/**
 * A range and a set of sections. The range defaults to the prior six months,
 * which is what a walk in survey usually asks for; nothing else is chosen on
 * the administrator's behalf.
 */
export function SurveyPackChooser() {
  const router = useRouter();
  const [request, setRequest] = useState(() => defaultSurveyPackRequest());
  const [problems, setProblems] = useState<string[]>([]);

  function toggleSection(id: SurveyPackSectionId, on: boolean) {
    const next = on
      ? [...request.sections, id]
      : request.sections.filter((section) => section !== id);
    setRequest({
      ...request,
      sections: SURVEY_PACK_SECTIONS.map((s) => s.id).filter((s) => next.includes(s)),
    });
  }

  function print() {
    const found = validateSurveyPackRequest(request);
    setProblems(found);
    if (found.length > 0) return;
    router.push(surveyPackPrintHref(request));
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="pack-from" className="text-xs text-muted-foreground">
            From
          </label>
          <input
            id="pack-from"
            type="date"
            value={request.from}
            onChange={(event) => setRequest({ ...request, from: event.target.value })}
            aria-invalid={problems.some((p) => p.includes("range")) || undefined}
            aria-describedby={problems.length > 0 ? "pack-problems" : undefined}
            className="h-10 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="pack-to" className="text-xs text-muted-foreground">
            To
          </label>
          <input
            id="pack-to"
            type="date"
            value={request.to}
            onChange={(event) => setRequest({ ...request, to: event.target.value })}
            aria-invalid={problems.some((p) => p.includes("range")) || undefined}
            aria-describedby={problems.length > 0 ? "pack-problems" : undefined}
            className="h-10 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          />
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">Sections</legend>
        {SURVEY_PACK_SECTIONS.map((section) => (
          <label key={section.id} className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={request.sections.includes(section.id)}
              onChange={(event) => toggleSection(section.id, event.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            {section.label}
          </label>
        ))}
        {request.sections.includes("register") ? (
          <label className="ml-6 flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={request.includeHolds}
              onChange={(event) => setRequest({ ...request, includeHolds: event.target.checked })}
              className="h-4 w-4 rounded border-input"
            />
            Include bed holds in the register
          </label>
        ) : null}
      </fieldset>

      {problems.length > 0 ? (
        <ul id="pack-problems" className="space-y-1 text-sm text-destructive">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}

      <Button type="button" onClick={print}>
        Print
      </Button>
    </div>
  );
}
