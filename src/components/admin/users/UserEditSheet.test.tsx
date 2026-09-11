import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UserEditSheet } from "./UserEditSheet";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "owner", app_metadata: { app_role: "owner" } } }) }));
vi.mock("@/hooks/useFacilityStore", () => ({ useFacilityStore: () => ({
  availableFacilities: [{ id: "current-facility", name: "Current facility" }],
}) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const fetcher = vi.fn<typeof fetch>();
const user = { id: "target", full_name: "Inactive staff", email: "staff@example.invalid", app_role: "caregiver",
  is_active: false, deleted_at: null, facilities: [], phone: null, job_title: null };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockImplementation(async (_url, init) => init?.method === "POST"
    ? new Response("{}", { status: 200 })
    : Response.json({ data: user }));
});
describe("explicit account reactivation", () => {
  it("offers current facilities with no former membership and preserves request identity after response loss", async () => {
    let first = true;
    fetcher.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        if (first) { first = false; throw new TypeError("response lost"); }
        return Response.json({ data: {} });
      }
      return Response.json({ data: user });
    });
    render(<UserEditSheet userId="target" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reactivate" }));
    const checkbox = await screen.findByRole("checkbox", { name: "Current facility" });
    expect(checkbox).not.toBeChecked();
    const submit = screen.getByRole("button", { name: "Reactivate with selected access" });
    expect(submit).toBeDisabled();
    fireEvent.click(checkbox);
    fireEvent.click(submit);
    await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1));
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2));
    const posts = fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts[0][1]).toEqual(posts[1][1]);
    expect(JSON.parse(posts[0][1]!.body as string).facilities).toEqual([{ facility_id: "current-facility", is_primary: true }]);
  });
  it("retains terminal review protection when refreshing current access fails", async () => {
    let submitted = false;
    fetcher.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        submitted = true;
        return Response.json({ sync_status: "action_required" }, { status: 202 });
      }
      if (submitted) throw new TypeError("offline");
      return Response.json({ data: user });
    });
    render(<UserEditSheet userId="target" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reactivate" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Current facility" }));
    fireEvent.click(screen.getByRole("button", { name: "Reactivate with selected access" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review current access" }));
    await waitFor(() => expect(fetcher.mock.calls.filter(([, init]) => !init?.method)).toHaveLength(2));
    expect(await screen.findByRole("button", { name: "Review current access" })).toBeInTheDocument();
  });

});
