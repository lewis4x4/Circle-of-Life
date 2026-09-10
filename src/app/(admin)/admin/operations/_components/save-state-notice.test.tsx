import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";

import type { DraftSummary, SaveState } from "@/lib/operations/recovery-client";
import { SaveStateNotice, describeSaveState } from "./save-state-notice";

const draft: DraftSummary = { id: "99999999-9999-4999-8999-999999999999", command: "record_work", target_id: "55555555-5555-4555-8555-555555555555", request_key: "record:2026-09-10:0001", state: "pending", expires_at: null };
const record = { kind: "receipt" as const, id: "77777777-7777-4777-8777-777777777777", replayed: false };

const STATES: SaveState[] = [
  { kind: "idle" },
  { kind: "saving_draft", input: { request_key: draft.request_key, command: "record_work", target_id: draft.target_id ?? undefined, arguments: {} } },
  { kind: "submitting", draft },
  { kind: "saved", draft, record, reply: {} },
  { kind: "rejected", draft, outcome: "conflict", message: "Work is already recorded for this occurrence" },
  { kind: "uncertain", draft, message: null },
  { kind: "reconciling", draft },
  { kind: "unsaved", draft },
  { kind: "resuming", draft },
  { kind: "offline", saved: false, message: "Not saved. The server could not be reached and nothing was stored on this device." },
  { kind: "expired", draft },
  { kind: "discarded", draft },
];

describe("SaveStateNotice", () => {
  it("is a polite live region that always names the current person", () => {
    render(<SaveStateNotice state={{ kind: "idle" }} actorName="Dana Reyes" />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("data-save-state", "idle");
    expect(screen.getByTestId("current-person")).toHaveTextContent("Current person: Dana Reyes");
    expect(screen.getByText("Ready to record")).toBeVisible();
  });

  it("shows who is recording even when nobody is signed in", () => {
    render(<SaveStateNotice state={{ kind: "idle" }} actorName={null} />);
    expect(screen.getByTestId("current-person")).toHaveTextContent("Current person: not signed in");
  });

  it("gives saving, saved, not saved, retry offered, offline, uploading and expired distinct visible words", () => {
    const titles = new Map<string, string>();
    for (const state of STATES) {
      const { unmount } = render(<SaveStateNotice state={state} actorName="Dana Reyes" />);
      const region = screen.getByRole("status");
      titles.set(state.kind, region.querySelector("p")?.textContent ?? "");
      unmount();
    }
    expect(titles.get("saving_draft")).toBe("Saving");
    expect(titles.get("submitting")).toBe("Saving");
    expect(titles.get("saved")).toBe("Saved");
    expect(titles.get("rejected")).toBe("Not saved");
    expect(titles.get("unsaved")).toBe("Not saved yet");
    expect(titles.get("offline")).toBe("Offline. Not saved");
    expect(titles.get("expired")).toBe("Earlier save expired");
    expect(titles.get("uncertain")).toBe("Not confirmed");
    expect(titles.get("discarded")).toBe("Draft discarded");
    // Every visible outcome the operator must distinguish reads differently.
    const distinct = new Set(["saved", "rejected", "unsaved", "offline", "expired", "uncertain", "discarded", "saving_draft", "reconciling", "resuming"].map((kind) => titles.get(kind)));
    expect(distinct.size).toBe(10);
    render(<SaveStateNotice state={{ kind: "idle" }} actorName="Dana Reyes" uploading />);
    expect(screen.getByText("Uploading evidence")).toBeVisible();
  });

  it("never says saved for a state without a server record and says not saved explicitly when offline", () => {
    for (const state of STATES) {
      const view = describeSaveState(state);
      if (state.kind !== "saved") expect(view.title).not.toBe("Saved");
    }
    const offline = describeSaveState({ kind: "offline", saved: false, message: "Not saved. Nothing stored." });
    expect(offline.title).toContain("Not saved");
    expect(offline.actions).toEqual({});
    expect(describeSaveState({ kind: "saved", draft, record: { ...record, replayed: true }, reply: {} }).detail).toContain("already been saved earlier");
    expect(describeSaveState({ kind: "rejected", draft, outcome: "conflict", message: "Work is already recorded" }).detail).toBe("Work is already recorded");
  });

  it("offers keyboard-reachable retry and discard when the server has no record, and check again when unconfirmed", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onDiscard = vi.fn();
    const onCheckAgain = vi.fn();
    const { rerender } = render(<SaveStateNotice state={{ kind: "unsaved", draft }} actorName="Dana Reyes" onRetry={onRetry} onDiscard={onDiscard} onCheckAgain={onCheckAgain} />);
    const retry = screen.getByRole("button", { name: "Retry the same save" });
    const discard = screen.getByRole("button", { name: "Discard" });
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
    await user.tab();
    expect(retry).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onRetry).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(discard).toHaveFocus();
    await user.keyboard(" ");
    expect(onDiscard).toHaveBeenCalledTimes(1);
    rerender(<SaveStateNotice state={{ kind: "uncertain", draft, message: null }} actorName="Dana Reyes" onRetry={onRetry} onDiscard={onDiscard} onCheckAgain={onCheckAgain} />);
    expect(screen.queryByRole("button", { name: "Retry the same save" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Check again" }));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
    rerender(<SaveStateNotice state={{ kind: "saved", draft, record, reply: {} }} actorName="Dana Reyes" onRetry={onRetry} onDiscard={onDiscard} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the uploading line beside an in-flight save", () => {
    render(<SaveStateNotice state={{ kind: "submitting", draft }} actorName="Dana Reyes" uploading />);
    expect(screen.getByText("Saving")).toBeVisible();
    expect(screen.getByText("Evidence upload in progress. Keep this page open.")).toBeVisible();
  });

  it("passes axe on the rendered notice with actions", async () => {
    const { container } = render(<SaveStateNotice state={{ kind: "unsaved", draft }} actorName="Dana Reyes" onRetry={() => {}} onDiscard={() => {}} />);
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});
