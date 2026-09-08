import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QuickObservationForm } from "./QuickObservationForm";
import type { CompletionPayload } from "@/lib/rounding/types";

afterEach(cleanup);
const original: CompletionPayload = {
  requestId: "request", observedAt: "2026-09-07T12:00:00Z", quickStatus: "distressed",
  residentLocation: "Original facility-specific location", residentPosition: "Lying Down", residentState: "Needs Assistance",
  note: "Original clinical detail", distressPresent: true, hydrationOffered: true,
  lateReason: null, retryOwner: { userId: "operator", sessionId: "session", organizationId: "org", facilityId: "facility" },
};
it("restores a pending clinical snapshot as read-only and submits that exact snapshot", async () => {
  const onSubmit = vi.fn();
  render(<QuickObservationForm residentName="Synthetic Resident" dueLabel="Due" pendingPayload={original} onSubmit={onSubmit} />);
  expect(screen.getByRole("radio", { name: "Distressed" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("switch", { name: "Hydration offered" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByDisplayValue("Original clinical detail")).toBeDisabled();
  expect(screen.getByDisplayValue("Original facility-specific location")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Record" })).toBeDisabled();
  screen.getAllByRole("combobox").forEach((select) => expect(select).toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Complete round" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(original));
});
it("amends only the late reason when the caller supplies an explicit unsaved rejection", async () => {
  const onSubmit = vi.fn();
  render(<QuickObservationForm residentName="Synthetic Resident" dueLabel="Due" pendingPayload={original} reasonRequired onSubmit={onSubmit} />);
  const reason = screen.getByPlaceholderText("Required only for late entries");
  expect(reason).toBeEnabled();
  fireEvent.change(reason, { target: { value: "  Emergency response  " } });
  fireEvent.click(screen.getByRole("button", { name: "Complete round" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ ...original, lateReason: "Emergency response" }));
});
