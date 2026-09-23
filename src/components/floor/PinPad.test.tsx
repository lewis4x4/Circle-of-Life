import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PinPad } from "./PinPad";

function renderPad(onUnlock = vi.fn()) {
  render(<PinPad header={<span>Ashley W.</span>} helper="Same PIN you use at the front door." error={null} onUnlock={onUnlock} />);
  return onUnlock;
}

const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const dots = () => screen.getByRole("img", { name: /digits entered/ });

describe("PinPad", () => {
  it("shows Unlock only once all six digits are in", () => {
    const onUnlock = renderPad();
    for (const digit of ["1", "2", "3", "4", "5"]) press(`Digit ${digit}`);
    expect(screen.queryByRole("button", { name: /^Unlock$/ })).toBeNull();
    expect(dots()).toHaveAccessibleName("5 of 6 digits entered");

    press("Digit 6");
    expect(dots()).toHaveAccessibleName("6 of 6 digits entered");
    fireEvent.click(screen.getByRole("button", { name: /^Unlock$/ }));
    expect(onUnlock).toHaveBeenCalledWith("123456");
  });

  it("never takes a seventh digit", () => {
    const onUnlock = renderPad();
    for (const digit of ["9", "8", "7", "6", "5", "4", "3"]) press(`Digit ${digit}`);
    fireEvent.click(screen.getByRole("button", { name: /^Unlock$/ }));
    expect(onUnlock).toHaveBeenCalledWith("987654");
  });

  it("Delete removes the last digit and hides Unlock again", () => {
    renderPad();
    for (const digit of ["1", "1", "1", "1", "1", "1"]) press(`Digit ${digit}`);
    press("Delete");
    expect(dots()).toHaveAccessibleName("5 of 6 digits entered");
    expect(screen.queryByRole("button", { name: /^Unlock$/ })).toBeNull();
  });

  it("Clear empties the PIN", () => {
    renderPad();
    for (const digit of ["2", "4", "6"]) press(`Digit ${digit}`);
    press("Clear");
    expect(dots()).toHaveAccessibleName("0 of 6 digits entered");
  });

  it("uses no text input, so the system keyboard never opens", () => {
    renderPad();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.querySelector("input")).toBeNull();
  });

  it("announces a failure in operator words", () => {
    render(<PinPad header={null} helper="" error="That PIN did not match." onUnlock={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("That PIN did not match.");
  });
});
