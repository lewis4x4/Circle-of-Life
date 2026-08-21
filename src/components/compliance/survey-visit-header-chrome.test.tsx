import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FacilitySurveyVisitHeaderActions } from "./FacilitySurveyVisitHeaderActions";
import { SurveyVisitShellToggle } from "./SurveyVisitShellToggle";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SurveyVisitSessionApi } from "@/hooks/useSurveyVisitSession";
import {
  SURVEY_VISIT_CONTEXT_ARIA_LABEL,
  SURVEY_VISIT_FACILITY_HEADER_LABEL,
} from "@/lib/compliance/survey-visit-header-copy";

const ANON_FACILITY_ID = "00000000-0000-0000-0000-000000000099";

function makeSurvey(overrides: Partial<SurveyVisitSessionApi> = {}): SurveyVisitSessionApi {
  return {
    facilityId: ANON_FACILITY_ID,
    loading: false,
    busy: false,
    active: false,
    canManage: true,
    canLog: false,
    loadError: null,
    message: null,
    userId: "00000000-0000-0000-0000-000000000001",
    orgId: "00000000-0000-0000-0000-000000000002",
    activeSessionId: null,
    logDescription: "",
    setLogDescription: vi.fn(),
    activateSession: vi.fn(),
    deactivateSession: vi.fn(),
    submitLog: vi.fn(),
    refresh: vi.fn(),
    supabase: {} as SurveyVisitSessionApi["supabase"],
    ...overrides,
  };
}

function renderShellToggle(survey: SurveyVisitSessionApi) {
  return render(
    <TooltipProvider>
      <SurveyVisitShellToggle survey={survey} />
    </TooltipProvider>,
  );
}

describe("SurveyVisitShellToggle", () => {
  it("keeps the idle accessible name while survey visit context hydrates", () => {
    renderShellToggle(makeSurvey({ loading: true }));

    expect(screen.getByRole("button", { name: SURVEY_VISIT_CONTEXT_ARIA_LABEL })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /loading/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it("does not render session actions until hydration completes", () => {
    renderShellToggle(makeSurvey({ loading: true, canManage: true }));

    expect(screen.queryByRole("button", { name: "Survey" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End" })).not.toBeInTheDocument();
  });

  it("renders activate and deactivate controls once resolved", () => {
    const { rerender } = renderShellToggle(makeSurvey({ loading: false, active: false, canManage: true }));

    expect(screen.getByRole("button", { name: "Survey" })).toBeInTheDocument();

    rerender(
      <TooltipProvider>
        <SurveyVisitShellToggle survey={makeSurvey({ loading: false, active: true, canManage: true })} />
      </TooltipProvider>,
    );

    expect(screen.getByRole("button", { name: "End" })).toBeInTheDocument();
  });
});

describe("FacilitySurveyVisitHeaderActions", () => {
  it("keeps the idle accessible name while survey visit context hydrates", () => {
    render(<FacilitySurveyVisitHeaderActions survey={makeSurvey({ loading: true })} />);

    expect(screen.getByText(SURVEY_VISIT_CONTEXT_ARIA_LABEL, { selector: ".sr-only" })).toBeInTheDocument();
    expect(screen.getByText(SURVEY_VISIT_FACILITY_HEADER_LABEL)).toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it("does not render session actions until hydration completes", () => {
    render(<FacilitySurveyVisitHeaderActions survey={makeSurvey({ loading: true, canManage: true })} />);

    expect(screen.queryByRole("button", { name: "Activate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End session" })).not.toBeInTheDocument();
  });

  it("renders activate and end session controls once resolved", () => {
    const { rerender } = render(
      <FacilitySurveyVisitHeaderActions survey={makeSurvey({ loading: false, active: false, canManage: true })} />,
    );

    expect(screen.getByRole("button", { name: "Activate" })).toBeInTheDocument();

    rerender(
      <FacilitySurveyVisitHeaderActions survey={makeSurvey({ loading: false, active: true, canManage: true })} />,
    );

    expect(screen.getByRole("button", { name: "End session" })).toBeInTheDocument();
  });
});
