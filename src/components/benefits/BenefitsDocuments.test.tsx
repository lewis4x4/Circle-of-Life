import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BenefitsDetail } from "@/lib/benefits/contracts";
import { BenefitsDocuments } from "./BenefitsDocuments";
const mocks = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: { from: () => ({ uploadToSignedUrl: mocks.upload }) },
  }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("private benefits upload", () => {
  it("retries verification without reserving a duplicate document or replacing uploaded bytes", async () => {
    const snapshot = {
      case: { id: "case-id", revision: 4 },
      documents: [],
    } as unknown as BenefitsDetail;
    mocks.upload.mockResolvedValue({ error: null });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            document: { id: "doc-id", status: "reserved", sha256: "abc" },
            revision: 5,
            upload: {
              path: "private/path",
              token: "signed-token",
              signedUrl: "unused",
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "Verification temporarily unavailable" }),
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ case_id: "case-id", revision: 6 })),
      );
    vi.stubGlobal("fetch", fetch);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <BenefitsDocuments
        detail={snapshot}
        refresh={refresh}
        disabled={false}
      />,
    );
    const file = new File(["%PDF-1.7\noriginal"], "signed-3008.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new TextEncoder().encode("%PDF-1.7\noriginal").buffer,
    });
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });
    fireEvent.change(screen.getByLabelText(/Document description/), {
      target: { value: "Actual signed 3008" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Upload private evidence" }),
    );
    await screen.findByText("Verification temporarily unavailable");
    expect(screen.getByText("Selected: signed-3008.pdf")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry evidence upload" }),
    );
    await screen.findByText(/Evidence uploaded and verified/);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(
      fetch.mock.calls.filter(([url]) => String(url).endsWith("/documents")),
    ).toHaveLength(1);
    const firstFinalize = JSON.parse(fetch.mock.calls[1]![1].body);
    const secondFinalize = JSON.parse(fetch.mock.calls[2]![1].body);
    expect(secondFinalize).toEqual(firstFinalize);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
