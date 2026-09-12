import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { EntityCombobox } from "./entity-combobox";

afterEach(cleanup);

function Picker() {
  const [value, setValue] = useState("");
  return <>
    <EntityCombobox id="resident" label="Resident" placeholder="Select resident"
      searchPlaceholder="Search residents" value={value} onChange={setValue}
      options={[
        { id: "one", label: "Resident One", keywords: "Resident One" },
        { id: "two", label: "Resident Two", keywords: "Resident Two" },
      ]} />
    <button>Next field</button>
  </>;
}

describe("EntityCombobox dismissal", () => {
  it("stays closed after selecting a resident and can reopen", async () => {
    const user = userEvent.setup();
    render(<Picker />);
    const trigger = screen.getByRole("button", { name: "Resident" });
    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "Resident Two" }));
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    expect(trigger).toHaveTextContent("Resident Two");
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    expect(await screen.findByPlaceholderText("Search residents")).toBeVisible();
  });

  it("supports keyboard opening and selection without reopening on returned focus", async () => {
    const user = userEvent.setup();
    render(<Picker />);
    const trigger = screen.getByRole("button", { name: "Resident" });
    await user.tab();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Enter}");
    await user.type(await screen.findByPlaceholderText("Search residents"), "Two");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    expect(trigger).toHaveTextContent("Resident Two");
  });

  it("stays closed after Escape or an outside click", async () => {
    const user = userEvent.setup();
    render(<Picker />);
    const trigger = screen.getByRole("button", { name: "Resident" });
    await user.click(trigger);
    await screen.findByPlaceholderText("Search residents");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await screen.findByPlaceholderText("Search residents");
    await user.click(screen.getByRole("button", { name: "Next field" }));
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
  });
});
