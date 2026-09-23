import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { ReportWhoStep } from "./ReportWhoStep";

it("says nobody is on the facility's roster when the report flow has no residents (COL-670)", () => {
  render(
    <ReportWhoStep
      facilityName="Oakridge ALF"
      myResidents={[]}
      everyone={[]}
      loading={false}
      onPickResident={vi.fn()}
      onNoResident={vi.fn()}
    />,
  );
  expect(screen.getByText("No residents are on the roster for Oakridge ALF yet.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /No resident, the building/ })).toBeInTheDocument();
});
