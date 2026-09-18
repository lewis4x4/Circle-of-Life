import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ObservationCapture } from "./ObservationCapture";
import type { CompletionPayload } from "@/lib/rounding/types";

const FACILITY_ID = "00000000-0000-4000-8000-000000000001";

const catalog = {
  location: [{ code: "dining_room", label: "Dining Room" }],
  position: [{ code: "sitting", label: "Sitting" }],
  state: [{ code: "eating_meal", label: "Eating Meal/Snack" }],
  meal_intake: [{ code: "ate_well", label: "Ate well" }],
  mood_state: [{ code: "pleasant", label: "Pleasant" }],
  med_response: [{ code: "refused_meds", label: "Refused meds" }],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(catalog), { status: 200 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openCapture(onSubmit = vi.fn()) {
  render(
    <ObservationCapture
      residentName="Synthetic Resident"
      dueLabel="Due this window"
      facilityId={FACILITY_ID}
      onSubmit={onSubmit}
    />,
  );
  await screen.findByRole("radio", { name: "Dining Room" });
  return onSubmit;
}

describe("chip capture surface", () => {
  it("records with an empty note and never says anything about the note", async () => {
    const onSubmit = await openCapture();

    fireEvent.click(screen.getByRole("radio", { name: "Awake" }));
    fireEvent.click(screen.getByRole("radio", { name: "Dining Room" }));
    fireEvent.click(screen.getByRole("radio", { name: "Eating Meal/Snack" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Ate well" }));

    const note = screen.getByLabelText("Note, if there is something to add");
    expect(note).toHaveValue("");

    const record = screen.getByRole("button", { name: "Record check" });
    expect(record).toBeEnabled();
    fireEvent.click(record);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      quickStatus: "awake",
      residentLocation: "dining_room",
      residentState: "eating_meal",
      chipSelections: { meal_intake: ["ate_well"] },
      note: null,
    });

    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/required/i);
    expect(body).not.toMatch(/\*/);
    expect(body).not.toMatch(/add (a |more )?detail/i);
  });

  it("will not record before a chip is tapped, and says so without naming the note", async () => {
    await openCapture();

    fireEvent.click(screen.getByRole("radio", { name: "Awake" }));
    fireEvent.click(screen.getByRole("radio", { name: "Dining Room" }));
    fireEvent.click(screen.getByRole("radio", { name: "Eating Meal/Snack" }));

    expect(screen.getByRole("button", { name: "Record check" })).toBeDisabled();
    const stillNeeded = screen.getByText(/Still needed:/);
    expect(stillNeeded.textContent).toContain("a meal, mood or medication chip");
    expect(stillNeeded.textContent).not.toMatch(/note/i);
  });

  it("reads the sentence back before it is recorded", async () => {
    await openCapture();

    fireEvent.click(screen.getByRole("radio", { name: "Awake" }));
    fireEvent.click(screen.getByRole("radio", { name: "Dining Room" }));
    fireEvent.click(screen.getByRole("radio", { name: "Eating Meal/Snack" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Ate well" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Refused meds" }));

    expect(screen.getByTestId("observation-preview").textContent)
      .toBe("Ate well, refused meds. Awake, Eating Meal/Snack. In Dining Room.");
  });

  it("counts five taps from an open screen to a recorded check", async () => {
    const onSubmit = await openCapture();
    const taps = [
      screen.getByRole("radio", { name: "Awake" }),
      screen.getByRole("radio", { name: "Dining Room" }),
      screen.getByRole("radio", { name: "Eating Meal/Snack" }),
      screen.getByRole("checkbox", { name: "Ate well" }),
      screen.getByRole("button", { name: "Record check" }),
    ];
    for (const target of taps) fireEvent.click(target);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(taps).toHaveLength(5);
  });

  it("replays a retained check exactly as it was tapped", async () => {
    const retained: CompletionPayload = {
      requestId: "6ad67702-0ab3-49f6-86d6-f93c55b1f93c",
      observedAt: "2026-09-07T12:00:00.000Z",
      quickStatus: "agitated",
      residentLocation: "dining_room",
      residentState: "eating_meal",
      chipSelections: { mood_state: ["pleasant"] },
      note: "Synthetic retained detail",
      lateReason: null,
    };
    const onSubmit = vi.fn();
    render(
      <ObservationCapture
        residentName="Synthetic Resident"
        dueLabel="Due this window"
        facilityId={FACILITY_ID}
        pendingPayload={retained}
        onSubmit={onSubmit}
      />,
    );
    await screen.findByRole("radio", { name: "Dining Room" });

    expect(screen.getByRole("checkbox", { name: "Pleasant" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "Pleasant" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Record check" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(retained));
  });

  it("amends only the delayed-entry reason when the server asks for one", async () => {
    const retained: CompletionPayload = {
      requestId: "6ad67702-0ab3-49f6-86d6-f93c55b1f93c",
      observedAt: "2026-09-07T12:00:00.000Z",
      quickStatus: "awake",
      residentLocation: "dining_room",
      residentState: "eating_meal",
      chipSelections: { meal_intake: ["ate_well"] },
      note: null,
      lateReason: null,
    };
    const onSubmit = vi.fn();
    render(
      <ObservationCapture
        residentName="Synthetic Resident"
        dueLabel="Due this window"
        facilityId={FACILITY_ID}
        pendingPayload={retained}
        reasonRequired
        onSubmit={onSubmit}
      />,
    );
    await screen.findByRole("radio", { name: "Dining Room" });

    fireEvent.change(screen.getByLabelText("Reason this went in after the window"), {
      target: { value: "  Responded to a call bell  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record check" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ ...retained, lateReason: "Responded to a call bell" }));
  });
});
