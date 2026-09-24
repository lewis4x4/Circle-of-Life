import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OnboardingManualStatus } from "@/lib/staff/onboarding-manuals";

import { OnboardingManualsPanel } from "./OnboardingManualsPanel";

const unsigned: OnboardingManualStatus = {
  document_id: "doc-1",
  document_title: "Resident Rights P&P",
  required_from: "2026-09-24T12:00:00Z",
  signoff_id: null,
  signed_at: null,
  signature_name: null,
  method: null,
  signed_content_sha256: null,
  current_content_sha256: "a".repeat(64),
};

let manuals: OnboardingManualStatus[] = [];
const fetchMock = vi.fn();

beforeEach(() => {
  manuals = [unsigned];
  fetchMock.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      manuals = [{ ...unsigned, signoff_id: "s-1", signed_at: "2026-09-25T12:00:00Z", signature_name: "New Hire", method: "self", signed_content_sha256: "a".repeat(64) }];
      return { ok: true, json: async () => ({ result: {} }) };
    }
    if (String(url).includes("?document=")) {
      return { ok: true, json: async () => ({ manuals, document: { id: "doc-1", title: "Resident Rights P&P", text: "# Rights\nEvery resident has rights.", updated_at: "2026-09-01T00:00:00Z" } }) };
    }
    return { ok: true, json: async () => ({ manuals }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OnboardingManualsPanel (COL-740)", () => {
  it("shows nothing for someone who owes no manual (existing staff)", async () => {
    manuals = [];
    const onLoaded = vi.fn();
    const { container } = render(<OnboardingManualsPanel staffId="s" selfService canManage={false} isSelf onLoaded={onLoaded} />);
    await waitFor(() => expect(onLoaded).toHaveBeenCalledWith([]));
    expect(container.textContent).toBe("");
  });

  it("lets the new hire read the manual and sign it in their own name", async () => {
    const onLoaded = vi.fn();
    render(<OnboardingManualsPanel staffId="s" selfService canManage={false} isSelf onLoaded={onLoaded} />);
    expect(await screen.findByText("0 of 1 signed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record in-person signature" })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Read and sign" }));
    expect(await screen.findByText("Every resident has rights.")).toBeTruthy();
    const sign = screen.getByRole("button", { name: "Sign" });
    expect((sign as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("checkbox"));
    await user.type(screen.getByLabelText("Type your full name to sign"), "New Hire");
    await user.click(sign);
    await screen.findByText("All 1 signed");
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(post![1].body)).toEqual({ document_id: "doc-1", signature_name: "New Hire", method: "self" });
  });

  it("offers a manager an in-person signature they witness, not a self signature", async () => {
    render(<OnboardingManualsPanel staffId="s" selfService={false} canManage isSelf={false} onLoaded={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Record in-person signature" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Read and sign" })).toBeNull();
  });

  it("says the state is unknown when the read fails, and reports null", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({ error: "Onboarding manuals could not be loaded." }) }));
    const onLoaded = vi.fn();
    render(<OnboardingManualsPanel staffId="s" selfService canManage={false} isSelf onLoaded={onLoaded} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onLoaded).toHaveBeenCalledWith(null);
  });
});
