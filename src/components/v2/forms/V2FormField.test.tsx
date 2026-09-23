import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { axeViolations } from "@/test-utils/axe";

import { V2FormField } from "./V2FormField";

describe("V2FormField (COL-658)", () => {
  it("names its control and describes it with the hint", async () => {
    const { container } = render(
      <V2FormField id="resident" label="Resident" hint="Leave blank if not resident-specific">
        <select id="resident">
          <option value="">None</option>
        </select>
      </V2FormField>,
    );
    const select = screen.getByRole("combobox", { name: "Resident" });
    expect(select).toHaveAttribute("aria-describedby", "resident-hint");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("does not nest a checkbox row's own label inside another label", async () => {
    const { container } = render(
      <V2FormField id="injury" label="Injury">
        <label>
          <input type="checkbox" id="injury" /> Injury occurred
        </label>
      </V2FormField>,
    );
    expect(container.querySelector("label label")).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });
});
