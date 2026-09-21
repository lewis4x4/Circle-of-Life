import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ContactPage from "./page";

vi.mock("@/components/web/web-header", () => ({ WebHeader: () => null }));
vi.mock("@/components/web/web-footer", () => ({ WebFooter: () => null }));
vi.mock("@/components/web/sticky-care-concierge", () => ({ StickyCareConcierge: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("retains the inquiry after an uncertain write and retries the same key before showing receipt", async () => {
  const fetchMock = vi.fn().mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce({ ok: true, json: async () => ({ received: true }) });
  vi.stubGlobal("fetch", fetchMock);
  render(<ContactPage />);
  fireEvent.change(screen.getByLabelText("Your Full Name"), { target: { value: "Test Family" } });
  fireEvent.change(screen.getByLabelText("Phone Number"), { target: { value: "3865550199" } });
  fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "test@example.invalid" } });
  fireEvent.change(screen.getByLabelText("How can we help your family?"), { target: { value: "Please call." } });
  fireEvent.click(screen.getByRole("button", { name: "Send Confidential Inquiry" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("could not confirm receipt");
  expect(screen.queryByText(/Message Received/)).toBeNull();
  expect(screen.getByLabelText("How can we help your family?")).toHaveValue("Please call.");
  fireEvent.click(screen.getByRole("button", { name: "Send Confidential Inquiry" }));
  await screen.findByText("Message Received, Test Family!");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(JSON.parse(fetchMock.mock.calls[1][1].body));
});

it("prevents duplicate submission and stays pending until durable receipt", async () => {
  let resolve!: (value: unknown) => void;
  const fetchMock = vi.fn(() => new Promise((done) => { resolve = done; }));
  vi.stubGlobal("fetch", fetchMock);
  render(<ContactPage />);
  for (const [label, value] of [["Your Full Name", "Test Family"], ["Phone Number", "3865550199"], ["Email Address", "test@example.invalid"], ["How can we help your family?", "Please call."]]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  const button = screen.getByRole("button", { name: "Send Confidential Inquiry" });
  fireEvent.click(button); fireEvent.click(button);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  expect(screen.queryByText(/Message Received/)).toBeNull();
  resolve({ ok: true, json: async () => ({ received: true }) });
  await waitFor(() => expect(screen.getByText("Message Received, Test Family!")).toBeInTheDocument());
});
