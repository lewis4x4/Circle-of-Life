import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RESIDENT_OVERVIEW_UPLOAD_DOCUMENTS } from "@/lib/residents/resident-overview-display-copy";

const query = vi.hoisted(() => ({
  result: { data: [] as unknown[], error: null as { message: string } | null },
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        is: () => ({
          or: () => ({
            order: () => ({
              limit: () => Promise.resolve(query.result),
            }),
          }),
        }),
      }),
    }),
  }),
}));

import { ResidentIntakeLinks } from "./ResidentIntakeLinks";

describe("ResidentIntakeLinks", () => {
  beforeEach(() => {
    query.result = { data: [], error: null };
  });

  it("uses compact empty copy and admission-document language", async () => {
    render(<ResidentIntakeLinks residentId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" compact />);
    await waitFor(() => {
      expect(screen.getByText("No packet reviews on file.")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: RESIDENT_OVERVIEW_UPLOAD_DOCUMENTS })).toBeInTheDocument();
    expect(screen.queryByText("Upload another packet")).not.toBeInTheDocument();
    expect(screen.queryByText("No packet reviews yet")).not.toBeInTheDocument();
  });

  it("keeps loading and unavailable packet states distinct", async () => {
    const { rerender } = render(<ResidentIntakeLinks residentId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" compact />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading packet reviews…");

    query.result = { data: [], error: { message: "unavailable" } };
    rerender(<ResidentIntakeLinks residentId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" compact />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Packet reviews could not be loaded");
    });
  });
});
