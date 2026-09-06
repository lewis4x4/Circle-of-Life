import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MedPassModal } from "./MedPassModal";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
const pass = { id: "pass", residentId: "resident", resident: "Review Resident", room: "101", med: "Prescribed medication", dose: "10 mg per order", time: "08:00", status: "due" as const, minutes: 0, controlled: false, witnessRequired: false, hold: null };
afterEach(() => { cleanup(); rpc.mockReset(); });
describe("real medication pass confirmation", () => {
 it("does not claim completion until the MAR transaction acknowledges", async () => {
  rpc.mockResolvedValue({ data: null, error: new Error("Active hold requires nurse review") });
  render(<MedPassModal pass={pass} onClose={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Save to MAR" })).toBeDisabled();
  expect(screen.queryByText(/Five Rights Verified|MAR signed|Simulate scan/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Save to MAR" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Active hold");
  expect(screen.queryByText(/Saved to the MAR/)).not.toBeInTheDocument();
 });
 it("displays the durable receipt after successful persistence", async () => {
  const onSaved = vi.fn(); rpc.mockResolvedValue({ data: "receipt-uuid", error: null });
  render(<MedPassModal pass={pass} onClose={vi.fn()} onSaved={onSaved} />);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Save to MAR" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("receipt-uuid"));
  expect(onSaved).toHaveBeenCalledOnce();
  expect(rpc).toHaveBeenCalledWith("complete_med_pass_review", expect.objectContaining({ p_pass_id: "pass", p_status: "given", p_checks_confirmed: true }));
 });
});
