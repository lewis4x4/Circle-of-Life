import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChoiceChip, ChoiceGroup } from "./ChoiceChip";

function Harness() {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <ChoiceGroup id="how" title="How are they?" hint="pick one">
      {["Awake", "Asleep"].map((label) => (
        <ChoiceChip key={label} pressed={picked === label} onPress={() => setPicked(label)}>
          {label}
        </ChoiceChip>
      ))}
    </ChoiceGroup>
  );
}

describe("ChoiceChip", () => {
  it("exposes its state through aria-pressed", () => {
    render(<Harness />);
    const awake = screen.getByRole("button", { name: "Awake" });
    const asleep = screen.getByRole("button", { name: "Asleep" });
    expect(awake).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(awake);
    expect(awake).toHaveAttribute("aria-pressed", "true");
    expect(asleep).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(asleep);
    expect(awake).toHaveAttribute("aria-pressed", "false");
    expect(asleep).toHaveAttribute("aria-pressed", "true");
  });

  it("names its group by the question", () => {
    render(<Harness />);
    expect(screen.getByRole("group", { name: "How are they? pick one" })).toBeInTheDocument();
  });
});
