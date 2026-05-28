import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LandingHome from "./landing-home";

describe("LandingHome", () => {
  it("renders the public landing smoke content", () => {
    render(<LandingHome />);

    expect(
      screen.getByRole("heading", { name: /one calm layer for bedside to boardroom operations\./i }),
    ).toBeInTheDocument();

    const signInLinks = screen.getAllByRole("link", { name: /sign in/i });
    expect(signInLinks.length).toBeGreaterThan(0);
    for (const signInLink of signInLinks) {
      expect(signInLink).toHaveAttribute("href", "/login");
    }

    const requestAccessLinks = screen.getAllByRole("link", { name: /request (early )?access/i });
    expect(requestAccessLinks.length).toBeGreaterThan(0);
    for (const requestAccessLink of requestAccessLinks) {
      expect(requestAccessLink).toHaveAttribute(
        "href",
        expect.stringMatching(/^mailto:brian\.lewis@blackrockai\.co\?/),
      );
    }
  });
});
