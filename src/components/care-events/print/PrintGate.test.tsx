import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const recordCareEventPrint = vi.fn();

vi.mock("@/lib/care-events/print", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/care-events/print")>();
  return { ...actual, recordCareEventPrint: (...args: unknown[]) => recordCareEventPrint(...args) };
});

const { PrintGate } = await import("./PrintGate");

afterEach(() => {
  cleanup();
  recordCareEventPrint.mockReset();
});

const supabase = {} as never;

describe("PrintGate", () => {
  it("records the print before the sheet renders", async () => {
    let resolveRecord: (id: string) => void = () => {};
    recordCareEventPrint.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveRecord = resolve;
        }),
    );

    render(
      <PrintGate supabase={supabase} kind="incident_form" careEventId="care-event-1">
        <p>Section 1. What happened</p>
      </PrintGate>,
    );

    // Nothing of the sheet is on the page while the row is still being written.
    expect(screen.queryByText("Section 1. What happened")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Preparing the sheet");

    resolveRecord("audit-row-1");
    expect(await screen.findByText("Section 1. What happened")).toBeInTheDocument();
  });

  it("renders nothing but the one line when the print cannot be recorded", async () => {
    recordCareEventPrint.mockRejectedValue(new Error("boom"));

    render(
      <PrintGate supabase={supabase} kind="physician_sheet" careEventId="care-event-1">
        <p>Physician Notification</p>
      </PrintGate>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Print could not be recorded. Try again.");
    expect(screen.queryByText("Physician Notification")).not.toBeInTheDocument();
  });

  it("says whose print it is when the role is refused, and still renders nothing", async () => {
    recordCareEventPrint.mockRejectedValue(new Error("print: forbidden"));

    render(
      <PrintGate supabase={supabase} kind="incident_reports_log" facilityId="facility-1">
        <p>Incident Reports Log</p>
      </PrintGate>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("This print is for the Administrator or Assistant.");
    expect(screen.queryByText("Incident Reports Log")).not.toBeInTheDocument();
  });

  it("writes one row per print, carrying the range and no name", async () => {
    recordCareEventPrint.mockResolvedValue("audit-row-1");

    render(
      <PrintGate supabase={supabase} kind="incident_reports_log" facilityId="facility-1" from="2026-09-01" to="2026-09-30">
        <p>Incident Reports Log</p>
      </PrintGate>,
    );

    await screen.findByText("Incident Reports Log");
    await waitFor(() => expect(recordCareEventPrint).toHaveBeenCalledTimes(1));
    const payload = recordCareEventPrint.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).toEqual({
      kind: "incident_reports_log",
      careEventId: undefined,
      facilityId: "facility-1",
      from: "2026-09-01",
      to: "2026-09-30",
    });
    // Ids and a range only.
    expect(Object.keys(payload)).not.toContain("residentName");
    expect(Object.keys(payload)).not.toContain("printedBy");
  });
});
