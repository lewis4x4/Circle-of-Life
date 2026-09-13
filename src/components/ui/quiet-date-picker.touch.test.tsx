import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { QuietDatePicker } from "./quiet-date-picker";

describe("QuietDatePicker touch workspace", () => {
  it("keeps an empty date empty and enlarges the portaled calendar controls", async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    render(
      <QuietDatePicker
        id="touch-date"
        value=""
        onValueChange={onValueChange}
        touchTargets
        initialVisibleMonthIso="2026-09-01"
      />,
    );
    const trigger = screen.getByTestId("touch-date-trigger");
    expect(trigger).toHaveClass("min-h-11");
    expect(onValueChange).not.toHaveBeenCalled();
    await user.click(trigger);
    expect(screen.getByRole("button", { name: "Previous month" })).toHaveClass(
      "size-11",
    );
    expect(screen.getByRole("button", { name: "Next month" })).toHaveClass(
      "size-11",
    );
    const days = within(
      screen.getByRole("group", { name: "Calendar days" }),
    ).getAllByRole("button");
    expect(days.length).toBeGreaterThanOrEqual(28);
    for (const day of days) expect(day).toHaveClass("size-11");
    const result = await axe.run(screen.getByRole("dialog"), {
      rules: {
        "color-contrast": { enabled: false },
        region: { enabled: false },
      },
    });
    expect(result.violations).toEqual([]);
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("retains existing compact controls unless the workspace opts in", () => {
    render(
      <QuietDatePicker id="compact-date" value="" onValueChange={() => {}} />,
    );
    expect(screen.getByTestId("compact-date-trigger")).not.toHaveClass(
      "min-h-11",
    );
  });

  it("renders and updates an existing controlled date without a render loop", async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <QuietDatePicker
        id="existing-date"
        value="2026-09-10"
        onValueChange={onValueChange}
        touchTargets
      />,
    );
    expect(screen.getByTestId("existing-date-trigger")).toHaveTextContent(
      "09 / 10 / 2026",
    );
    rerender(
      <QuietDatePicker
        id="existing-date"
        value="2026-10-15"
        onValueChange={onValueChange}
        touchTargets
      />,
    );
    expect(screen.getByTestId("existing-date-trigger")).toHaveTextContent(
      "10 / 15 / 2026",
    );
    await user.click(screen.getByTestId("existing-date-trigger"));
    expect(screen.getByText("October 2026")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "October 16, 2026" }));
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith("2026-10-16");
  });
});
