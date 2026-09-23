import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SITE_TITLE, documentTitleFor } from "@/lib/a11y/document-title";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/staff" }));

import { DocumentTitleFromHeading } from "./DocumentTitleFromHeading";

const flushFrame = () => act(async () => { await new Promise((resolve) => requestAnimationFrame(() => resolve(null))); });

afterEach(() => {
  document.title = SITE_TITLE;
});

describe("document titles (COL-658)", () => {
  it("formats the page heading", () => {
    expect(documentTitleFor("  Staff\n roster ")).toBe("Staff roster · Haven");
    expect(documentTitleFor("")).toBe(SITE_TITLE);
    expect(documentTitleFor(null)).toBe(SITE_TITLE);
  });

  it("titles the page from its h1 and follows it when it settles after load", async () => {
    document.title = SITE_TITLE;
    const { rerender } = render(<><h1>Loading…</h1><DocumentTitleFromHeading /></>);
    expect(document.title).toBe("Loading… · Haven");
    rerender(<><h1>Staff roster</h1><DocumentTitleFromHeading /></>);
    await flushFrame();
    expect(document.title).toBe("Staff roster · Haven");
  });

  it("keeps a title a page set through metadata", async () => {
    document.title = "Privacy policy — Stand Up connector";
    render(<><h1>Privacy</h1><DocumentTitleFromHeading /></>);
    await flushFrame();
    expect(document.title).toBe("Privacy policy — Stand Up connector");
  });
});
