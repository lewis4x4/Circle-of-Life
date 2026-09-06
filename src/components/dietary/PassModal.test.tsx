import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PassModal } from "./PassModal";
import type { TrayTicket } from "./types";
const ticket = { id: "tray", resident_id: "resident", resident_name: "Resident Example", room: "101", diet_label: "Regular", iddsi_level: 7, iddsi_liquid_level: 0, allergens: [], menu_items: ["Meal"], status: "plated" } as unknown as TrayTicket;
afterEach(() => vi.unstubAllGlobals());
describe("manual tray verification", () => {
  it("persists explicit verification before showing success", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "tray" }) });
    vi.stubGlobal("fetch", fetcher);
    render(<PassModal ticket={ticket} onClose={() => {}} />);
    expect(screen.queryByText(/simulate scan/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/resident name/i), { target: { value: "Resident Example" } });
    fireEvent.change(screen.getByLabelText(/food level checked/i), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText(/liquid level checked/i), { target: { value: "0" } });
    fireEvent.click(screen.getByLabelText(/allergens and cross-contact/i));
    fireEvent.click(screen.getByRole("button", { name: "Record tray pass" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Tray pass saved/i)).toBeInTheDocument();
  });
});
