import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentRow } from "../lib/types";
import { DocumentTable } from "./DocumentTable";

const api = vi.hoisted(() => ({
  adminUpdateDocument: vi.fn(async () => ({ ok: true as const })),
  adminDeleteDocument: vi.fn(),
  createObsidianDraft: vi.fn(),
  reindexDocument: vi.fn(),
}));
vi.mock("../lib/knowledge-api", () => api);
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ user: { id: "user-1" } }) }));
vi.mock("@/components/ui/horizontal-scroll", () => ({
  HorizontalScroll: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const doc = {
  id: "doc-1",
  title: "Fall policy",
  summary: null,
  status: "draft",
  audience: "leadership",
  word_count: 100,
  review_owner: null,
  review_due_at: null,
} as unknown as DocumentRow;

describe("DocumentTable status and audience changes (COL-662)", () => {
  beforeEach(() => {
    api.adminUpdateDocument.mockClear();
  });

  it("does not publish on a select change; waits for confirmation", async () => {
    const onRefresh = vi.fn();
    render(<DocumentTable documents={[doc]} onRefresh={onRefresh} />);

    fireEvent.change(screen.getByLabelText("Status for Fall policy"), { target: { value: "published" } });
    expect(api.adminUpdateDocument).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole("button", { name: "Set to Published" }));
    await waitFor(() => expect(api.adminUpdateDocument).toHaveBeenCalledWith("doc-1", { status: "published" }));
  });

  it("cancelling an audience change leaves the document untouched", async () => {
    render(<DocumentTable documents={[doc]} onRefresh={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Audience for Fall policy"), { target: { value: "company_wide" } });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(api.adminUpdateDocument).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Audience for Fall policy") as HTMLSelectElement).value).toBe("leadership");
  });
});
